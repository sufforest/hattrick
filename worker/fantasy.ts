// Player-fantasy scoring (FPL-style), driven by aggregated per-player stats.

import type {
  DraftStanding,
  FantasyPlayerLine,
  H2HStanding,
  Match,
  PlayerAgg,
  Position,
  PublicMember,
  RoundCode,
} from "../shared/types";
import { SCORING_ROUNDS } from "../shared/types";

// Per-round stats per player (what captain & the upset bonus score off).
export type StatsByRound = Record<string, Partial<Record<RoundCode, { agg: PlayerAgg; matchId: string }>>>;

export interface ScoringExtras {
  byRound?: StatsByRound;
  captains?: Record<string, Record<string, string>>; // memberId -> round -> captained playerId
  chips?: Record<string, Record<string, RoundCode>>; // memberId -> chipId -> the round it's played on
  matchDate?: Record<string, number>; // matchId -> kickoff epoch ms (for acquisition gating)
  upsetMult?: (playerId: string, round: RoundCode) => number; // >1 for an underdog win, else 1
}

const ZERO: PlayerAgg = {
  apps: 0,
  goals: 0,
  assists: 0,
  yellow: 0,
  red: 0,
  og: 0,
  saves: 0,
  conceded: 0,
  cleanSheets: 0,
};

export function fantasyPoints(a: PlayerAgg, pos: Position): number {
  let pts = a.apps; // +1 per appearance
  const goalPts = pos === "FWD" ? 4 : pos === "MID" ? 5 : 6;
  pts += a.goals * goalPts + a.assists * 3;
  if (pos === "GK" || pos === "DEF") pts += a.cleanSheets * 4 - Math.floor(a.conceded / 2);
  if (pos === "MID") pts += a.cleanSheets; // +1 per clean sheet
  if (pos === "GK") pts += Math.floor(a.saves / 3);
  pts -= a.yellow + a.red * 3 + a.og * 2;
  return pts;
}

// Itemized "what they did → points" breakdown for the standings detail. Each item's pts
// sum (plus the captain/chip bonuses, shown separately) to the player's line total.
const plural = (n: number, s: string) => `${n} ${s}${n === 1 ? "" : "s"}`;
export function scoreBreakdown(a: PlayerAgg, pos: Position): { label: string; pts: number }[] {
  const out: { label: string; pts: number }[] = [];
  if (a.apps) out.push({ label: plural(a.apps, "app"), pts: a.apps });
  if (a.goals) {
    const gp = pos === "FWD" ? 4 : pos === "MID" ? 5 : 6;
    out.push({ label: plural(a.goals, "goal"), pts: a.goals * gp });
  }
  if (a.assists) out.push({ label: plural(a.assists, "assist"), pts: a.assists * 3 });
  if (a.cleanSheets && (pos === "GK" || pos === "DEF"))
    out.push({ label: plural(a.cleanSheets, "clean sheet"), pts: a.cleanSheets * 4 });
  if (a.cleanSheets && pos === "MID")
    out.push({ label: plural(a.cleanSheets, "clean sheet"), pts: a.cleanSheets });
  if ((pos === "GK" || pos === "DEF") && Math.floor(a.conceded / 2) > 0)
    out.push({ label: `${a.conceded} conceded`, pts: -Math.floor(a.conceded / 2) });
  if (pos === "GK" && Math.floor(a.saves / 3) > 0)
    out.push({ label: plural(a.saves, "save"), pts: Math.floor(a.saves / 3) });
  if (a.yellow) out.push({ label: plural(a.yellow, "yellow card"), pts: -a.yellow });
  if (a.red) out.push({ label: plural(a.red, "red card"), pts: -a.red * 3 });
  if (a.og) out.push({ label: plural(a.og, "own goal"), pts: -a.og * 2 });
  return out;
}

export interface FantasyPickRow {
  memberId: string;
  playerId: string;
  playerName: string;
  position: Position;
  country: string;
  teamId: string;
  baseline: number; // player's accumulated pts when added to this squad
  dropped: boolean;
  dropPts: number | null; // accumulated pts at the moment dropped
  acquiredAt?: number; // epoch ms the player joined this squad (draft/transfer time)
  releasedAt?: number | null; // epoch ms the player left this squad (null = still owned)
}

// ---- Per-match attribution (the source-of-truth scoring model) ----
// Instead of subtracting cumulative-total snapshots, walk every completed match a player
// featured in, credit its points (× that owner's boost that round) to whoever owned the
// player at kickoff, and sum. This handles multi-transfer and boosts uniformly, is
// per-match FPL-accurate (saves/conceded floored per match, not across the tournament),
// and is fully auditable — each match says who got what and why.

