// Scoring engines for the games. Everything is weighted by an "upset factor"
// from the market closing line so that beating expectations — not just picking
// favorites — is what scores. Skill = beating the odds, not my opinion.

import type {
  Bracket,
  BracketStanding,
  DraftStanding,
  Match,
  OddsMap,
  PublicMember,
  RoundCode,
} from "../shared/types";

// Advancing a round, scaled so the upset multiplier yields satisfying integers.
const ADVANCE_POINTS: Record<RoundCode, number> = {
  R32: 30,
  R16: 50,
  QF: 80,
  SF: 130,
  F: 210,
  "3RD": 0,
};
const GOAL_POINTS = 10; // flat per goal (goals are goals)

// Bracket: correctly calling a winner, by round.
const BRACKET_POINTS: Record<RoundCode, number> = {
  R32: 10,
  R16: 20,
  QF: 40,
  SF: 80,
  F: 160,
  "3RD": 0,
};
export const BRACKET_MAX = 800; // "par" if you nailed every pick at base value (upsets push above)

// Map a winner's market win-probability to a multiplier:
//   heavy favorite (~0.8) -> 0.6x   coin flip (0.5) -> 1.0x   big underdog (0.2) -> 2.5x
export function upsetMultiplier(pWinner: number): number {
  const m = 0.5 / Math.max(pWinner, 0.05);
  return Math.min(3, Math.max(0.5, Math.round(m * 10) / 10));
}

function matchWinnerProb(odds: OddsMap, m: Match): number {
  const e = odds[m.id];
  if (!e || !m.winnerId) return 0.5;
  return m.winnerId === m.home?.id ? e.pHome : e.pAway;
}

function slotWinnerProb(odds: OddsMap, slot: Bracket["slots"][number]): number {
  const e = odds[slot.eventId];
  if (!e || !slot.actualWinnerId) return 0.5;
  return slot.actualWinnerId === slot.teamA?.id ? e.pHome : e.pAway;
}

export interface DraftPickRow {
  memberId: string;
  teamId: string;
  teamName: string;
}

export function computeDraftStandings(
  matches: Match[],
  members: PublicMember[],
  picks: DraftPickRow[],
  odds: OddsMap
): DraftStanding[] {
  const completed = matches.filter((m) => m.state === "post" && m.winnerId);

  const teamGoals = new Map<string, number>();
  const teamWins = new Map<string, number>();
  const teamPoints = new Map<string, number>();
  const eliminated = new Set<string>();

  for (const m of completed) {
    if (m.home && m.homeScore != null) {
      teamGoals.set(m.home.id, (teamGoals.get(m.home.id) ?? 0) + m.homeScore);
      teamPoints.set(m.home.id, (teamPoints.get(m.home.id) ?? 0) + m.homeScore * GOAL_POINTS);
    }
    if (m.away && m.awayScore != null) {
      teamGoals.set(m.away.id, (teamGoals.get(m.away.id) ?? 0) + m.awayScore);
      teamPoints.set(m.away.id, (teamPoints.get(m.away.id) ?? 0) + m.awayScore * GOAL_POINTS);
    }
    // Advancing is worth more the bigger the upset.
    const mult = upsetMultiplier(matchWinnerProb(odds, m));
    const adv = (ADVANCE_POINTS[m.round] ?? 0) * mult;
    teamWins.set(m.winnerId!, (teamWins.get(m.winnerId!) ?? 0) + 1);
    teamPoints.set(m.winnerId!, (teamPoints.get(m.winnerId!) ?? 0) + adv);
    const loserId = m.winnerId === m.home?.id ? m.away?.id : m.home?.id;
    if (loserId) eliminated.add(loserId);
  }

  const byMember = new Map<string, DraftPickRow[]>();
  for (const p of picks) {
    const arr = byMember.get(p.memberId) ?? [];
    arr.push(p);
    byMember.set(p.memberId, arr);
  }

  const standings: DraftStanding[] = members.map((mem) => {
    const myPicks = byMember.get(mem.id) ?? [];
    const teams = myPicks.map((p) => ({
      teamId: p.teamId,
      teamName: p.teamName,
      eliminated: eliminated.has(p.teamId),
      points: Math.round(teamPoints.get(p.teamId) ?? 0),
    }));
    return {
      memberId: mem.id,
      memberName: mem.name,
      teams: teams.sort((a, b) => b.points - a.points),
      goals: myPicks.reduce((s, p) => s + (teamGoals.get(p.teamId) ?? 0), 0),
      wins: myPicks.reduce((s, p) => s + (teamWins.get(p.teamId) ?? 0), 0),
      points: teams.reduce((s, t) => s + t.points, 0),
    };
  });

  return standings.sort((a, b) => b.points - a.points);
}

export interface BracketPickRow {
  memberId: string;
  slotKey: string;
  teamId: string;
  teamName: string;
}

export function computeBracketStandings(
  bracket: Bracket,
  members: PublicMember[],
  picks: BracketPickRow[],
  odds: OddsMap,
  opts: { revealChampion?: boolean } = {}
): BracketStanding[] {
  const revealChampion = opts.revealChampion !== false;
  const slotByKey = new Map(bracket.slots.map((s) => [s.key, s]));

  const byMember = new Map<string, BracketPickRow[]>();
  for (const p of picks) {
    const arr = byMember.get(p.memberId) ?? [];
    arr.push(p);
    byMember.set(p.memberId, arr);
  }

  const standings: BracketStanding[] = members.map((mem) => {
    const myPicks = byMember.get(mem.id) ?? [];
    let points = 0;
    let correct = 0;
    let championPick: string | null = null;
    for (const p of myPicks) {
      const slot = slotByKey.get(p.slotKey);
      if (!slot) continue;
      if (p.slotKey === bracket.champKey) championPick = p.teamName;
      if (slot.actualWinnerId && slot.actualWinnerId === p.teamId) {
        correct++;
        // Correct chalk = full base; correctly calling an underdog earns the bonus.
        const bonus = Math.max(1, upsetMultiplier(slotWinnerProb(odds, slot)));
        points += Math.round((BRACKET_POINTS[slot.round] ?? 0) * bonus);
      }
    }
    return {
      memberId: mem.id,
      memberName: mem.name,
      correct,
      points,
      maxPossible: BRACKET_MAX,
      championPick: revealChampion ? championPick : null,
    };
  });

  return standings.sort((a, b) => b.points - a.points);
}
