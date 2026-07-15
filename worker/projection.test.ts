import { describe, it, expect } from "vitest";
import { buildBracket } from "./bracket";
import { simulateOutlook } from "./projection";
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

// 4 R32 → 2 SF → F + 3RD. A beats B, C beats D, E beats F, G beats H; then A wins SF-1
// (C out) and E wins SF-2 (G out). So the Final is A vs E and the playoff is C vs G.
function afterSemis() {
  eventSeq = 0;
  const matches: Match[] = [
    match("R32", "Round of 32", 1, team("A"), team("B"), "A"),
    match("R32", "Round of 32", 2, team("C"), team("D"), "C"),
    match("R32", "Round of 32", 3, team("E"), team("F"), "E"),
    match("R32", "Round of 32", 4, team("G"), team("H"), "G"),
    match("SF", "Semifinal", 1, team("A"), team("C"), "A"),
    match("SF", "Semifinal", 2, team("E"), team("G"), "E"),
    match("F", "Final", 1, team("A"), team("E"), null),
    match("3RD", "3rd Place", 1, team("C"), team("G"), null),
  ];
  return buildBracket(matches);
}

describe("simulateOutlook — the 3rd-place playoff is not a remaining match", () => {
  const outlook = () => simulateOutlook(afterSemis(), () => 70, {});

  it("finalists are owed exactly one match, not two", () => {
    const o = outlook();
    // The 3RD slot's children are the SF slots, whose winnerDist holds A and E — the two
    // teams that will never play it. Counting it hands each finalist a phantom match.
    expect(o.get("A")!.emr).toBe(1);
    expect(o.get("E")!.emr).toBe(1);
  });

  it("the playoff pair are owed nothing — it pays no draft points", () => {
    const o = outlook();
    expect(o.get("C")?.emr ?? 0).toBe(0);
    expect(o.get("G")?.emr ?? 0).toBe(0);
  });

  it("eliminated teams are owed nothing", () => {
    const o = outlook();
    for (const id of ["B", "D", "F", "H"]) expect(o.get(id)?.emr ?? 0).toBe(0);
  });

  it("emr stays within its documented 0..5 bound", () => {
    for (const [, v] of outlook()) {
      expect(v.emr).toBeGreaterThanOrEqual(0);
      expect(v.emr).toBeLessThanOrEqual(5);
    }
  });
});
