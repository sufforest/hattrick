import { describe, it, expect } from "vitest";
import {
  fantasyPoints,
  scoreBreakdown,
  computeFantasyStandings,
  computeStandingsByMatch,
  computeH2HStandings,
  eliminatedTeams,
  type FantasyPickRow,
  type StatsByRound,
} from "./fantasy";
import type { Match, PlayerAgg, PublicMember } from "../shared/types";

const agg = (o: Partial<PlayerAgg>): PlayerAgg => ({
  apps: 0, goals: 0, assists: 0, yellow: 0, red: 0, og: 0, saves: 0, conceded: 0, cleanSheets: 0, ...o,
});

const member = (id: string, name: string, pos: number): PublicMember => ({
  id, name, isCommissioner: false, inDraft: true, draftPosition: pos,
});

const pick = (memberId: string, playerId: string, position: FantasyPickRow["position"], extra: Partial<FantasyPickRow> = {}): FantasyPickRow => ({
  memberId, playerId, playerName: playerId, position, country: "X", teamId: "t" + playerId,
  baseline: 0, dropped: false, dropPts: null, ...extra,
});

describe("fantasyPoints", () => {
  it("forward: appearance + goals", () => {
    expect(fantasyPoints(agg({ apps: 1, goals: 2 }), "FWD")).toBe(1 + 2 * 4);
  });
  it("midfielder: goal worth 5, assist 3, clean sheet +1", () => {
    expect(fantasyPoints(agg({ apps: 1, goals: 1, assists: 1, cleanSheets: 1 }), "MID")).toBe(1 + 5 + 3 + 1);
  });
  it("defender: clean sheet +4, conceded floored by 2", () => {
    expect(fantasyPoints(agg({ apps: 1, cleanSheets: 1 }), "DEF")).toBe(1 + 4);
    expect(fantasyPoints(agg({ apps: 1, conceded: 3 }), "DEF")).toBe(1 - 1); // floor(3/2)=1
    expect(fantasyPoints(agg({ apps: 1, goals: 1 }), "DEF")).toBe(1 + 6); // DEF goal worth 6
  });
  it("keeper: clean sheet +4, saves per 3, conceded penalty", () => {
    expect(fantasyPoints(agg({ apps: 1, cleanSheets: 1, saves: 7 }), "GK")).toBe(1 + 4 + 2); // floor(7/3)=2
    expect(fantasyPoints(agg({ apps: 1, conceded: 3, saves: 4 }), "GK")).toBe(1 - 1 + 1);
  });
  it("cards and own goals subtract", () => {
    expect(fantasyPoints(agg({ apps: 1, yellow: 1, red: 1, og: 1 }), "MID")).toBe(1 - 1 - 3 - 2);
  });
  it("empty line is zero", () => {
    expect(fantasyPoints(agg({}), "FWD")).toBe(0);
  });
});

describe("scoreBreakdown", () => {
  it("itemizes contributions", () => {
    expect(scoreBreakdown(agg({ apps: 1, goals: 2 }), "FWD")).toEqual([
      { label: "1 app", pts: 1 },
      { label: "2 goals", pts: 8 },
    ]);
    expect(scoreBreakdown(agg({ apps: 1, cleanSheets: 1 }), "DEF")).toContainEqual({
      label: "1 clean sheet",
      pts: 4,
    });
    expect(scoreBreakdown(agg({ apps: 1, conceded: 3 }), "DEF")).toContainEqual({
      label: "3 conceded",
      pts: -1,
    });
  });
  it("items sum to fantasyPoints (no bonuses)", () => {
    const a = agg({ apps: 1, goals: 1, assists: 1, cleanSheets: 1, yellow: 1 });
    for (const pos of ["GK", "DEF", "MID", "FWD"] as const) {
      const sum = scoreBreakdown(a, pos).reduce((s, i) => s + i.pts, 0);
      expect(sum).toBe(fantasyPoints(a, pos));
    }
  });
});