export interface MatchAttribution {
  round: RoundCode;
  matchId: string;
  kickoff: number; // epoch ms
  raw: number; // the player's fantasy points in THIS match (per-match flooring)
  multiplier: number; // 1 = none; 2 = captain; 3 = triple captain; upset stacks additively
  ownerId: string | null; // who owned the player at kickoff (null = free agent then)
  attributed: number; // raw × multiplier credited to ownerId (0 if unowned)
}

export interface AttributionResult {
  ownerTotals: Record<string, number>; // memberId -> summed attributed points
  playerLog: Record<string, MatchAttribution[]>; // playerId -> per-match log, chronological
}

// The boost multiplier a player's points get for their owner in one round: the upset
// weighting (≥1) plus captain (+1) and, if captained under Triple Captain that round, +1
// again — matching computeFantasyStandings' additive stacking.
function roundMultiplier(
  ownerId: string,
  playerId: string,
  round: RoundCode,
  extras: ScoringExtras
): number {
  const isCap = extras.captains?.[ownerId]?.[round] === playerId;
  const memChips = extras.chips?.[ownerId];
  const tc = isCap && memChips?.["TRIPLE_CAPTAIN"] === round;
  const ai = memChips?.["ALL_IN"] === round;
  // Upset weighting only ever *boosts* (an underdog win); a favorite winning gives a
  // multiplier <1, which the standings floor to 1 — so upset never subtracts points.
  const upset = Math.max(1, extras.upsetMult?.(playerId, round) ?? 1);
  return upset + (isCap ? 1 : 0) + (tc ? 1 : 0) + (ai ? 1 : 0);
}

export function attributeByMatch(
  picks: FantasyPickRow[],
  statsByRound: StatsByRound,
  positions: Record<string, Position>,
  matchDate: Record<string, number>,
  extras: ScoringExtras = {}
): AttributionResult {
  // Ownership windows per player. A player is on at most one active squad at a time, so
  // their windows never overlap — the first spell that contains a kickoff is the owner.
  const spellsByPlayer = new Map<string, FantasyPickRow[]>();
  for (const p of picks)
    (spellsByPlayer.get(p.playerId) ?? spellsByPlayer.set(p.playerId, []).get(p.playerId)!).push(p);
  const ownerAt = (playerId: string, kickoff: number): FantasyPickRow | null => {
    for (const s of spellsByPlayer.get(playerId) ?? []) {
      const start = s.acquiredAt ?? 0;
      const end = s.releasedAt ?? Infinity;
      if (kickoff >= start && kickoff < end) return s;
    }
    return null;
  };

  const ownerTotals: Record<string, number> = {};
  const playerLog: Record<string, MatchAttribution[]> = {};

  for (const [playerId, rounds] of Object.entries(statsByRound)) {
    const pos = positions[playerId];
    if (!pos) continue;
    const log: MatchAttribution[] = [];
    for (const [round, entry] of Object.entries(rounds)) {
      // Belt-and-braces with the SCORING_ROUNDS filter on the stats feed: the rule that 3RD
      // pays nothing is a scoring rule, so it holds here too rather than depending on the
      // caller handing us pre-filtered data.
      if (!entry || !SCORING_ROUNDS.includes(round as RoundCode)) continue;
      const kickoff = matchDate[entry.matchId] ?? 0;
      const raw = fantasyPoints(entry.agg, pos);
      const spell = ownerAt(playerId, kickoff);
      let multiplier = 1;
      let attributed = 0;
      let ownerId: string | null = null;
      if (spell) {
        ownerId = spell.memberId;
        multiplier = roundMultiplier(ownerId, playerId, round as RoundCode, extras);
        attributed = Math.round(raw * multiplier);
        ownerTotals[ownerId] = (ownerTotals[ownerId] ?? 0) + attributed;
      }
      log.push({ round: round as RoundCode, matchId: entry.matchId, kickoff, raw, multiplier, ownerId, attributed });
    }
    log.sort((a, b) => a.kickoff - b.kickoff);
    playerLog[playerId] = log;
  }
  return { ownerTotals, playerLog };
}

// A player only earns for a manager from matches that kicked off AFTER they acquired them.
// (The Total table enforces this via `baseline`; the per-round bonus & head-to-head terms
// need it explicitly.) Defaults to true when we don't have the timing data, so leagues /
// tests without it score exactly as before.
function ownedDuringMatch(p: FantasyPickRow, matchId: string, extras: ScoringExtras): boolean {
  const md = extras.matchDate?.[matchId];
  if (md == null || p.acquiredAt == null) return true;
  return md >= p.acquiredAt;
}

