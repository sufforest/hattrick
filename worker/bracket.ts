// Builds the knockout bracket tree from normalized matches, resolving each
// higher-round slot's two feeder slots from ESPN's "Round of X N Winner"
// placeholders (and from real teams once results are in).
// The 3rd-place playoff is fed by the LOSERS of the two semifinals.

import type { Bracket, BracketSlot, Match, RoundCode } from "../shared/types";

const LOWER: Partial<Record<RoundCode, RoundCode>> = {
  R16: "R32",
  QF: "R16",
  SF: "QF",
  F: "SF",
  "3RD": "SF",
};

function parsePlaceholder(s: string | undefined): { rc: RoundCode; n: number } | null {
  if (!s) return null;
  let m: RegExpMatchArray | null;
  if ((m = s.match(/Round of 32\s+(\d+)/i))) return { rc: "R32", n: +m[1] };
  if ((m = s.match(/Round of 16\s+(\d+)/i))) return { rc: "R16", n: +m[1] };
  if ((m = s.match(/Quarterfinal\s+(\d+)/i))) return { rc: "QF", n: +m[1] };
  if ((m = s.match(/Semifinal\s+(\d+)/i))) return { rc: "SF", n: +m[1] };
  return null;
}

export function buildBracket(matches: Match[]): Bracket {
  // Index slots by `${round}-${matchNumber}` so we can resolve children by key.
  const byKey = new Map<string, Match>();
  for (const m of matches) byKey.set(`${m.round}-${m.matchNumber}`, m);

  // For resolving real teams back to the slot they won.
  const winnerToKey = new Map<string, string>(); // `${round}:${teamId}` -> slotKey
  for (const m of matches) {
    if (m.winnerId) winnerToKey.set(`${m.round}:${m.winnerId}`, `${m.round}-${m.matchNumber}`);
  }
  // For 3RD: map losers back to their SF slot.
  const loserToKey = new Map<string, string>(); // `${round}:${teamId}` -> slotKey
  for (const m of matches) {
    if (m.winnerId) {
      const loserId = m.winnerId === m.home?.id ? m.away?.id : m.home?.id;
      if (loserId) loserToKey.set(`${m.round}:${loserId}`, `${m.round}-${m.matchNumber}`);
    }
  }

  function resolveChild(
    round: RoundCode,
    realTeamId: string | null,
    placeholder: string | undefined,
    isLoserMatch: boolean
  ): string | null {
    const lower = LOWER[round];
    if (!lower) return null; // R32 leaf
    const ph = parsePlaceholder(placeholder);
    if (ph) return `${ph.rc}-${ph.n}`;
    if (realTeamId) {
      // For loser matches (3RD), the team feeding in is the LOSER of the child slot.
      const lookupMap = isLoserMatch ? loserToKey : winnerToKey;
      const k = lookupMap.get(`${lower}:${realTeamId}`);
      if (k) return k;
    }
    return null;
  }

  const order: RoundCode[] = ["R32", "R16", "QF", "SF", "F", "3RD"];
  const slots: BracketSlot[] = [];
  let thirdPlaceKey: string | null = null;

  for (const round of order) {
    const inRound = matches
      .filter((m) => m.round === round)
      .sort((a, b) => a.matchNumber - b.matchNumber);
    for (const m of inRound) {
      const isLoserMatch = round === "3RD";
      const key = `${round}-${m.matchNumber}`;
      if (isLoserMatch) thirdPlaceKey = key;
      slots.push({
        key,
        round,
        roundLabel: m.roundLabel,
        matchNumber: m.matchNumber,
        eventId: m.id,
        childAKey: resolveChild(round, m.home?.id ?? null, m.homePlaceholder, isLoserMatch),
        childBKey: resolveChild(round, m.away?.id ?? null, m.awayPlaceholder, isLoserMatch),
        teamA: m.home,
        teamB: m.away,
        actualWinnerId: m.winnerId,
        state: m.state,
        date: m.date,
        statusDetail: m.statusDetail,
        ...(isLoserMatch ? { loserMatch: true } : {}),
      });
    }
  }

  return { slots, champKey: "F-1", thirdPlaceKey };
}

const PLAY_ROUNDS: RoundCode[] = ["R32", "R16", "QF", "SF", "F"];

interface BracketIndex {
  // Re-home a persisted key onto the CURRENT bracket. Returns null if the team isn't
  // placeable in that round (stale/garbage row).
  resolveKey: (storedKey: string, teamId: string) => string | null;
  teamSlotAt: (round: string, teamId: string) => string | undefined; // team's slot at a round
  winnerOf: (slotKey: string) => string | null; // real result winner, if decided
  loserOf: (slotKey: string) => string | null; // real result loser, if decided
  roundOf: (slotKey: string) => RoundCode | undefined;
  isLoserMatch: (slotKey: string) => boolean;
}