describe("eliminatedTeams", () => {
  it("collects losers of completed matches", () => {
    const m = (id: string, home: string, away: string, winner: string | null, state: Match["state"]): Match => ({
      id, date: "", state, statusDetail: "", round: "R32", roundLabel: "", matchNumber: 1,
      home: { id: home, name: home, abbr: home }, away: { id: away, name: away, abbr: away },
      homeScore: null, awayScore: null, winnerId: winner,
    });
    const elim = eliminatedTeams([
      m("1", "A", "B", "A", "post"),
      m("2", "C", "D", null, "in"), // not done -> nobody out
    ]);
    expect(elim.has("B")).toBe(true);
    expect(elim.has("A")).toBe(false);
    expect(elim.has("C")).toBe(false);
  });
});

// Shared fixture: Alice owns P1(FWD) + P2(MID); Bob owns P3(FWD). All score in R16 only.
const P1 = agg({ apps: 1, goals: 1 }); // FWD -> 5
const P2 = agg({ apps: 1, goals: 1 }); // MID -> 6
const P3 = agg({ apps: 1 }); // FWD -> 1
const members = [member("m1", "Alice", 1), member("m2", "Bob", 2)];
const picks = [pick("m1", "P1", "FWD"), pick("m1", "P2", "MID"), pick("m2", "P3", "FWD")];
const statsMap: Record<string, PlayerAgg> = { P1, P2, P3 };
const byRound: StatsByRound = {
  P1: { R16: { agg: P1, matchId: "a" } },
  P2: { R16: { agg: P2, matchId: "a" } },
  P3: { R16: { agg: P3, matchId: "b" } },
};

describe("computeFantasyStandings", () => {
  it("sums player lines; no bonuses by default", () => {
    const s = computeFantasyStandings(members, picks, statsMap, new Set());
    expect(s.find((x) => x.memberId === "m1")!.points).toBe(11); // 5 + 6
    expect(s.find((x) => x.memberId === "m2")!.points).toBe(1);
  });

  it("baseline only counts points earned after acquisition", () => {
    const withBaseline = [pick("m1", "P1", "FWD", { baseline: 5 }), pick("m1", "P2", "MID")];
    const s = computeFantasyStandings(members, withBaseline, statsMap, new Set());
    // P1 acquired at 5, now at 5 -> contributes 0; P2 full 6
    expect(s.find((x) => x.memberId === "m1")!.points).toBe(6);
  });

  it("dropped player's points freeze at drop_pts (banked)", () => {
    const dropped = [pick("m1", "P1", "FWD", { dropped: true, dropPts: 9 }), pick("m1", "P2", "MID")];
    const s = computeFantasyStandings(members, dropped, statsMap, new Set());
    expect(s.find((x) => x.memberId === "m1")!.points).toBe(9 + 6);
  });

  it("captain doubles the captained player's round points", () => {
    const s = computeFantasyStandings(members, picks, statsMap, new Set(), {
      byRound, captains: { m1: { R16: "P1" } },
    });
    const m1 = s.find((x) => x.memberId === "m1")!;
    expect(m1.points).toBe(16); // P1 5 + cap 5 + P2 6
    expect(m1.players.find((p) => p.playerId === "P1")!.captainBonus).toBe(5);
  });

  it("All-In doubles the whole squad that round", () => {
    const s = computeFantasyStandings(members, picks, statsMap, new Set(), {
      byRound, chips: { m1: { ALL_IN: "R16" } },
    });
    // P1 5+5, P2 6+6
    expect(s.find((x) => x.memberId === "m1")!.points).toBe(22);
  });

  it("Triple Captain triples the captain (cap + chip), only if captained that round", () => {
    const s = computeFantasyStandings(members, picks, statsMap, new Set(), {
      byRound, captains: { m1: { R16: "P1" } }, chips: { m1: { TRIPLE_CAPTAIN: "R16" } },
    });
    const m1 = s.find((x) => x.memberId === "m1")!;
    expect(m1.points).toBe(21); // P1 5 + cap5 + tc5, P2 6
    expect(m1.players.find((p) => p.playerId === "P1")!.chipBonus).toBe(5);

    const noCap = computeFantasyStandings(members, picks, statsMap, new Set(), {
      byRound, chips: { m1: { TRIPLE_CAPTAIN: "R16" } },
    });
    expect(noCap.find((x) => x.memberId === "m1")!.points).toBe(11); // TC no-op without a captain
  });

  it("chips never apply to a dropped player", () => {
    const dropped = [pick("m1", "P1", "FWD", { dropped: true, dropPts: 9 }), pick("m1", "P2", "MID")];
    const s = computeFantasyStandings(members, dropped, statsMap, new Set(), {
      byRound, chips: { m1: { ALL_IN: "R16" } },
    });
    expect(s.find((x) => x.memberId === "m1")!.points).toBe(9 + 12); // P1 banked 9, P2 6+6
  });

  it("upset multiplier boosts a round's points", () => {
    const s = computeFantasyStandings(members, picks, statsMap, new Set(), {
      byRound, upsetMult: (pid, r) => (pid === "P1" && r === "R16" ? 2 : 1),
    });
    // P1 base 5 + upset (5*(2-1))=5 -> 10; P2 6
    expect(s.find((x) => x.memberId === "m1")!.points).toBe(16);
  });

  it("eliminated flag is set but points stay banked", () => {
    const s = computeFantasyStandings(members, picks, statsMap, new Set(["tP1"]));
    const line = s.find((x) => x.memberId === "m1")!.players.find((p) => p.playerId === "P1")!;
    expect(line.eliminated).toBe(true);
    expect(line.points).toBe(5); // still counts what they earned while alive
  });
});

