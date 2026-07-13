import { describe, it, expect } from "vitest";
import { attributeByMatch, type FantasyPickRow, type StatsByRound } from "./fantasy";
import type { PlayerAgg, Position } from "../shared/types";

const agg = (o: Partial<PlayerAgg>): PlayerAgg => ({
  apps: 0, goals: 0, assists: 0, yellow: 0, red: 0, og: 0, saves: 0, conceded: 0, cleanSheets: 0, ...o,
});

// Three staggered matches, one per round.
const matchDate = { m32: 1000, m16: 2000, mqf: 3000 };
// A MID who plays all three: R32 goal (6), R16 app only (1), QF goal (6).
const midByRound: StatsByRound = {
  P: {
    R32: { agg: agg({ apps: 1, goals: 1 }), matchId: "m32" },
    R16: { agg: agg({ apps: 1 }), matchId: "m16" },
    QF: { agg: agg({ apps: 1, goals: 1 }), matchId: "mqf" },
  },
};
const pos: Record<string, Position> = { P: "MID" };
const spell = (o: Partial<FantasyPickRow>): FantasyPickRow => ({
  memberId: "A", playerId: "P", playerName: "P", position: "MID", country: "X", teamId: "t",
  baseline: 0, dropped: false, dropPts: null, ...o,
});

describe("attributeByMatch", () => {
  it("owned throughout → owner banks every match", () => {
    const r = attributeByMatch([spell({ acquiredAt: 0, releasedAt: null })], midByRound, pos, matchDate);
    expect(r.ownerTotals.A).toBe(6 + 1 + 6);
    expect(r.playerLog.P).toHaveLength(3);
    expect(r.playerLog.P.every((m) => m.ownerId === "A")).toBe(true);
  });

  it("acquired mid-tournament → pre-acquisition matches are NOT banked (the Porro case)", () => {
    // Acquired at 1500: misses R32 (1000), owns R16 (2000) + QF (3000).
    const r = attributeByMatch([spell({ acquiredAt: 1500, releasedAt: null })], midByRound, pos, matchDate);
    expect(r.ownerTotals.A).toBe(1 + 6); // 7, not the player's full 13
    const r32 = r.playerLog.P.find((m) => m.round === "R32")!;
    expect(r32.ownerId).toBeNull(); // free agent then
    expect(r32.attributed).toBe(0);
    expect(r32.raw).toBe(6); // the goal still shows in his log, just credited to nobody
  });

  it("multi-transfer → each owner banks only their window", () => {
    const picks: FantasyPickRow[] = [
      spell({ memberId: "A", acquiredAt: 0, releasedAt: 1500, dropped: true }),
      spell({ memberId: "B", acquiredAt: 1500, releasedAt: null }),
    ];
    const r = attributeByMatch(picks, midByRound, pos, matchDate);
    expect(r.ownerTotals.A).toBe(6); // R32 only
    expect(r.ownerTotals.B).toBe(1 + 6); // R16 + QF
    // sum across owners = the player's whole production
    expect(r.ownerTotals.A + r.ownerTotals.B).toBe(13);
  });

  it("captain doubles only the captained round, for the owner of that round", () => {
    const r = attributeByMatch([spell({ acquiredAt: 0, releasedAt: null })], midByRound, pos, matchDate, {
      captains: { A: { R16: "P" } },
    });
    expect(r.ownerTotals.A).toBe(6 + 1 * 2 + 6); // R16 doubled
    expect(r.playerLog.P.find((m) => m.round === "R16")!.multiplier).toBe(2);
  });

  it("upset weighting only boosts — a winning favorite (mult<1) is floored to 1×, never penalized", () => {
    const favWon = attributeByMatch([spell({ acquiredAt: 0, releasedAt: null })], midByRound, pos, matchDate, {
      upsetMult: () => 0.6, // favorite winning
    });
    expect(favWon.ownerTotals.A).toBe(6 + 1 + 6); // unchanged, not scaled down
    const underdogWon = attributeByMatch([spell({ acquiredAt: 0, releasedAt: null })], midByRound, pos, matchDate, {
      upsetMult: (_p, r) => (r === "R32" ? 2 : 1), // R32 upset → double
    });
    expect(underdogWon.ownerTotals.A).toBe(6 * 2 + 1 + 6);
  });

  it("GK saves/conceded floor PER MATCH, not aggregated across the tournament", () => {
    // Concedes 1 each in two matches: per-match floor(1/2)=0 → no penalty (total 2 apps).
    // The old aggregate model would floor(2/2)=1 and dock a point. This is the divergence.
    const gkByRound: StatsByRound = {
      G: {
        R32: { agg: agg({ apps: 1, conceded: 1 }), matchId: "m32" },
        R16: { agg: agg({ apps: 1, conceded: 1 }), matchId: "m16" },
      },
    };
    const r = attributeByMatch(
      [spell({ playerId: "G", position: "GK", acquiredAt: 0, releasedAt: null })],
      gkByRound,
      { G: "GK" },
      matchDate
    );
    expect(r.ownerTotals.A).toBe(2); // 1 + 1, no conceded penalty
  });
});
