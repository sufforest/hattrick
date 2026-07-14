import { describe, it, expect } from "vitest";
import { buildBracket, resolveMemberPicks } from "./bracket";
import type { Match, RoundCode, TeamRef } from "../shared/types";

const team = (id: string): TeamRef => ({ id, name: id, abbr: id });

let eventSeq = 0;
function match(
  round: RoundCode,
  roundLabel: string,
  matchNumber: number,
  home: TeamRef | null,
  away: TeamRef | null,
  winnerId: string | null = null,
  opts: Partial<Match> = {}
): Match {
  return {
    id: `evt-${++eventSeq}`,
    round,
    roundLabel,
    matchNumber,
    home,
    away,
    winnerId,
    state: winnerId ? "post" : "pre",
    date: "2026-07-01T00:00:00Z",
    statusDetail: winnerId ? "FT" : "Scheduled",
    homePlaceholder: undefined,
    awayPlaceholder: undefined,
    ...opts,
  };
}

// 4 R32 matches → 2 SF → 1 F + 1 3RD (proper tree, no shared children)
function buildMiniBracket(sfWinners: [string | null, string | null] = [null, null]) {
  eventSeq = 0;
  const matches: Match[] = [
    match("R32", "Round of 32", 1, team("A"), team("B"), "A"),
    match("R32", "Round of 32", 2, team("C"), team("D"), "C"),
    match("R32", "Round of 32", 3, team("E"), team("F"), "E"),
    match("R32", "Round of 32", 4, team("G"), team("H"), "G"),
    match("SF", "Semifinal", 1, null, null, sfWinners[0], {
      homePlaceholder: "Round of 32 1 Winner",
      awayPlaceholder: "Round of 32 2 Winner",
    }),
    match("SF", "Semifinal", 2, null, null, sfWinners[1], {
      homePlaceholder: "Round of 32 3 Winner",
      awayPlaceholder: "Round of 32 4 Winner",
    }),
    match("F", "Final", 1, null, null, null, {
      homePlaceholder: "Semifinal 1 Winner",
      awayPlaceholder: "Semifinal 2 Winner",
    }),
    match("3RD", "3rd Place", 1, null, null, null, {
      homePlaceholder: "Semifinal 1 Winner",
      awayPlaceholder: "Semifinal 2 Winner",
    }),
  ];
  return buildBracket(matches);
}

describe("buildBracket", () => {
  it("includes thirdPlaceKey and sets loserMatch on the 3RD slot", () => {
    const bracket = buildMiniBracket();
    expect(bracket.thirdPlaceKey).toBe("3RD-1");
    const thirdSlot = bracket.slots.find((s) => s.round === "3RD");
    expect(thirdSlot).toBeDefined();
    expect(thirdSlot!.loserMatch).toBe(true);
  });

  it("3RD slot children point to the two SF slots", () => {
    const bracket = buildMiniBracket();
    const thirdSlot = bracket.slots.find((s) => s.round === "3RD")!;
    expect(thirdSlot.childAKey).toBe("SF-1");
    expect(thirdSlot.childBKey).toBe("SF-2");
  });
});

describe("resolveMemberPicks — 3RD regression", () => {
  it("Final pick is NOT dropped when the 3rd-place slot is in the bracket", () => {
    // A won R32-1 and SF-1 → valid path to Final.
    // Regression: without the parentOf fix, byTeamRound["F:A"] is never set
    // because the walk goes SF→3RD instead of SF→F, so this pick would be dropped.
    const bracket = buildMiniBracket(["A", null]);
    const rows = [
      { slot_key: "F-1", team_id: "A", team_name: "A", updated_at: 1 },
    ];
    const { picks, dropKeys } = resolveMemberPicks(bracket, rows);
    expect(picks["F-1"]).toEqual({ teamId: "A", teamName: "A" });
    expect(dropKeys).toEqual([]);
  });

  it("3RD pick resolves when the team reaches SF but is not picked to win SF", () => {
    const bracket = buildMiniBracket();
    // A won R32-1 → reaches SF-1. User picks C to win SF-1, so A is the SF loser → eligible for 3RD.
    const rows = [
      { slot_key: "SF-1", team_id: "C", team_name: "C", updated_at: 1 },
      { slot_key: "3RD-1", team_id: "A", team_name: "A", updated_at: 2 },
    ];
    const { picks, dropKeys } = resolveMemberPicks(bracket, rows);
    expect(picks["3RD-1"]).toEqual({ teamId: "A", teamName: "A" });
    expect(dropKeys).not.toContain("3RD-1");
  });

  it("3RD pick is orphaned if the team is picked to WIN the SF", () => {
    const bracket = buildMiniBracket();
    // A won R32-1 → reaches SF-1. User picks A to WIN SF-1 — contradicts 3RD.
    const rows = [
      { slot_key: "SF-1", team_id: "A", team_name: "A", updated_at: 1 },
      { slot_key: "3RD-1", team_id: "A", team_name: "A", updated_at: 2 },
    ];
    const { picks, dropKeys } = resolveMemberPicks(bracket, rows);
    expect(picks["3RD-1"]).toBeUndefined();
    expect(dropKeys).toContain("3RD-1");
  });

  it("Final and 3RD picks coexist without interfering", () => {
    const bracket = buildMiniBracket();
    // A wins SF-1 → goes to Final. C loses SF-1 → goes to 3RD.
    const rows = [
      { slot_key: "SF-1", team_id: "A", team_name: "A", updated_at: 1 },
      { slot_key: "F-1", team_id: "A", team_name: "A", updated_at: 2 },
      { slot_key: "3RD-1", team_id: "C", team_name: "C", updated_at: 3 },
    ];
    const { picks, dropKeys } = resolveMemberPicks(bracket, rows);
    expect(picks["F-1"]).toEqual({ teamId: "A", teamName: "A" });
    expect(picks["3RD-1"]).toEqual({ teamId: "C", teamName: "C" });
    expect(dropKeys).toEqual([]);
  });
});