// Both R16 matches kick off at t=1000; picks default acquiredAt=undefined (→ owned from 0).
const matchDate = { a: 1000, b: 1000 };

describe("computeStandingsByMatch (per-match engine)", () => {
  it("sums player lines from owned matches", () => {
    const s = computeStandingsByMatch(members, picks, byRound, matchDate, new Set());
    expect(s.find((x) => x.memberId === "m1")!.points).toBe(11);
    expect(s.find((x) => x.memberId === "m2")!.points).toBe(1);
  });

  it("captain / all-in / triple-captain match the legacy engine", () => {
    const scenarios = [
      {},
      { byRound, captains: { m1: { R16: "P1" } } },
      { byRound, chips: { m1: { ALL_IN: "R16" } } },
      { byRound, captains: { m1: { R16: "P1" } }, chips: { m1: { TRIPLE_CAPTAIN: "R16" } } },
      { byRound, upsetMult: (pid: string, r: string) => (pid === "P1" && r === "R16" ? 2 : 1) },
    ];
    for (const ex of scenarios) {
      const oldS = computeFantasyStandings(members, picks, statsMap, new Set(), ex as any);
      const newS = computeStandingsByMatch(members, picks, byRound, matchDate, new Set(), ex as any);
      for (const m of members)
        expect(newS.find((x) => x.memberId === m.id)!.points).toBe(
          oldS.find((x) => x.memberId === m.id)!.points
        );
    }
  });

  it("a match that kicked off before acquisition is NOT credited", () => {
    // Alice picks up P1 at t=2000, after match a (t=1000) — so P1 scores 0 for her.
    const late = [pick("m1", "P1", "FWD", { acquiredAt: 2000 }), pick("m1", "P2", "MID", { acquiredAt: 0 })];
    const s = computeStandingsByMatch(members, late, byRound, matchDate, new Set());
    expect(s.find((x) => x.memberId === "m1")!.points).toBe(6); // P2 only
  });

  it("points earned before a drop stay banked, credited to the owner-at-kickoff", () => {
    // Alice owns P1 through the R16 match (t=1000), drops him at t=2000.
    const dropped = [
      pick("m1", "P1", "FWD", { acquiredAt: 0, releasedAt: 2000, dropped: true }),
      pick("m1", "P2", "MID", { acquiredAt: 0 }),
    ];
    const s = computeStandingsByMatch(members, dropped, byRound, matchDate, new Set());
    expect(s.find((x) => x.memberId === "m1")!.points).toBe(5 + 6); // P1 banked 5, P2 6
  });

  it("breakdown items sum to the line's points", () => {
    const s = computeStandingsByMatch(members, picks, byRound, matchDate, new Set(), { byRound });
    for (const st of s)
      for (const pl of st.players)
        expect(pl.breakdown.reduce((a, b) => a + b.pts, 0)).toBe(pl.points - pl.captainBonus - pl.chipBonus);
  });

  it("giant-killer (upset) boost is itemized so the breakdown still reconciles", () => {
    const s = computeStandingsByMatch(members, picks, byRound, matchDate, new Set(), {
      byRound,
      upsetMult: (_pid: string, r: string) => (r === "R16" ? 2 : 1),
    });
    for (const st of s)
      for (const pl of st.players)
        expect(pl.breakdown.reduce((a, b) => a + b.pts, 0)).toBe(pl.points - pl.captainBonus - pl.chipBonus);
    // P1 scored in R16 with an upset → a giant-killer line appears and doubles the raw
    const p1 = s.flatMap((x) => x.players).find((p) => p.playerId === "P1")!;
    expect(p1.breakdown.some((b) => b.label === "giant-killer")).toBe(true);
    expect(p1.points).toBe(10); // raw 5 (FWD goal) × 2
  });
});

