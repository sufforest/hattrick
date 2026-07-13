// Matchday Predictions: a per-match prop slate that locks at kickoff and
// auto-scores from the final result. Winner is upset-weighted; the rest are flat.

import type {
  Match,
  OddsMap,
  PredictionPropView,
  PredictionSlateView,
  PredictionStanding,
  PropOption,
  PropType,
  PublicMember,
} from "../shared/types";
import { upsetMultiplier } from "./scoring";

interface PropDef {
  key: string;
  label: string;
  type: PropType;
  points: number;
  upset?: boolean;
  line?: number; // for over/under
}

// Pre-match slate (locks at kickoff). All gradable from the final scoreboard.
export const PRE_PROPS: PropDef[] = [
  { key: "winner", label: "Who advances", type: "side", points: 20, upset: true },
  { key: "score", label: "Exact score", type: "score", points: 50 },
  { key: "goals_ou", label: "Total goals", type: "ou", points: 15, line: 2.5 },
  { key: "btts", label: "Both teams to score", type: "yesno", points: 15 },
  { key: "to_pens", label: "Extra time / penalties", type: "yesno", points: 20 },
];

const DEF_BY_KEY = new Map(PRE_PROPS.map((d) => [d.key, d]));

// V2 leagues drop exact-score: it fully determined winner / O/U / BTTS, which let you bet
// contradictory legs (winner A + a score where A loses) and double-counted one insight.
// The rest stay — they're only soft-correlated, distinct markets, with no hard implication.
export const PROPS_V2: PropDef[] = PRE_PROPS.filter((d) => d.key !== "score");

// The prop set a league offers. New leagues are marked predV2 (the independent set);
// existing leagues have no marker → keep the original 5 props so their already-scored
// standings are never rewritten. Grading always uses the superset (DEF_BY_KEY), so any
// historical row still scores regardless of which set its league offers.
export function propsForLeague(scoring: string | null | undefined): PropDef[] {
  try {
    if (scoring && JSON.parse(scoring)?.predV2) return PROPS_V2;
  } catch {
    /* malformed scoring JSON → fall back to the legacy set */
  }
  return PRE_PROPS;
}