const POS_ORDER: Record<Position, number> = { GK: 0, DEF: 1, MID: 2, FWD: 3 };

export function eliminatedTeams(matches: Match[]): Set<string> {
  const out = new Set<string>();
  for (const m of matches) {
    if (m.state === "post" && m.winnerId) {
      const loser = m.winnerId === m.home?.id ? m.away?.id : m.home?.id;
      if (loser) out.add(loser);
    }
  }
  return out;
}

export function computeFantasyStandings(
  members: PublicMember[],
  picks: FantasyPickRow[],
  statsMap: Record<string, PlayerAgg>,
  eliminated: Set<string>,
  extras: ScoringExtras = {}
): DraftStanding[] {
  const byMember = new Map<string, FantasyPickRow[]>();
  for (const p of picks) {
    const arr = byMember.get(p.memberId) ?? [];
    arr.push(p);
    byMember.set(p.memberId, arr);
  }

  // Bonus points a player earned for a member, layered on top of the base score:
  //  • upset — points in a round their team won as an underdog, × (multiplier − 1)
  //  • captain — +1× the player's points in a round this member captained them (= 2×)
  //  • Triple Captain chip — an extra +1× on the captain in its round (= 3× total)
  //  • All-In chip — +1× every player's points in its round (= 2× the whole squad)
  // Base score is unchanged, so leagues using none of these score exactly as before.
  const bonusFor = (
    memberId: string,
    p: FantasyPickRow
  ): { total: number; captain: number; chip: number } => {
    if (p.dropped) return { total: 0, captain: 0, chip: 0 }; // bonuses only apply to a currently-owned player
    const rounds = extras.byRound?.[p.playerId];
    if (!rounds) return { total: 0, captain: 0, chip: 0 };
    const capRound = extras.captains?.[memberId];
    const memChips = extras.chips?.[memberId];
    const tcRound = memChips?.["TRIPLE_CAPTAIN"];
    const aiRound = memChips?.["ALL_IN"];
    let total = 0;
    let captain = 0;
    let chip = 0;
    for (const [round, entry] of Object.entries(rounds)) {
      if (!entry) continue;
      if (!ownedDuringMatch(p, entry.matchId, extras)) continue; // pre-acquisition match — no bonus
      const roundPts = fantasyPoints(entry.agg, p.position);
      const upset = extras.upsetMult?.(p.playerId, round as RoundCode) ?? 1;
      if (upset > 1) total += roundPts * (upset - 1);
      const isCap = capRound?.[round] === p.playerId;
      if (isCap) {
        total += roundPts; // captain doubles this round
        captain += roundPts;
      }
      if (isCap && tcRound === round) {
        total += roundPts; // Triple Captain: captain ×3
        chip += roundPts;
      }
      if (aiRound === round) {
        total += roundPts; // All-In: this player ×2
        chip += roundPts;
      }
    }
    return { total: Math.round(total), captain: Math.round(captain), chip: Math.round(chip) };
  };

  const standings = members.map((mem) => {
    const mine = byMember.get(mem.id) ?? [];
    const players: FantasyPlayerLine[] = mine
      .map((p) => {
        const a = statsMap[p.playerId] ?? ZERO;
        // Snapshot: a dropped player's contribution freezes at drop; an added player
        // only earns from their baseline forward.
        const current = p.dropped ? (p.dropPts ?? 0) : fantasyPoints(a, p.position);
        const b = bonusFor(mem.id, p);
        const breakdown = p.dropped ? [] : scoreBreakdown(a, p.position);
        // Acquisition baseline shows as a deduction, so the items still add up.
        if (!p.dropped && p.baseline > 0)
          breakdown.push({ label: "before you drafted", pts: -p.baseline });
        return {
          playerId: p.playerId,
          playerName: p.playerName,
          position: p.position,
          country: p.country,
          teamId: p.teamId,
          points: current - p.baseline + b.total,
          goals: a.goals,
          assists: a.assists,
          apps: a.apps,
          eliminated: eliminated.has(p.teamId),
          dropped: p.dropped,
          captainBonus: b.captain,
          chipBonus: b.chip,
          breakdown,
        };
      })
      .sort(
        (x, y) =>
          Number(x.dropped) - Number(y.dropped) ||
          POS_ORDER[x.position] - POS_ORDER[y.position] ||
          y.points - x.points
      );
    return {
      memberId: mem.id,
      memberName: mem.name,
      points: players.reduce((s, pl) => s + pl.points, 0),
      players,
    };
  });
  return standings.sort((a, b) => b.points - a.points);
}

