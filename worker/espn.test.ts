import { describe, it, expect } from "vitest";
import { assignRounds } from "./espn";
import { buildBracket } from "./bracket";
import type { Match, RoundCode, TeamRef } from "../shared/types";
import { SCORING_ROUNDS } from "../shared/types";

const team = (id: string): TeamRef => ({ id, name: id, abbr: id });

type Raw = Omit<Match, "round" | "roundLabel" | "matchNumber">;

let seq = 0;
const raw = (
  date: string,
  home: TeamRef | null,
  away: TeamRef | null,
  winnerId: string | null = null,
  extra: Partial<Raw> = {}
): Raw => ({
  id: String(++seq),
  date,
  state: winnerId ? "post" : "pre",
  statusDetail: winnerId ? "FT" : "Scheduled",
  home,
  away,
  winnerId,
  homePlaceholder: undefined,
  awayPlaceholder: undefined,
  ...extra,
});

// A full 32-match knockout: 16 R32 + 8 R16 + 4 QF + 2 SF, then the playoff and the Final.
// Spain beat France in SF-1; Argentina beat England in SF-2. So the playoff is FRA v ENG on
// the 18th and the Final is ESP v ARG on the 19th — the real 2026 endgame.
function knockout(phase: "pending" | "resolved"): Raw[] {
  seq = 0;
  const base = Date.parse("2026-06-01T12:00:00Z");
  const at = (i: number) => new Date(base + i * 86_400_000).toISOString();
  const ms: Raw[] = [];
  for (let i = 0; i < 28; i++) {
    const h = team(`T${i}H`);
    ms.push(raw(at(i), h, team(`T${i}A`), h.id));
  }
  if (phase === "pending") {
    // Semis not played yet, so ESPN still publishes placeholder text for the tail.
    ms.push(raw(at(28), team("FRA"), team("ESP")));
    ms.push(raw(at(29), team("ENG"), team("ARG")));
    ms.push(
      raw(at(30), null, null, null, {
        homePlaceholder: "Semifinal 1 Loser",
        awayPlaceholder: "Semifinal 2 Loser",
      })
    );
    ms.push(
      raw(at(31), null, null, null, {
        homePlaceholder: "Semifinal 1 Winner",
        awayPlaceholder: "Semifinal 2 Winner",
      })
    );
  } else {
    // Both semis are in, so ESPN has swapped the real teams in and DROPPED the placeholders.
    ms.push(raw(at(28), team("FRA"), team("ESP"), "ESP"));
    ms.push(raw(at(29), team("ENG"), team("ARG"), "ARG"));
    ms.push(raw(at(30), team("FRA"), team("ENG")));
    ms.push(raw(at(31), team("ESP"), team("ARG")));
  }
  return ms;
}

const roundOf = (ms: Match[], home: string, away: string) =>
  ms.find((m) => m.home?.id === home && m.away?.id === away)?.round;

describe("assignRounds — telling the playoff from the Final", () => {
  it("uses ESPN's placeholder text while the semis are unresolved", () => {
    const ms = assignRounds(knockout("pending"), {});
    expect(ms.filter((m) => m.round === "3RD")).toHaveLength(1);
    expect(ms.filter((m) => m.round === "F")).toHaveLength(1);
  });

  // The regression. ESPN drops "Semifinal 1 Loser" the moment both semis finish, so a
  // placeholder-only test stops recognising the playoff exactly when it becomes real —
  // relabelling it "F" three days before the Final.
  it("still finds the playoff after the semis resolve and the placeholders vanish", () => {
    const ms = assignRounds(knockout("resolved"), {});
    expect(roundOf(ms, "FRA", "ENG")).toBe("3RD");
    expect(roundOf(ms, "ESP", "ARG")).toBe("F");
    expect(ms.filter((m) => m.round === "F")).toHaveLength(1); // never two Finals
  });

  it("labels every round exactly once it should", () => {
    for (const phase of ["pending", "resolved"] as const) {
      const ms = assignRounds(knockout(phase), {});
      const n = (r: string) => ms.filter((m) => m.round === r).length;
      expect([n("R32"), n("R16"), n("QF"), n("SF"), n("3RD"), n("F")]).toEqual([16, 8, 4, 2, 1, 1]);
    }
  });
});

describe("buildBracket — champKey after the semis resolve", () => {
  const bracket = () => buildBracket(assignRounds(knockout("resolved"), {}));

  it("champKey is the Final, not the playoff", () => {
    const b = bracket();
    const champ = b.slots.find((s) => s.key === b.champKey)!;
    // champKey is hardcoded "F-1", so a second "F" slot silently steals it: the playoff is
    // scheduled first, so it would sort to F-1 and crown its winner as champion.
    expect(champ.teamA?.id).toBe("ESP");
    expect(champ.teamB?.id).toBe("ARG");
    expect(champ.date.slice(0, 10)).toBe("2026-07-02"); // the later of the two
  });

  it("the playoff keeps its own slot, wired to the SF losers", () => {
    const b = bracket();
    expect(b.thirdPlaceKey).toBe("3RD-1");
    const third = b.slots.find((s) => s.key === "3RD-1")!;
    expect(third.loserMatch).toBe(true);
    expect(third.childAKey).toBe("SF-1");
    expect(third.childBKey).toBe("SF-2");
  });
});

// The per-match endpoints (/api/draft/match/:id/mine, /api/match/:id/fantasy) read raw stats
// from getMatchPlayerStats rather than the SCORING_ROUNDS-filtered byRound feed, so the filter
// never reaches them. They gate on the round directly instead — this pins that contract.
describe("SCORING_ROUNDS gates the per-match views", () => {
  it("excludes 3RD and includes every round that pays", () => {
    expect(SCORING_ROUNDS.includes("3RD" as RoundCode)).toBe(false);
    for (const r of ["R32", "R16", "QF", "SF", "F"] as RoundCode[])
      expect(SCORING_ROUNDS.includes(r)).toBe(true);
  });

  it("the playoff resolves to a non-scoring round on the real bracket shape", () => {
    const ms = assignRounds(knockout("resolved"), {});
    const playoff = ms.find((m) => m.home?.id === "FRA" && m.away?.id === "ENG")!;
    const final = ms.find((m) => m.home?.id === "ESP" && m.away?.id === "ARG")!;
    // What the endpoints compute for `scores`.
    expect(SCORING_ROUNDS.includes(playoff.round)).toBe(false); // -> no points rendered
    expect(SCORING_ROUNDS.includes(final.round)).toBe(true);
  });
});
