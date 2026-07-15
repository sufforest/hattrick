// Knockout-aware fantasy projection for the draft board.
//
//   projection(player) = bankedRealPoints + EMR(team) × expectedPointsPerMatch(player)
//
// EMR ("expected remaining matches") is the dominant term in a knockout: a player
// on the eventual finalist plays ~5 games, one on a team that exits in the Round
// of 32 plays 1. We get it by simulating the bracket tree.
//
// The strength that drives the simulation is a HYBRID (see TEAM_STRENGTH):
//   • a hand-set prior (always available, even before a ball is kicked), sharpened by
//   • frozen market odds for matches that have a closing line, and
//   • actual results — completed matches collapse to their real winner, so the tree
//     re-shapes itself every round and eliminated teams fall to EMR 0 automatically.
//
// Per-match value blends a positional baseline toward a player's *actual* points
// per appearance once they've played, so the board sharpens as the cup unfolds.

import type { Bracket, BracketSlot, OddsMap, PlayerAgg, PoolPlayer, Position } from "../shared/types";
import { fantasyPoints } from "./fantasy";
import {
  type Env,
  getFantasyStatsMap,
  getKnockoutMatches,
  getOddsMap,
  getPlayerPool,
} from "./espn";
import { buildBracket } from "./bracket";

// ---------------------------------------------------------------------------
// Team-strength PRIOR. Keyed by lowercased country name (stable across ESPN
// payloads); abbreviations are a fallback. Scale is Elo-like (~0–100). These are
// an editable opinion — bump them when FIFA rankings shift; the market-odds and
// results blend will paper over small mistakes as soon as matches start.
// ---------------------------------------------------------------------------
const TEAM_STRENGTH: Record<string, number> = {
  argentina: 92, france: 91, spain: 90, england: 89, brazil: 89,
  portugal: 86, netherlands: 85, germany: 85, italy: 84, croatia: 82,
  belgium: 82, uruguay: 81, colombia: 79, morocco: 78, switzerland: 77,
  senegal: 77, denmark: 76, japan: 76, austria: 76, norway: 76,
  mexico: 75, "united states": 75, usa: 75, turkey: 76, ukraine: 74,
  serbia: 74, ecuador: 74, poland: 74, "south korea": 73, "korea republic": 73,
  nigeria: 73, cameroon: 73, "ivory coast": 72, "cote d'ivoire": 72, australia: 72,
  canada: 72, peru: 71, paraguay: 71, egypt: 71, algeria: 73,
  ghana: 70, tunisia: 70, "south africa": 70, mali: 70, "dr congo": 70,
  venezuela: 70, chile: 70, iran: 70, "costa rica": 68, jamaica: 67,
  panama: 66, "saudi arabia": 66, uzbekistan: 65, iraq: 65, honduras: 64,
  qatar: 64, "new zealand": 62, jordan: 62, bolivia: 62, oman: 62,
  "united arab emirates": 62,
};
const ABBR_STRENGTH: Record<string, number> = {
  ARG: 92, FRA: 91, ESP: 90, ENG: 89, BRA: 89, POR: 86, NED: 85, GER: 85,
  ITA: 84, CRO: 82, BEL: 82, URU: 81, COL: 79, MAR: 78, SUI: 77, SEN: 77,
};
const DEFAULT_STRENGTH = 62;

function strengthFor(team: { name: string; abbr: string } | undefined): number {
  if (!team) return DEFAULT_STRENGTH;
  const byName = TEAM_STRENGTH[team.name.trim().toLowerCase()];
  if (byName != null) return byName;
  const byAbbr = ABBR_STRENGTH[team.abbr?.toUpperCase()];
  if (byAbbr != null) return byAbbr;
  return DEFAULT_STRENGTH;
}

// Single-match win probability from the strength gap. SCALE is deliberately wide:
// knockout football is high-variance, so even a big favourite isn't ~95% to win one game.
const SCALE = 20;
function logisticWin(ra: number, rb: number): number {
  return 1 / (1 + Math.pow(10, (rb - ra) / SCALE));
}

// ---------------------------------------------------------------------------
// Bracket simulation → expected remaining matches per team.
// ---------------------------------------------------------------------------
export interface TeamOutlook {
  emr: number; // expected remaining (not-yet-played) knockout matches, 0..5
}

type Dist = Map<string, number>; // teamId -> probability