function indexBracket(bracket: Bracket): BracketIndex {
  const slotByKey = new Map(bracket.slots.map((s) => [s.key, s]));
  const parentOf = new Map<string, string>();
  for (const s of bracket.slots) {
    if (s.childAKey) parentOf.set(s.childAKey, s.key);
    if (s.childBKey) parentOf.set(s.childBKey, s.key);
  }
  // team:round -> current slot key, by walking each R32 leaf up its parent chain.
  const byTeamRound = new Map<string, string>();
  for (const s of bracket.slots) {
    if (s.round !== "R32") continue;
    for (const t of [s.teamA, s.teamB]) {
      if (!t) continue;
      let key: string | null = s.key;
      while (key) {
        byTeamRound.set(`${slotByKey.get(key)!.round}:${t.id}`, key);
        key = parentOf.get(key) ?? null;
      }
    }
  }
  return {
    resolveKey: (storedKey, teamId) => {
      // A positional key like "R32-4" is a POSITION, not an identity: ESPN re-numbering
      // silently re-points it. Trust only its round and re-home by the immutable team.
      const m = /^(R32|R16|QF|SF|F|3RD)-\d+$/.exec(storedKey);
      if (m) return byTeamRound.get(`${m[1]}:${teamId}`) ?? null;
      // Otherwise it's already an immutable id (eventId) — map it to its slot.
      return slotByKey.has(storedKey)
        ? storedKey
        : bracket.slots.find((s) => s.eventId === storedKey)?.key ?? null;
    },
    teamSlotAt: (round, teamId) => byTeamRound.get(`${round}:${teamId}`),
    winnerOf: (slotKey) => slotByKey.get(slotKey)?.actualWinnerId ?? null,
    loserOf: (slotKey) => {
      const s = slotByKey.get(slotKey);
      if (!s?.actualWinnerId) return null;
      const loserId = s.actualWinnerId === s.teamA?.id ? s.teamB?.id : s.teamA?.id;
      return loserId ?? null;
    },
    roundOf: (slotKey) => slotByKey.get(slotKey)?.round,
    isLoserMatch: (slotKey) => !!slotByKey.get(slotKey)?.loserMatch,
  };
}

export interface ResolvedPicks {
  picks: Record<string, { teamId: string; teamName: string }>; // current slotKey -> pick
  dropKeys: string[]; // raw stored slot_key values that are stale/orphaned (safe to delete)
}

// Resolve a member's stored bracket rows against the CURRENT bracket:
//  1. re-home legacy positional keys by (round, team) — no migration needed, and makes
//     any future re-numbering inert;
//  2. keep the latest pick per slot (dedupe);
//  3. prune PATH-ORPHANS — a pick whose team can't actually reach that slot given the
//     member's own earlier-round picks (or real results). This bracket propagates, so a
//     later pick implies the whole path below it; revising an early pick (or a misclick)
//     can otherwise strand a contradictory later one (e.g. a QF pick for a team your R16
//     pick just knocked out). Such picks are dropped so the bracket stays consistent.
//  4. For the 3RD-place slot: the team must reach SF (supported through R32→QF) and must
//     NOT be the user's SF winner pick or the actual SF winner (they go to the Final,
//     not 3rd place).
// `dropKeys` lets the caller delete the underlying rows; reads can just use `picks`.
export function resolveMemberPicks(
  bracket: Bracket,
  rows: { slot_key: string; team_id: string; team_name: string; updated_at: number }[]
): ResolvedPicks {
  const ix = indexBracket(bracket);
  const sorted = [...rows].sort((a, b) => a.updated_at - b.updated_at);
  const dropKeys: string[] = [];

  // Resolve + dedupe (latest write wins per slot).
  const bySlot = new Map<string, { teamId: string; teamName: string; raw: string }>();
  for (const r of sorted) {
    const k = ix.resolveKey(r.slot_key, r.team_id);
    if (!k) {
      dropKeys.push(r.slot_key);
      continue;
    }
    const prev = bySlot.get(k);
    if (prev) dropKeys.push(prev.raw); // superseded duplicate
    bySlot.set(k, { teamId: r.team_id, teamName: r.team_name, raw: r.slot_key });
  }

  // Prune path-orphans: every lower round on the team's path must have that team
  // picked, or have actually advanced them.
  for (const [slot, v] of [...bySlot]) {
    const round = ix.roundOf(slot);

    // 3RD-place: the team must have reached SF (picked or won through R32→QF),
    // and must NOT be the user's SF winner pick or the actual SF winner on their side.
    if (round === "3RD") {
      // Must be supported through R32, R16, QF (same as a normal SF-bound team).
      const sfSlot = ix.teamSlotAt("SF", v.teamId);
      let orphan = false;
      for (let r = 0; r < 3; r++) {
        // R32=0, R16=1, QF=2
        const lower = ix.teamSlotAt(PLAY_ROUNDS[r], v.teamId);
        if (!lower) continue;
        const lp = bySlot.get(lower);
        const supported = (lp && lp.teamId === v.teamId) || ix.winnerOf(lower) === v.teamId;
        if (!supported) {
          orphan = true;
          break;
        }
      }
      // Must NOT be picked to WIN the SF on their side (if they win SF, they're in the Final).
      if (!orphan && sfSlot) {
        const sfPick = bySlot.get(sfSlot);
        if (sfPick && sfPick.teamId === v.teamId) orphan = true;
        // Also orphan if they actually won the SF (they're in the Final, not 3rd place).
        if (ix.winnerOf(sfSlot) === v.teamId) orphan = true;
      }
      if (orphan) {
        dropKeys.push(v.raw);
        bySlot.delete(slot);
      }
      continue;
    }

    // Standard bracket path validation for R32→F.
    const ri = PLAY_ROUNDS.indexOf(round!);
    for (let r = 0; r < ri; r++) {
      const lower = ix.teamSlotAt(PLAY_ROUNDS[r], v.teamId);
      if (!lower) continue;
      const lp = bySlot.get(lower);
      const supported = (lp && lp.teamId === v.teamId) || ix.winnerOf(lower) === v.teamId;
      if (!supported) {
        dropKeys.push(v.raw);
        bySlot.delete(slot);
        break;
      }
    }
  }

  const picks: Record<string, { teamId: string; teamName: string }> = {};
  for (const [k, v] of bySlot) picks[k] = { teamId: v.teamId, teamName: v.teamName };
  return { picks, dropKeys };
}