// The decisive winner implied by a regulation/ET score, or null for a tie — where a
// knockout goes to pens and the advancer is a separate, independent call. Used to enforce
// that a manager's winner pick agrees with their exact-score pick (no "A wins + B wins it
// 2-0" contradiction); only a tie lets them call the shootout freely.
export function scoreWinner(score: string): "home" | "away" | null {
  const m = /^(\d{1,2})-(\d{1,2})$/.exec(score.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const a = Number(m[2]);
  return h > a ? "home" : a > h ? "away" : null;
}

export function validateValue(def: PropDef, value: string): boolean {
  switch (def.type) {
    case "side":
      return value === "home" || value === "away";
    case "ou":
      return value === "over" || value === "under";
    case "yesno":
      return value === "yes" || value === "no";
    case "score":
      return /^\d{1,2}-\d{1,2}$/.test(value);
  }
}

function wentToPens(m: Match): boolean {
  return /pen|aet|extra|shootout|a\.?e\.?t/i.test(m.statusDetail || "") || (m.period ?? 0) > 2;
}

// Returns the actual outcome + whether `value` was correct, or null if the match
// isn't final yet.
function grade(
  def: PropDef,
  value: string,
  m: Match,
  odds: OddsMap
): { correct: boolean; points: number; actual: string } | null {
  if (m.state !== "post" || m.homeScore == null || m.awayScore == null || !m.winnerId) return null;
  const hs = m.homeScore;
  const as = m.awayScore;
  let actual = "";
  switch (def.key) {
    case "winner":
      actual = m.winnerId === m.home?.id ? "home" : "away";
      break;
    case "score":
      actual = `${hs}-${as}`;
      break;
    case "goals_ou":
      actual = hs + as > (def.line ?? 2.5) ? "over" : "under";
      break;
    case "btts":
      actual = hs > 0 && as > 0 ? "yes" : "no";
      break;
    case "to_pens":
      actual = wentToPens(m) ? "yes" : "no";
      break;
  }
  const correct = value === actual;
  let points = 0;
  if (correct) {
    if (def.upset) {
      const e = odds[m.id];
      const p = e ? (m.winnerId === m.home?.id ? e.pHome : e.pAway) : 0.5;
      points = Math.round(def.points * upsetMultiplier(p));
    } else {
      points = def.points;
    }
  }
  return { correct, points, actual };
}

function optionsFor(def: PropDef, m: Match, odds: OddsMap): PropOption[] | undefined {
  switch (def.type) {
    case "side": {
      // For the upset-weighted winner, show each side's potential payout from the odds, so
      // the favorite-pays-less / underdog-pays-more trade-off is visible BEFORE you pick.
      const o = odds[m.id];
      const pts = (p: number | undefined) =>
        def.upset && p != null ? Math.round(def.points * upsetMultiplier(p)) : undefined;
      return [
        { value: "home", label: m.home?.name ?? "Home", points: pts(o?.pHome) },
        { value: "away", label: m.away?.name ?? "Away", points: pts(o?.pAway) },
      ];
    }
    case "ou":
      return [
        { value: "over", label: `Over ${def.line}` },
        { value: "under", label: `Under ${def.line}` },
      ];
    case "yesno":
      return [
        { value: "yes", label: "Yes" },
        { value: "no", label: "No" },
      ];
    case "score":
      return undefined;
  }
}

function valueLabel(def: PropDef, value: string, m: Match): string {
  switch (def.type) {
    case "side":
      return value === "home" ? (m.home?.name ?? "Home") : value === "away" ? (m.away?.name ?? "Away") : value;
    case "ou":
      return value === "over" ? `Over ${def.line}` : value === "under" ? `Under ${def.line}` : value;
    case "yesno":
      return value === "yes" ? "Yes" : value === "no" ? "No" : value;
    case "score":
      return value;
  }
}

export interface RevealRow {
  prop: string;
  value: string;
  memberName: string;
}

export function buildSlateView(
  m: Match,
  odds: OddsMap,
  myPicks: Record<string, string>,
  revealRows: RevealRow[] | null,
  propDefs: PropDef[] = PRE_PROPS
): PredictionSlateView {
  const locked = m.state !== "pre";
  const graded = m.state === "post" && !!m.winnerId;

  const props: PredictionPropView[] = propDefs.map((def) => {
    const actualG = graded ? grade(def, "", m, odds) : null;
    const myVal = myPicks[def.key];
    const myG = graded && myVal != null ? grade(def, myVal, m, odds) : null;
    let reveal: PredictionPropView["reveal"];
    if (revealRows) {
      reveal = revealRows
        .filter((r) => r.prop === def.key)
        .map((r) => ({
          memberName: r.memberName,
          value: valueLabel(def, r.value, m),
          correct: graded ? (grade(def, r.value, m, odds)?.correct ?? false) : undefined,
        }));
    }
    return {
      key: def.key,
      label: def.label,
      type: def.type,
      points: def.points,
      upset: def.upset,
      options: optionsFor(def, m, odds),
      myValue: myVal,
      actual: actualG ? valueLabel(def, actualG.actual, m) : undefined,
      correct: myG?.correct,
      reveal,
    };
  });

  const myScore = graded
    ? propDefs.reduce(
        (s, def) => s + (myPicks[def.key] != null ? (grade(def, myPicks[def.key], m, odds)?.points ?? 0) : 0),
        0
      )
    : 0;

  let perMember: { memberName: string; points: number }[] | undefined;
  if (revealRows && graded) {
    const byMember = new Map<string, number>();
    for (const r of revealRows) {
      const def = DEF_BY_KEY.get(r.prop);
      if (!def) continue;
      byMember.set(r.memberName, (byMember.get(r.memberName) ?? 0) + (grade(def, r.value, m, odds)?.points ?? 0));
    }
    perMember = [...byMember.entries()]
      .map(([memberName, points]) => ({ memberName, points }))
      .sort((a, b) => b.points - a.points);
  }

  return { eventId: m.id, open: !locked, locked, graded, props, myScore, perMember };
}

export interface PredictionRow {
  memberId: string;
  eventId: string;
  prop: string;
  value: string;
}

export function computePredictionStandings(
  matches: Match[],
  members: PublicMember[],
  rows: PredictionRow[],
  odds: OddsMap
): PredictionStanding[] {
  const matchById = new Map(matches.map((m) => [m.id, m]));
  type Bucket = { points: number; correct: number; props: number };
  const agg = new Map<string, { points: number; correct: number; byMatch: Map<string, Bucket> }>();

  for (const r of rows) {
    const m = matchById.get(r.eventId);
    const def = DEF_BY_KEY.get(r.prop);
    if (!m || !def) continue;
    const g = grade(def, r.value, m, odds);
    if (!g) continue; // not final yet
    const a = agg.get(r.memberId) ?? { points: 0, correct: 0, byMatch: new Map<string, Bucket>() };
    a.points += g.points;
    if (g.correct) a.correct++;
    const bm = a.byMatch.get(r.eventId) ?? { points: 0, correct: 0, props: 0 };
    bm.points += g.points;
    if (g.correct) bm.correct++;
    bm.props++;
    a.byMatch.set(r.eventId, bm);
    agg.set(r.memberId, a);
  }

  const label = (eventId: string): string => {
    const m = matchById.get(eventId);
    return m ? `${m.home?.abbr ?? "?"} v ${m.away?.abbr ?? "?"}` : eventId;
  };

  return members
    .map((mem) => {
      const a = agg.get(mem.id) ?? { points: 0, correct: 0, byMatch: new Map<string, Bucket>() };
      const breakdown = [...a.byMatch.entries()]
        .map(([eventId, bm]) => ({ eventId, label: label(eventId), points: bm.points, correct: bm.correct, props: bm.props }))
        .sort((x, y) => y.points - x.points);
      return {
        memberId: mem.id,
        memberName: mem.name,
        points: a.points,
        correct: a.correct,
        matches: a.byMatch.size,
        breakdown,
      };
    })
    .sort((x, y) => y.points - x.points);
}