describe("computeH2HStandings", () => {
  it("awards 3 for a round win, reflects chips", () => {
    const base = computeH2HStandings(members, picks, { byRound, captains: { m1: { R16: "P1" } } });
    const m1 = base.find((x) => x.memberId === "m1")!;
    expect(m1.wins).toBe(1); // 16 > 1
    expect(m1.points).toBe(3);
    expect(base.find((x) => x.memberId === "m2")!.losses).toBe(1);
  });

  it("All-In flows into the head-to-head round score", () => {
    const s = computeH2HStandings(members, picks, { byRound, chips: { m1: { ALL_IN: "R16" } } });
    expect(s.find((x) => x.memberId === "m1")!.wins).toBe(1);
  });
});

// The mid-tournament-draft case: a player whose match was played BEFORE you drafted them
// must not count for you — not in the Total bonuses, not in head-to-head. (Total's base is
// already handled by `baseline`; this covers the per-round terms the user caught in H2H.)
describe("acquisition gating (pre-draft matches don't count)", () => {
  // P1 (FWD): scored in R32 BEFORE acquisition (match 'pre' @ 500) and R16 AFTER ('post' @ 2000).
  const aggregate = agg({ apps: 2, goals: 2 }); // FWD: 2 + 8 = 10 total
  const byRoundG: StatsByRound = {
    P1: { R32: { agg: agg({ apps: 1, goals: 1 }), matchId: "pre" }, R16: { agg: agg({ apps: 1, goals: 1 }), matchId: "post" } },
    P3: { R16: { agg: agg({ apps: 1 }), matchId: "post2" } },
  };
  const matchDate = { pre: 500, post: 2000, post2: 2000 };
  const mem2 = [member("m1", "Alice", 1), member("m2", "Bob", 2)];
  const picksG: FantasyPickRow[] = [
    pick("m1", "P1", "FWD", { baseline: 5, acquiredAt: 1000 }), // baseline = pre-acq R32 pts (5)
    pick("m2", "P3", "FWD", { acquiredAt: 1000 }),
  ];
  const statsG: Record<string, PlayerAgg> = { P1: aggregate, P3: agg({ apps: 1 }) };

  it("total base excludes pre-acq (via baseline); captain on a pre-acq round adds no bonus", () => {
    const s = computeFantasyStandings(mem2, picksG, statsG, new Set(), {
      byRound: byRoundG, matchDate, captains: { m1: { R32: "P1" } }, // captaining the PRE-acq round
    });
    const m1 = s.find((x) => x.memberId === "m1")!;
    expect(m1.points).toBe(5); // 10 aggregate − 5 baseline; R32 captain is pre-acq → no bonus
    expect(m1.players[0].captainBonus).toBe(0);
  });

  it("captain on a post-acq round still scores", () => {
    const s = computeFantasyStandings(mem2, picksG, statsG, new Set(), {
      byRound: byRoundG, matchDate, captains: { m1: { R16: "P1" } },
    });
    expect(s.find((x) => x.memberId === "m1")!.points).toBe(10); // base 5 + R16 captain +5
  });

  it("h2h: a round whose only results predate acquisition is not played", () => {
    const h = computeH2HStandings(mem2, picksG, { byRound: byRoundG, matchDate });
    const m1 = h.find((x) => x.memberId === "m1")!;
    expect(m1.roundsPlayed).toBe(1); // R32 pre-acq → skipped; only R16 counts
    expect(m1.wins).toBe(1); // R16: m1's 5 beats m2's 1
  });

  it("without matchDate, gating is a no-op (back-compat)", () => {
    const h = computeH2HStandings(mem2, picksG, { byRound: byRoundG });
    expect(h.find((x) => x.memberId === "m1")!.roundsPlayed).toBe(2); // both rounds count
  });
});

