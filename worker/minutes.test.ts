import { describe, it, expect } from "vitest";
import { parseClockMinute, playerMinutes } from "./espn";

// Minutes-on-pitch drives the 60-minute clean-sheet rule. Cases below are the real
// France 3-0 Sweden lineup (ESPN keys each player's sub minute onto their own `plays`).
const play = (m: string) => ({ clock: { displayValue: m } });

describe("parseClockMinute", () => {
  it("reads the leading minute, ignoring stoppage", () => {
    expect(parseClockMinute("78'")).toBe(78);
    expect(parseClockMinute("90'+3'")).toBe(90);
    expect(parseClockMinute("45'+2'")).toBe(45);
  });
  it("returns null for missing/garbage", () => {
    expect(parseClockMinute(undefined)).toBeNull();
    expect(parseClockMinute("")).toBeNull();
  });
});

describe("playerMinutes", () => {
  it("full-match starter → 90", () => {
    expect(playerMinutes({ starter: true })).toBe(90); // Maignan, Saliba, Upamecano
  });
  it("starter subbed off → the minute they went off", () => {
    expect(playerMinutes({ starter: true, subbedOut: true, plays: [play("78'")] })).toBe(78); // Digne
    expect(playerMinutes({ starter: true, subbedOut: true, plays: [play("75'")] })).toBe(75); // Koundé
  });
  it("starter with other events uses their LAST play as the exit", () => {
    // Olise: goal/assist events at 53' & 74', then subbed off at 85'
    expect(
      playerMinutes({ starter: true, subbedOut: true, plays: [play("53'"), play("74'"), play("85'")] })
    ).toBe(85);
  });
  it("sub-in → time from entry to full time (too little = no clean sheet)", () => {
    expect(playerMinutes({ subbedIn: true, plays: [play("78'")] })).toBe(12); // Theo Hernández
    expect(playerMinutes({ subbedIn: true, plays: [play("66'")] })).toBe(24); // Zeneli
    expect(playerMinutes({ subbedIn: true, plays: [play("89'")] })).toBe(1); // Gustaf Nilsson
  });
  it("early sub-in that plays 60+ still qualifies", () => {
    expect(playerMinutes({ subbedIn: true, plays: [play("20'")] })).toBe(70); // ≥ 60 → clean sheet
  });
  it("sub on then off → minutes between", () => {
    expect(playerMinutes({ subbedIn: true, subbedOut: true, plays: [play("30'"), play("80'")] })).toBe(50);
  });
  it("never took the pitch → 0", () => {
    expect(playerMinutes({})).toBe(0);
    expect(playerMinutes({ plays: [] })).toBe(0);
  });
});
