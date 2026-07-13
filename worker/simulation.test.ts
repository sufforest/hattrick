import { describe, it, expect } from "vitest";
import { computeFantasyStandings, fantasyPoints, type FantasyPickRow, type StatsByRound } from "./fantasy";
import type { DraftStanding, PlayerAgg, Position, PublicMember, RoundCode } from "../shared/types";

// A deterministic tournament driven round-by-round through the REAL scoring pipeline.
// We assert relational invariants at every step (which hold for any size), plus a few
// exact spot checks — this is the layer that catches *temporal* bugs (frozen-on-elim,
// drop banking, acquisition baselines) that snapshot unit tests miss.

const ZERO: PlayerAgg = {
  apps: 0, goals: 0, assists: 0, yellow: 0, red: 0, og: 0, saves: 0, conceded: 0, cleanSheets: 0,
};
const add = (a: PlayerAgg, b: PlayerAgg): PlayerAgg => ({
  apps: a.apps + b.apps, goals: a.goals + b.goals, assists: a.assists + b.assists,
  yellow: a.yellow + b.yellow, red: a.red + b.red, og: a.og + b.og,
  saves: a.saves + b.saves, conceded: a.conceded + b.conceded, cleanSheets: a.cleanSheets + b.cleanSheets,
});
const g = (o: Partial<PlayerAgg>): PlayerAgg => ({ ...ZERO, ...o });

// Players: id -> (position, teamId). 3 managers, squads spread across 4 teams A/B/C/D.
const PLAYERS: Record<string, { pos: Position; team: string }> = {
  pA1: { pos: "FWD", team: "A" }, pA2: { pos: "MID", team: "A" },
  pB1: { pos: "MID", team: "B" },
  pC1: { pos: "FWD", team: "C" }, pC2: { pos: "GK", team: "C" },
  pD1: { pos: "DEF", team: "D" },
  pC3: { pos: "FWD", team: "C" }, // free agent, added mid-tournament
};
const members: PublicMember[] = [
  { id: "m1", name: "Alice", isCommissioner: true, inDraft: true, draftPosition: 1 },
  { id: "m2", name: "Bob", isCommissioner: false, inDraft: true, draftPosition: 2 },
  { id: "m3", name: "Cara", isCommissioner: false, inDraft: true, draftPosition: 3 },
];
// Initial squads (draft, baseline 0).
const ownership: Record<string, string[]> = {
  m1: ["pA1", "pB1"], m2: ["pC1", "pD1"], m3: ["pA2", "pC2"],
};

type Transfer = { drop?: string; dropPts?: number; add?: string; member?: string; baseline?: number };
function mkPicks(transfers: Transfer = {}): FantasyPickRow[] {
  const rows: FantasyPickRow[] = [];
  for (const [mid, ids] of Object.entries(ownership)) {
    for (const id of ids) {
      const dropped = transfers.drop === id;
      rows.push({
        memberId: mid, playerId: id, playerName: id, position: PLAYERS[id].pos,
        country: PLAYERS[id].team, teamId: PLAYERS[id].team, baseline: 0,
        dropped, dropPts: dropped ? (transfers.dropPts ?? null) : null,
      });
    }
  }
  if (transfers.add && transfers.member) {
    rows.push({
      memberId: transfers.member, playerId: transfers.add, playerName: transfers.add,
      position: PLAYERS[transfers.add].pos, country: PLAYERS[transfers.add].team,
      teamId: PLAYERS[transfers.add].team, baseline: transfers.baseline ?? 0, dropped: false, dropPts: null,
    });
  }
  return rows;
}

