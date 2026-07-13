import { describe, it, expect } from "vitest";
import { computeBracketStandings, upsetMultiplier } from "./scoring";
import type { Bracket, BracketSlot, OddsMap, PublicMember, RoundCode, TeamRef } from "../shared/types";

const team = (id: string): TeamRef => ({ id, name: id, abbr: id });
const member = (id: string, name: string): PublicMember => ({
  id, name, isCommissioner: false, inDraft: false, draftPosition: null,
});
const slot = (key: string, round: RoundCode, eventId: string, winner: string | null, a: string, b: string): BracketSlot => ({
  key, round, roundLabel: round, matchNumber: 1, eventId,
  childAKey: null, childBKey: null, teamA: team(a), teamB: team(b),
  actualWinnerId: winner, state: "post", date: "", statusDetail: "FT",
});

describe("upsetMultiplier", () => {
  it("coin flip = 1.0; favorite < 1; underdog up to a cap of 3", () => {
    expect(upsetMultiplier(0.5)).toBe(1);
    expect(upsetMultiplier(0.8)).toBe(0.6);
    expect(upsetMultiplier(0.2)).toBe(2.5);
    expect(upsetMultiplier(0.01)).toBe(3); // clamped at max
    expect(upsetMultiplier(0.95)).toBe(0.5); // clamped at min
  });
});

describe("computeBracketStandings", () => {
  const bracket: Bracket = {
    champKey: "F-1",
    slots: [slot("R16-1", "R16", "e1", "A", "A", "B"), slot("F-1", "F", "ef", "X", "X", "Y")],
  };
  const members = [member("m1", "Right"), member("m2", "Wrong")];
  const picks = [
    { memberId: "m1", slotKey: "R16-1", teamId: "A", teamName: "A" }, // correct
    { memberId: "m1", slotKey: "F-1", teamId: "X", teamName: "X" }, // correct champion
    { memberId: "m2", slotKey: "R16-1", teamId: "B", teamName: "B" }, // wrong
    { memberId: "m2", slotKey: "F-1", teamId: "Y", teamName: "Y" }, // wrong
  ];
  const even: OddsMap = { e1: { pHome: 0.5, pAway: 0.5 }, ef: { pHome: 0.5, pAway: 0.5 } };

  it("scores correct picks by round, surfaces the champion, zero for misses", () => {
    const s = computeBracketStandings(bracket, members, picks, even);
    const m1 = s.find((x) => x.memberId === "m1")!;
    expect(m1.correct).toBe(2);
    expect(m1.points).toBe(20 + 160); // R16 base 20 + Final base 160 (×1 at even odds)
    expect(m1.championPick).toBe("X");
    expect(s.find((x) => x.memberId === "m2")!.points).toBe(0);
  });

  it("calling an underdog correctly earns the bonus", () => {
    const odds: OddsMap = { e1: { pHome: 0.25, pAway: 0.75 }, ef: { pHome: 0.5, pAway: 0.5 } };
    const s = computeBracketStandings(bracket, members, picks, odds);
    expect(s.find((x) => x.memberId === "m1")!.points).toBe(20 * 2 + 160); // R16 doubled (mult 2.0)
  });

  it("hides the champion when revealChampion=false", () => {
    const s = computeBracketStandings(bracket, members, picks, even, { revealChampion: false });
    expect(s.find((x) => x.memberId === "m1")!.championPick).toBe(null);
  });
});
