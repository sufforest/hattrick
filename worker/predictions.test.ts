import { describe, it, expect } from "vitest";
import {
  computePredictionStandings,
  validateValue,
  buildSlateView,
  propsForLeague,
  scoreWinner,
  PRE_PROPS,
  PROPS_V2,
  type PredictionRow,
} from "./predictions";
import type { Match, OddsMap, PublicMember } from "../shared/types";

const member = (id: string, name: string): PublicMember => ({
  id, name, isCommissioner: false, inDraft: false, draftPosition: null,
});
const match = (o: Partial<Match>): Match => ({
  id: "m", date: "", state: "post", statusDetail: "FT", round: "R32", roundLabel: "", matchNumber: 1,
  home: { id: "X", name: "X", abbr: "X" }, away: { id: "Y", name: "Y", abbr: "Y" },
  homeScore: 2, awayScore: 1, winnerId: "X", ...o,
});
const def = (key: string) => PRE_PROPS.find((d) => d.key === key)!;

describe("validateValue", () => {
  it("accepts/rejects per prop type", () => {
    expect(validateValue(def("winner"), "home")).toBe(true);
    expect(validateValue(def("winner"), "nope")).toBe(false);
    expect(validateValue(def("score"), "2-1")).toBe(true);
    expect(validateValue(def("score"), "2")).toBe(false);
    expect(validateValue(def("goals_ou"), "over")).toBe(true);
    expect(validateValue(def("btts"), "yes")).toBe(true);
    expect(validateValue(def("btts"), "maybe")).toBe(false);
  });
});

describe("computePredictionStandings (grading)", () => {
  const members = [member("m1", "Ace"), member("m2", "Whiff")];
  const m = match({ id: "e1" }); // X 2-1 Y, FT
  const odds: OddsMap = { e1: { pHome: 0.5, pAway: 0.5 } };

  it("scores every correct prop", () => {
    const rows: PredictionRow[] = [
      { memberId: "m1", eventId: "e1", prop: "winner", value: "home" }, // X won → 20
      { memberId: "m1", eventId: "e1", prop: "score", value: "2-1" }, // → 50
      { memberId: "m1", eventId: "e1", prop: "goals_ou", value: "over" }, // 3 > 2.5 → 15
      { memberId: "m1", eventId: "e1", prop: "btts", value: "yes" }, // 2 & 1 → 15
      { memberId: "m1", eventId: "e1", prop: "to_pens", value: "no" }, // FT → 20
    ];
    const m1 = computePredictionStandings([m], members, rows, odds).find((x) => x.memberId === "m1")!;
    expect(m1.points).toBe(20 + 50 + 15 + 15 + 20);
    expect(m1.correct).toBe(5);
    expect(m1.matches).toBe(1);
  });

  it("wrong picks score 0", () => {
    const rows: PredictionRow[] = [
      { memberId: "m2", eventId: "e1", prop: "winner", value: "away" },
      { memberId: "m2", eventId: "e1", prop: "score", value: "0-0" },
    ];
    const m2 = computePredictionStandings([m], members, rows, odds).find((x) => x.memberId === "m2")!;
    expect(m2.points).toBe(0);
    expect(m2.correct).toBe(0);
  });

  it("grades a penalty shootout: to_pens=yes and winner follows the shootout result", () => {
    const pens = match({ id: "e2", homeScore: 1, awayScore: 1, winnerId: "Y", statusDetail: "FT-Pens" });
    const rows: PredictionRow[] = [
      { memberId: "m1", eventId: "e2", prop: "to_pens", value: "yes" }, // → 20
      { memberId: "m1", eventId: "e2", prop: "winner", value: "away" }, // Y won on pens → 20
    ];
    const s = computePredictionStandings([pens], members, rows, { e2: { pHome: 0.5, pAway: 0.5 } });
    expect(s.find((x) => x.memberId === "m1")!.points).toBe(40);
  });

  it("a not-yet-final match isn't graded", () => {
    const pre = match({ id: "e3", state: "pre", homeScore: null, awayScore: null, winnerId: null });
    const rows: PredictionRow[] = [{ memberId: "m1", eventId: "e3", prop: "winner", value: "home" }];
    const s = computePredictionStandings([pre], members, rows, {});
    expect(s.find((x) => x.memberId === "m1")!.matches).toBe(0);
  });
});

describe("scoreWinner (winner ↔ exact-score agreement)", () => {
  it("a decisive score implies its winner; a tie is free (pens)", () => {
    expect(scoreWinner("2-1")).toBe("home");
    expect(scoreWinner("0-2")).toBe("away");
    expect(scoreWinner("1-1")).toBe(null); // tie → shootout → advancer is a separate call
    expect(scoreWinner("0-0")).toBe(null);
    expect(scoreWinner("nonsense")).toBe(null);
  });
});

describe("prop-set gating (V2 independent card)", () => {
  it("V2 drops exact-score but keeps the independent legs", () => {
    expect(PROPS_V2.map((p) => p.key)).toEqual(["winner", "goals_ou", "btts", "to_pens"]);
    expect(PROPS_V2.some((p) => p.key === "score")).toBe(false);
  });

  it("propsForLeague: marked leagues get V2; legacy/malformed keep the original set", () => {
    expect(propsForLeague(JSON.stringify({ predV2: true })).some((p) => p.key === "score")).toBe(false);
    expect(propsForLeague(null).some((p) => p.key === "score")).toBe(true);
    expect(propsForLeague("{ not json").some((p) => p.key === "score")).toBe(true);
  });

  it("a V2 slate never offers exact-score", () => {
    const pre = match({ id: "e1", state: "pre", homeScore: null, awayScore: null, winnerId: null });
    const keys = buildSlateView(pre, {}, {}, null, PROPS_V2).props.map((p) => p.key);
    expect(keys).not.toContain("score");
    expect(keys).toContain("winner");
  });

  it("legacy rows still grade even though their league's offered set may differ", () => {
    // A historical exact-score row still scores (grading uses the superset), so existing
    // standings are never rewritten by the gating.
    const m = match({ id: "e9" }); // X 2-1 Y
    const mem = [member("m1", "Ace")];
    const rows: PredictionRow[] = [{ memberId: "m1", eventId: "e9", prop: "score", value: "2-1" }];
    const s = computePredictionStandings([m], mem, rows, { e9: { pHome: 0.5, pAway: 0.5 } });
    expect(s.find((x) => x.memberId === "m1")!.points).toBe(50);
  });
});