// Itemized breakdown summed across a set of matches — floors saves/conceded PER MATCH
// (the only non-linear terms), so the items add up to the per-match points total exactly.
function mergedBreakdown(aggs: PlayerAgg[], pos: Position): { label: string; pts: number }[] {
  let apps = 0, goals = 0, assists = 0, cleanSheets = 0, yellow = 0, red = 0, og = 0;
  let concededTotal = 0, concededPenalty = 0, saveTotal = 0, saveBonus = 0;
  for (const a of aggs) {
    apps += a.apps;
    goals += a.goals;
    assists += a.assists;
    cleanSheets += a.cleanSheets;
    yellow += a.yellow;
    red += a.red;
    og += a.og;
    concededTotal += a.conceded;
    concededPenalty += Math.floor(a.conceded / 2);
    saveTotal += a.saves;
    saveBonus += Math.floor(a.saves / 3);
  }
  const out: { label: string; pts: number }[] = [];
  if (apps) out.push({ label: plural(apps, "app"), pts: apps });
  if (goals) {
    const gp = pos === "FWD" ? 4 : pos === "MID" ? 5 : 6;
    out.push({ label: plural(goals, "goal"), pts: goals * gp });
  }
  if (assists) out.push({ label: plural(assists, "assist"), pts: assists * 3 });
  if (cleanSheets && (pos === "GK" || pos === "DEF"))
    out.push({ label: plural(cleanSheets, "clean sheet"), pts: cleanSheets * 4 });
  if (cleanSheets && pos === "MID")
    out.push({ label: plural(cleanSheets, "clean sheet"), pts: cleanSheets });
  if ((pos === "GK" || pos === "DEF") && concededPenalty > 0)
    out.push({ label: `${concededTotal} conceded`, pts: -concededPenalty });
  if (pos === "GK" && saveBonus > 0) out.push({ label: plural(saveTotal, "save"), pts: saveBonus });
  if (yellow) out.push({ label: plural(yellow, "yellow card"), pts: -yellow });
  if (red) out.push({ label: plural(red, "red card"), pts: -red * 3 });
  if (og) out.push({ label: plural(og, "own goal"), pts: -og * 2 });
  return out;
}

// The draft Total standings, computed from the per-match attribution engine (single source
// of truth). Each player line credits only the matches its owner held them for, with that
// owner's per-round boosts — so multi-transfer and captaincy are exact, and GK saves/conceded
// floor per match (FPL-correct). Reconciles with the legacy computeFantasyStandings on all
// linear cases; differs only where per-match flooring is the more accurate answer.
export function computeStandingsByMatch(
  members: PublicMember[],
  picks: FantasyPickRow[],
  byRound: StatsByRound,
  matchDate: Record<string, number>,
  eliminated: Set<string>,
  extras: ScoringExtras = {}
): DraftStanding[] {
  const positions: Record<string, Position> = {};
  for (const p of picks) positions[p.playerId] = p.position;
  const attr = attributeByMatch(picks, byRound, positions, matchDate, { ...extras, byRound });

  const byMember = new Map<string, FantasyPickRow[]>();
  for (const p of picks)
    (byMember.get(p.memberId) ?? byMember.set(p.memberId, []).get(p.memberId)!).push(p);

  const standings = members.map((mem) => {
    const mine = byMember.get(mem.id) ?? [];
    const players: FantasyPlayerLine[] = mine
      .map((p) => {
        const log = attr.playerLog[p.playerId] ?? [];
        const start = p.acquiredAt ?? 0;
        const end = p.releasedAt ?? Infinity;
        const owned = log.filter(
          (e) => e.ownerId === mem.id && e.kickoff >= start && e.kickoff < end
        );
        const aggs = owned
          .map((e) => byRound[p.playerId]?.[e.round]?.agg)
          .filter((a): a is PlayerAgg => !!a);
        let captain = 0;
        let chip = 0;
        for (const e of owned) {
          const isCap = extras.captains?.[mem.id]?.[e.round] === p.playerId;
          const memChips = extras.chips?.[mem.id];
          if (isCap) captain += e.raw;
          if (isCap && memChips?.["TRIPLE_CAPTAIN"] === e.round) chip += e.raw;
          if (memChips?.["ALL_IN"] === e.round) chip += e.raw;
        }
        const points = owned.reduce((s, e) => s + e.attributed, 0);
        const rawTotal = owned.reduce((s, e) => s + e.raw, 0);
        const captainBonus = Math.round(captain);
        const chipBonus = Math.round(chip);
        const breakdown = mergedBreakdown(aggs, p.position);
        // Whatever's left after the raw items + captain/chip is the giant-killer (upset)
        // boost — itemize it so the breakdown always sums to the line total.
        const giantKiller = points - rawTotal - captainBonus - chipBonus;
        if (giantKiller > 0) breakdown.push({ label: "giant-killer", pts: giantKiller });
        return {
          playerId: p.playerId,
          playerName: p.playerName,
          position: p.position,
          country: p.country,
          teamId: p.teamId,
          points,
          goals: aggs.reduce((s, a) => s + a.goals, 0),
          assists: aggs.reduce((s, a) => s + a.assists, 0),
          apps: aggs.reduce((s, a) => s + a.apps, 0),
          eliminated: eliminated.has(p.teamId),
          dropped: p.dropped,
          captainBonus,
          chipBonus,
          breakdown,
        };
      })
      .sort(
        (x, y) =>
          Number(x.dropped) - Number(y.dropped) ||
          POS_ORDER[x.position] - POS_ORDER[y.position] ||
          y.points - x.points
      );
    return {
      memberId: mem.id,
      memberName: mem.name,
      points: players.reduce((s, pl) => s + pl.points, 0),
      players,
    };
  });
  return standings.sort((a, b) => b.points - a.points);
}