// The 3rd-place playoff pays no draft points: a team's run ends when it loses the semi.
// (The bracket still scores 3RD — that's a prediction contract, see scoring.test.ts.)
describe("3rd-place playoff does not score for the draft", () => {
  const thirdByRound: StatsByRound = {
    P1: {
      R16: { agg: agg({ apps: 1, goals: 1 }), matchId: "a" }, // 1 + 4 = 5
      "3RD": { agg: agg({ apps: 1, goals: 3 }), matchId: "z" }, // would be 1 + 12 = 13
    },
  };
  const thirdDates = { a: 1000, z: 2000 };
  const solo = [member("m1", "A", 1)];
  const soloPicks = [pick("m1", "P1", "FWD")];

  it("a hat-trick in the 3rd-place match is worth nothing", () => {
    const s = computeStandingsByMatch(solo, soloPicks, thirdByRound, thirdDates, new Set());
    expect(s[0].points).toBe(5); // R16 only — the 13 from 3RD never lands
    const line = s[0].players.find((p) => p.playerId === "P1")!;
    expect(line.goals).toBe(1); // and it isn't shown in the line's stats either
    expect(line.apps).toBe(1);
  });

  it("the giant-killer bonus can't resurrect it", () => {
    const s = computeStandingsByMatch(solo, soloPicks, thirdByRound, thirdDates, new Set(), {
      byRound: thirdByRound,
      upsetMult: (_pid: string, r: string) => (r === "3RD" ? 3 : 1),
    });
    expect(s[0].points).toBe(5);
  });

  it("Total and H2H agree on which rounds were played", () => {
    const h = computeH2HStandings(solo, soloPicks, { byRound: thirdByRound, matchDate: thirdDates });
    expect(h[0].roundsPlayed).toBe(1); // R16 only — not 2
  });

  it("a semi-final loser is eliminated, and that is now the truth", () => {
    const sf: Match[] = [
      { id: "a", round: "SF", state: "post", winnerId: "tWin",
        home: { id: "tWin", name: "W", abbr: "W" }, away: { id: "tP1", name: "L", abbr: "L" } } as any,
    ];
    expect(eliminatedTeams(sf).has("tP1")).toBe(true);
    // ...and the flag no longer contradicts the scoring: the player really is done.
    const s = computeStandingsByMatch(solo, soloPicks, thirdByRound, thirdDates, eliminatedTeams(sf));
    expect(s[0].players[0].eliminated).toBe(true);
    expect(s[0].points).toBe(5);
  });
});