export function simulateOutlook(
  bracket: Bracket,
  strengthOf: (teamId: string) => number,
  odds: OddsMap
): Map<string, TeamOutlook> {
  // winnerDist[slot] = prob each team WINS (advances out of) that slot.
  const winnerDist = new Map<string, Dist>();
  const emr = new Map<string, number>();
  const addEmr = (id: string, v: number) => emr.set(id, (emr.get(id) ?? 0) + v);

  // Probability team A beats team B in a specific slot's match: prefer a frozen
  // market line for the actual fixture, else the strength model.
  const winProb = (slot: BracketSlot, aId: string, bId: string): number => {
    const o = odds[slot.eventId];
    if (o && slot.teamA && slot.teamB) {
      if (aId === slot.teamA.id && bId === slot.teamB.id) return o.pHome;
      if (aId === slot.teamB.id && bId === slot.teamA.id) return o.pAway;
    }
    return logisticWin(strengthOf(aId), strengthOf(bId));
  };

  // Who enters this slot on each side, and with what probability.
  const sideEntrants = (childKey: string | null, leafTeam: { id: string } | null): Dist => {
    if (childKey) return winnerDist.get(childKey) ?? new Map();
    return leafTeam ? new Map([[leafTeam.id, 1]]) : new Map();
  };

  // bracket.slots is ordered R32 → F, then 3RD last, so every slot's children are already solved.
  for (const slot of bracket.slots) {
    const entA = sideEntrants(slot.childAKey, slot.teamA);
    const entB = sideEntrants(slot.childBKey, slot.teamB);

    // EMR: a not-yet-played match adds, for each participant, P(they reach it). The 3rd-place
    // playoff is skipped: it pays no draft points (SCORING_ROUNDS), so it adds no expected
    // points, and its children are the SF slots — whose winnerDist holds the two FINALISTS,
    // i.e. exactly the teams that will never play it. Feeding that in would hand both
    // finalists a phantom match and push emr past its 0..5 bound.
    if (slot.state !== "post" && !slot.loserMatch) {
      for (const [id, p] of entA) addEmr(id, p);
      for (const [id, p] of entB) addEmr(id, p);
    }

    // winnerDist for this slot.
    const dist: Dist = new Map();
    if (slot.state === "post" && slot.actualWinnerId) {
      dist.set(slot.actualWinnerId, 1); // result is in — collapse to certainty
    } else {
      for (const [aId, pa] of entA) {
        for (const [bId, pb] of entB) {
          const w = winProb(slot, aId, bId);
          dist.set(aId, (dist.get(aId) ?? 0) + pa * pb * w);
          dist.set(bId, (dist.get(bId) ?? 0) + pa * pb * (1 - w));
        }
      }
    }
    winnerDist.set(slot.key, dist);
  }

  const out = new Map<string, TeamOutlook>();
  for (const [id, v] of emr) out.set(id, { emr: v });
  return out;
}

// ---------------------------------------------------------------------------
// Per-match value: positional baseline, scaled by team strength, blended toward
// the player's real scoring rate once they've actually appeared.
// ---------------------------------------------------------------------------
const PPM_BASELINE: Record<Position, number> = { GK: 2.4, DEF: 2.5, MID: 3.0, FWD: 3.3 };

function teamFactor(strength: number): number {
  // Stronger sides win more, keep more clean sheets, and create more — nudge ±.
  return Math.min(1.3, Math.max(0.75, 0.85 + (strength - 70) / 100));
}

function expectedPpm(pos: Position, strength: number, agg: PlayerAgg | undefined): number {
  const base = PPM_BASELINE[pos] * teamFactor(strength);
  if (agg && agg.apps > 0) {
    const actual = fantasyPoints(agg, pos) / agg.apps;
    const w = Math.min(agg.apps, 3) / 3; // trust the real rate fully after 3 apps
    return actual * w + base * (1 - w);
  }
  return base;
}

// ---------------------------------------------------------------------------
// Public entry point: the player pool, enriched with proj / projMatches / tier.
// ---------------------------------------------------------------------------
export async function getProjectedPool(env: Env): Promise<PoolPlayer[]> {
  const [pool, matches, odds, stats] = await Promise.all([
    getPlayerPool(env),
    getKnockoutMatches(env),
    getOddsMap(env),
    getFantasyStatsMap(env),
  ]);
  if (pool.length === 0) return pool;

  const teamById = new Map<string, PoolPlayer["team"]>();
  for (const p of pool) teamById.set(p.team.id, p.team);
  const strengthOf = (teamId: string) => strengthFor(teamById.get(teamId));

  const outlook = simulateOutlook(buildBracket(matches), strengthOf, odds);

  const projected = pool.map((p) => {
    const emr = outlook.get(p.team.id)?.emr ?? 0;
    const agg = stats[p.id];
    const banked = agg ? fantasyPoints(agg, p.position) : 0;
    const ppm = expectedPpm(p.position, strengthOf(p.team.id), agg);
    const proj = banked + emr * ppm;
    return { ...p, proj: Math.round(proj * 10) / 10, projMatches: Math.round(emr * 10) / 10 };
  });

  // Tiers by projection quantile across the whole pool, so the stars reflect true
  // draft value (a finalist's keeper outranks a minnow's striker — as it should).
  const sorted = projected.map((p) => p.proj!).sort((a, b) => a - b);
  const quantile = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  const t3 = quantile(0.85);
  const t2 = quantile(0.5);
  for (const p of projected) p.tier = p.proj! >= t3 ? 3 : p.proj! >= t2 ? 2 : 1;

  return projected;
}