// Head-to-head: each completed knockout round, compare every manager's points that
// round against every other manager's (captain & upset bonuses included), tally W/D/L.
export function computeH2HStandings(
  members: PublicMember[],
  picks: FantasyPickRow[],
  extras: ScoringExtras = {}
): H2HStanding[] {
  const byMember = new Map<string, FantasyPickRow[]>();
  for (const p of picks) (byMember.get(p.memberId) ?? byMember.set(p.memberId, []).get(p.memberId)!).push(p);

  // Rounds with a completed match that someone actually owned a player for — a round
  // whose only results predate the draft (pre-acquisition) hasn't been "played" for H2H.
  const playedRounds = SCORING_ROUNDS.filter((r) =>
    picks.some((p) => {
      const entry = extras.byRound?.[p.playerId]?.[r];
      return !!entry && !p.dropped && ownedDuringMatch(p, entry.matchId, extras);
    })
  );

  const roundPts = (memberId: string, round: RoundCode): number => {
    const memChips = extras.chips?.[memberId];
    const tcRound = memChips?.["TRIPLE_CAPTAIN"];
    const aiRound = memChips?.["ALL_IN"];
    let pts = 0;
    for (const p of byMember.get(memberId) ?? []) {
      if (p.dropped) continue;
      const entry = extras.byRound?.[p.playerId]?.[round];
      if (!entry) continue;
      if (!ownedDuringMatch(p, entry.matchId, extras)) continue; // pre-acquisition — doesn't count
      const base = fantasyPoints(entry.agg, p.position);
      const isCap = extras.captains?.[memberId]?.[round] === p.playerId;
      let mult = 1;
      if (isCap) mult += 1; // captain ×2
      if (isCap && tcRound === round) mult += 1; // Triple Captain ×3
      if (aiRound === round) mult += 1; // All-In: +1× for everyone this round
      const upset = extras.upsetMult?.(p.playerId, round) ?? 1;
      pts += base * mult + (upset > 1 ? base * (upset - 1) : 0);
    }
    return Math.round(pts);
  };

  const rec = new Map(members.map((m) => [m.id, { wins: 0, draws: 0, losses: 0 }]));
  for (const r of playedRounds) {
    const scores = members.map((m) => ({ id: m.id, pts: roundPts(m.id, r) }));
    for (let i = 0; i < scores.length; i++) {
      for (let j = i + 1; j < scores.length; j++) {
        const a = scores[i];
        const b = scores[j];
        const ra = rec.get(a.id)!;
        const rb = rec.get(b.id)!;
        if (a.pts > b.pts) (ra.wins++, rb.losses++);
        else if (a.pts < b.pts) (rb.wins++, ra.losses++);
        else (ra.draws++, rb.draws++);
      }
    }
  }

  return members
    .map((m) => {
      const r = rec.get(m.id)!;
      return {
        memberId: m.id,
        memberName: m.name,
        wins: r.wins,
        draws: r.draws,
        losses: r.losses,
        points: r.wins * 3 + r.draws,
        roundsPlayed: playedRounds.length,
      };
    })
    .sort((a, b) => b.points - a.points || b.wins - a.wins);
}