describe("tournament simulation", () => {
  const statsAgg: Record<string, PlayerAgg> = {};
  const byRound: StatsByRound = {};
  const applyRound = (round: RoundCode, roundStats: Record<string, Partial<PlayerAgg>>) => {
    for (const [pid, s] of Object.entries(roundStats)) {
      const sa = g(s);
      statsAgg[pid] = add(statsAgg[pid] ?? ZERO, sa);
      (byRound[pid] ??= {})[round] = { agg: sa, matchId: round + "-" + PLAYERS[pid].team };
    }
  };
  const lineOf = (s: DraftStanding[], mid: string, pid: string) =>
    s.find((x) => x.memberId === mid)!.players.find((p) => p.playerId === pid);

  // Invariant: total always equals the sum of a manager's player lines.
  const assertTotals = (s: DraftStanding[]) => {
    for (const m of s) expect(m.points).toBe(m.players.reduce((t, p) => t + p.points, 0));
  };

  it("scores correctly across rounds with elim / captain / chip / transfer", () => {
    // ----- SF: A beats B, C beats D. (B, D eliminated) -----
    applyRound("SF", {
      pA1: { apps: 1, goals: 1 }, pA2: { apps: 1 },
      pB1: { apps: 1 },
      pC1: { apps: 1, goals: 1 }, pC2: { apps: 1, cleanSheets: 1 },
      pD1: { apps: 1 },
    });
    const elimSF = new Set(["B", "D"]);
    // m2 plays All-In in SF (whole squad ×2 that round); m1 captains pA1 in SF.
    const sf = computeFantasyStandings(members, mkPicks(), statsAgg, elimSF, {
      byRound, captains: { m1: { SF: "pA1" } }, chips: { m2: { ALL_IN: "SF" } },
    });
    assertTotals(sf);

    // Captain exact: pA1 SF = 5, doubled -> line 10, captainBonus 5.
    expect(lineOf(sf, "m1", "pA1")!.points).toBe(10);
    expect(lineOf(sf, "m1", "pA1")!.captainBonus).toBe(5);
    // All-In exact: m2 pC1(5)+pD1(1) doubled -> 12.
    expect(sf.find((x) => x.memberId === "m2")!.points).toBe(12);
    // Eliminated flags
    expect(lineOf(sf, "m1", "pB1")!.eliminated).toBe(true);
    expect(lineOf(sf, "m2", "pD1")!.eliminated).toBe(true);
    expect(lineOf(sf, "m1", "pA1")!.eliminated).toBe(false);

    const sfB1 = lineOf(sf, "m1", "pB1")!.points; // banked-while-alive value
    const sfA1plain = fantasyPoints(statsAgg["pA1"], "FWD");

    // m1 transfers after SF: drop pB1 (its points bank at sfB1), add free agent pC3 with
    // acquisition baseline = pC3's points so far (0 — it hasn't played yet). The dropped
    // row stays on the squad as dropped=1.
    const xfer: Transfer = { drop: "pB1", dropPts: sfB1, add: "pC3", member: "m1", baseline: 0 };

    // ----- F: A beats C. (C eliminated, A champion). B/D don't play (already out). -----
    applyRound("F", {
      pA1: { apps: 1, goals: 1 }, pA2: { apps: 1 },
      pC1: { apps: 1 }, pC2: { apps: 1, conceded: 1 },
      pC3: { apps: 1, goals: 1 }, // the newly-added free agent scores in the final
    });
    const elimF = new Set(["B", "D", "C"]);
    const fin = computeFantasyStandings(members, mkPicks(xfer), statsAgg, elimF, {
      byRound, captains: { m1: { SF: "pA1" } }, chips: { m2: { ALL_IN: "SF" } },
    });
    assertTotals(fin);

    // INVARIANT — dropped player's contribution is frozen at its banked value forever.
    expect(lineOf(fin, "m1", "pB1")!.points).toBe(sfB1);
    expect(lineOf(fin, "m1", "pB1")!.dropped).toBe(true);

    // INVARIANT — eliminated survivor frozen: pD1 (out in SF) unchanged from SF to F.
    expect(lineOf(fin, "m2", "pD1")!.points).toBe(lineOf(sf, "m2", "pD1")!.points);

    // INVARIANT — accumulation: pA1 (alive throughout, no longer captained in F since
    // captain was SF-only) grew by its F points vs SF.
    expect(lineOf(fin, "m1", "pA1")!.points).toBeGreaterThan(sfA1plain);

    // INVARIANT — acquisition baseline: pC3 added at baseline 0 but only played the
    // final, so it contributes exactly its final points (no retroactive credit).
    expect(lineOf(fin, "m1", "pC3")!.points).toBe(fantasyPoints(g({ apps: 1, goals: 1 }), "FWD"));

    // Final standings are sorted high-to-low.
    for (let i = 1; i < fin.length; i++) expect(fin[i - 1].points).toBeGreaterThanOrEqual(fin[i].points);
  });

  it("acquisition baseline prevents retroactive points (the draft-baseline bug)", () => {
    // A player who already banked points, then is acquired, must contribute 0 until they
    // score MORE. baseline == their points at acquisition is what enforces that.
    const scored = g({ apps: 1, goals: 2 }); // FWD -> 9
    const sMap = { pX: scored };
    const acquiredCorrectly: FantasyPickRow[] = [
      { memberId: "m1", playerId: "pX", playerName: "pX", position: "FWD", country: "Z",
        teamId: "Z", baseline: fantasyPoints(scored, "FWD"), dropped: false, dropPts: null },
    ];
    const s = computeFantasyStandings([members[0]], acquiredCorrectly, sMap, new Set());
    expect(s[0].points).toBe(0); // no retroactive credit

    // The bug: baseline left at 0 would wrongly credit all 9 prior points.
    const buggy = [{ ...acquiredCorrectly[0], baseline: 0 }];
    expect(computeFantasyStandings([members[0]], buggy, sMap, new Set())[0].points).toBe(9);
  });
});
