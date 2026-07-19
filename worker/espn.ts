// ESPN (unofficial, free) data client for the 2026 FIFA World Cup, with a
// tiny D1-backed cache so we don't hammer ESPN. This is the heart of the
// "serverless data update" model: we fetch lazily on request and cache briefly.

import type {
  Match,
  MatchDetail,
  MatchState,
  RoundCode,
  TeamRef,
  CommentaryItem,
  KeyEvent,
  TeamLineup,
  PoolPlayer,
  Position,
  PlayerAgg,
} from "../shared/types";
import { SCORING_ROUNDS } from "../shared/types";

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
}

const BASE = "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world";
const UA = "Mozilla/5.0 (Hattrick WorldCup app)";

// The knockout stage window (R32 begins Jun 28; Final is Jul 19). One ranged
// request returns exactly the 32 knockout fixtures — the group stage (which
// ends Jun 27) is intentionally excluded so the positional round grouping holds.
const KNOCKOUT_RANGE = "20260628-20260720";

// ---------- D1 cache ----------

async function cacheGet<T>(env: Env, key: string): Promise<T | null> {
  const row = await env.DB.prepare(
    "SELECT value, expires_at FROM cache WHERE key = ?"
  )
    .bind(key)
    .first<{ value: string; expires_at: number }>();
  if (!row) return null;
  if (row.expires_at < Date.now()) return null;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return null;
  }
}

async function cacheSet(env: Env, key: string, value: unknown, ttlMs: number) {
  const expires = Date.now() + ttlMs;
  await env.DB.prepare(
    "INSERT INTO cache (key, value, expires_at) VALUES (?, ?, ?) " +
      "ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at"
  )
    .bind(key, JSON.stringify(value), expires)
    .run();
}

async function espnFetch(path: string): Promise<any> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "User-Agent": UA, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`ESPN ${path} -> ${res.status}`);
  return res.json();
}

// ESPN's "core" API exposes a per-event `matchNumber` that the lightweight
// scoreboard endpoint omits. We need it because the bracket's parent slots refer
// to feeders as "Round of 32 N Winner", and N is ESPN's match-number ordering —
// not kickoff order. See getMatchNumberMap.
const CORE_BASE = "https://sports.core.api.espn.com/v2/sports/soccer/leagues/fifa.world";

async function espnCoreFetch(path: string): Promise<any> {
  const res = await fetch(`${CORE_BASE}${path}`, {
    headers: { "User-Agent": UA, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`ESPN core ${path} -> ${res.status}`);
  return res.json();
}

// Maps each knockout event id -> ESPN's authoritative match number. This is the
// canonical bracket ordering the "Round of X N Winner" placeholders key off of,
// so numbering our slots in this order makes placeholders and real results line
// up (otherwise a decided feeder and a placeholder feeder can collide on the same
// slot). The schedule is fixed, so we fetch once and cache for hours. Degrades
// gracefully: on failure callers fall back to chronological numbering.
async function getMatchNumberMap(env: Env, eventIds: string[]): Promise<Record<string, number>> {
  const key = "espn:matchnums";
  const cached = await cacheGet<Record<string, number>>(env, key);
  if (cached && eventIds.every((id) => id in cached)) return cached;

  const map: Record<string, number> = {};
  const BATCH = 8; // stay well under the Worker subrequest cap
  for (let i = 0; i < eventIds.length; i += BATCH) {
    const results = await Promise.all(
      eventIds.slice(i, i + BATCH).map(async (id) => {
        try {
          const d = await espnCoreFetch(`/events/${id}?lang=en`);
          const mn = d?.competitions?.[0]?.matchNumber;
          return [id, typeof mn === "number" ? mn : null] as const;
        } catch {
          return [id, null] as const;
        }
      })
    );
    for (const [id, mn] of results) if (mn != null) map[id] = mn;
  }
  // Only persist a complete map; a partial result shouldn't get cached for hours.
  if (eventIds.length > 0 && eventIds.every((id) => id in map)) {
    await cacheSet(env, key, map, 6 * 60 * 60 * 1000);
  }
  return map;
}

// ---------- normalization ----------

const PLACEHOLDER_RE =
  /\b(Winner|Loser|Round of \d+|Quarterfinal|Semifinal|Group [A-L]|TBD|To Be Determined|1st|2nd|3rd)\b/i;

function isPlaceholderName(name: string | undefined): boolean {
  return !!name && PLACEHOLDER_RE.test(name);
}

function teamFromCompetitor(comp: any): { team: TeamRef | null; placeholder?: string } {
  const t = comp?.team ?? {};
  const name: string = t.displayName ?? t.name ?? comp?.team?.shortDisplayName ?? "TBD";
  if (isPlaceholderName(name) || !t.id) {
    return { team: null, placeholder: name };
  }
  const logo: string | undefined =
    t.logo ?? (Array.isArray(t.logos) && t.logos[0]?.href) ?? undefined;
  return {
    team: {
      id: String(t.id),
      name,
      abbr: t.abbreviation ?? name.slice(0, 3).toUpperCase(),
      logo,
    },
  };
}

function normalizeEvent(e: any): Omit<Match, "round" | "roundLabel" | "matchNumber"> {
  const comp = e.competitions?.[0] ?? {};
  const competitors: any[] = comp.competitors ?? [];
  const homeC = competitors.find((c) => c.homeAway === "home") ?? competitors[0];
  const awayC = competitors.find((c) => c.homeAway === "away") ?? competitors[1];
  const home = teamFromCompetitor(homeC);
  const away = teamFromCompetitor(awayC);
  const state: MatchState = (e.status?.type?.state ?? "pre") as MatchState;
  const completed = !!e.status?.type?.completed;

  const winnerId =
    completed && homeC?.winner && home.team
      ? home.team.id
      : completed && awayC?.winner && away.team
        ? away.team.id
        : null;

  return {
    id: String(e.id),
    date: e.date,
    state,
    statusDetail: e.status?.type?.shortDetail ?? e.status?.type?.detail ?? "",
    clock: e.status?.displayClock,
    period: e.status?.period,
    home: home.team,
    away: away.team,
    homePlaceholder: home.placeholder,
    awayPlaceholder: away.placeholder,
    homeScore: state === "pre" ? null : numOrNull(homeC?.score),
    awayScore: state === "pre" ? null : numOrNull(awayC?.score),
    winnerId,
    venue: comp.venue?.fullName,
  };
}

function numOrNull(v: any): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Assign round + match number using deterministic chronological grouping,
// which matches ESPN's own "Round of 32 N Winner" numbering.
const ROUND_LABELS: Record<RoundCode, string> = {
  R32: "Round of 32",
  R16: "Round of 16",
  QF: "Quarterfinal",
  SF: "Semifinal",
  F: "Final",
  "3RD": "Third Place",
};

export function assignRounds(
  raw: Omit<Match, "round" | "roundLabel" | "matchNumber">[],
  mnMap: Record<string, number>
): Match[] {
  type Raw = (typeof raw)[number];
  const chrono = (a: Raw, b: Raw) => {
    const d = a.date.localeCompare(b.date);
    return d !== 0 ? d : Number(a.id) - Number(b.id);
  };
  const sorted = [...raw].sort(chrono);

  // Step 1: assign each match to a round by chronological position — 16 R32, 8
  // R16, 4 QF, 2 SF, then the final + third-place playoff. Round boundaries are
  // safe here because every knockout round kicks off after the previous finishes.
  const round = new Map<string, RoundCode>();
  const ranges: [RoundCode, number, number][] = [
    ["R32", 0, 16],
    ["R16", 16, 24],
    ["QF", 24, 28],
    ["SF", 28, 30],
  ];
  for (const [rc, start, end] of ranges) {
    for (let i = start; i < end && i < sorted.length; i++) round.set(sorted[i].id, rc);
  }
  // The two SF losers — the only teams that can contest the 3rd-place playoff. Derived from
  // the results, so unlike placeholder text this is available exactly when the text isn't.
  const sfLosers = new Set<string>();
  for (let i = 28; i < 30 && i < sorted.length; i++) {
    const m = sorted[i];
    if (m.state !== "post" || !m.winnerId) continue;
    const loser = m.winnerId === m.home?.id ? m.away?.id : m.home?.id;
    if (loser) sfLosers.add(loser);
  }

  // The tail is the 3rd-place playoff + the Final. Telling them apart has to work in BOTH
  // phases: ESPN publishes "Semifinal 1 Loser" placeholders only until the semis resolve, then
  // swaps in the real teams. A placeholder-only test therefore stops recognising the playoff at
  // the exact moment it stops being hypothetical — it silently relabels it "F", which hands
  // champKey ("F-1", the earlier match) to the playoff and crowns the wrong team.
  const tail = sorted.slice(30);
  tail.forEach((m, i) => {
    const ph = `${m.homePlaceholder ?? ""} ${m.awayPlaceholder ?? ""}`;
    const isThird =
      /Loser/i.test(ph) || // before the semis resolve: ESPN says so outright
      (!!m.home?.id &&
        !!m.away?.id &&
        sfLosers.has(m.home.id) &&
        sfLosers.has(m.away.id)) || // after: only the playoff pits two beaten semi-finalists
      (tail.length === 2 && i === 0 && !/Winner/i.test(ph)); // backstop: the playoff is first
    round.set(m.id, isThird ? "3RD" : "F");
  });

  // Step 2: number matches *within* each round by ESPN's match number, so our
  // `R32-3` is ESPN's "Round of 32 3" — the same N its parent slots reference.
  // Fall back to chronological order for any match missing a match number.
  const byRound = new Map<RoundCode, Raw[]>();
  for (const m of sorted) {
    const rc = round.get(m.id)!;
    (byRound.get(rc) ?? byRound.set(rc, []).get(rc)!).push(m);
  }
  const out: Match[] = [];
  for (const [rc, arr] of byRound) {
    arr.sort((a, b) => {
      const an = mnMap[a.id];
      const bn = mnMap[b.id];
      if (an != null && bn != null) return an - bn;
      return chrono(a, b);
    });
    arr.forEach((m, i) =>
      out.push({ ...m, round: rc, roundLabel: ROUND_LABELS[rc], matchNumber: i + 1 })
    );
  }
  return out;
}

// ---------- public API ----------

export async function getKnockoutMatches(env: Env, force = false): Promise<Match[]> {
  const key = "espn:knockout";
  if (!force) {
    const cached = await cacheGet<Match[]>(env, key);
    if (cached) return cached;
  }
  const data = await espnFetch(`/scoreboard?dates=${KNOCKOUT_RANGE}`);
  const events: any[] = data.events ?? [];
  const raw = events.map(normalizeEvent);
  const mnMap = await getMatchNumberMap(env, raw.map((m) => m.id));
  const matches = assignRounds(raw, mnMap);

  // Shorter TTL when something is live, longer otherwise.
  const anyLive = matches.some((m) => m.state === "in");
  const ttl = anyLive ? 12_000 : 60_000;
  await cacheSet(env, key, matches, ttl);
  return matches;
}

// The 32 knockout teams (draft pool / bracket leaves) come from the R32 fixtures.
export async function getTeams(env: Env): Promise<TeamRef[]> {
  const matches = await getKnockoutMatches(env);
  const teams: TeamRef[] = [];
  const seen = new Set<string>();
  for (const m of matches.filter((x) => x.round === "R32")) {
    for (const t of [m.home, m.away]) {
      if (t && !seen.has(t.id)) {
        seen.add(t.id);
        teams.push(t);
      }
    }
  }
  return teams.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getMatchDetail(env: Env, eventId: string): Promise<MatchDetail | null> {
  const key = `espn:summary:${eventId}`;
  const cached = await cacheGet<MatchDetail>(env, key);
  if (cached) return cached;

  let data: any;
  try {
    data = await espnFetch(`/summary?event=${eventId}`);
  } catch {
    return null;
  }

  // Base match info: find this event in the knockout list for round metadata.
  const matches = await getKnockoutMatches(env);
  const base = matches.find((m) => m.id === eventId);

  const commentary: CommentaryItem[] = (data.commentary ?? []).map((c: any) => ({
    sequence: c.sequence ?? 0,
    clock: c.time?.displayValue ?? "",
    text: c.text ?? "",
    isGoal: /goal/i.test(c.text ?? "") && !/no goal|disallowed|goal kick/i.test(c.text ?? ""),
  }));

  const keyEvents: KeyEvent[] = (data.keyEvents ?? []).map((k: any) => {
    const type = k.type?.text ?? "";
    return {
      clock: k.clock?.displayValue ?? "",
      type,
      text: k.text ?? "",
      isGoal: /goal/i.test(type) || (k.scoreValue ?? 0) > 0,
      teamId: k.team?.id ? String(k.team.id) : undefined,
      scorer: k.participants?.[0]?.athlete?.displayName ?? undefined,
    };
  });

  if (!base) return null;

  const lineups = extractLineups(data);

  const detail: MatchDetail = { ...base, commentary, keyEvents, lineups };
  const ttl = base.state === "in" ? 12_000 : 60_000;
  await cacheSet(env, key, detail, ttl);
  return detail;
}

function prettyStat(name: string): string {
  return name
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

function extractLineups(data: any): TeamLineup[] {
  return (data.rosters ?? []).map((r: any): TeamLineup => ({
    teamId: r.team?.id ? String(r.team.id) : undefined,
    teamName: r.team?.displayName ?? "",
    homeAway: r.homeAway === "away" ? "away" : "home",
    formation: r.formation,
    players: (r.roster ?? []).map((p: any) => ({
      id: String(p.athlete?.id ?? ""),
      name: p.athlete?.displayName ?? p.athlete?.fullName ?? "",
      jersey: p.jersey != null ? String(p.jersey) : undefined,
      position: p.position?.abbreviation,
      starter: !!p.starter,
      subbedIn: !!p.subbedIn,
      subbedOut: !!p.subbedOut,
      stats: (Array.isArray(p.stats) ? p.stats : []).map((s: any) => ({
        label: prettyStat(s.name ?? s.abbreviation ?? ""),
        value: String(s.displayValue ?? s.value ?? ""),
      })),
    })),
  }));
}

// ---------- player pool (fantasy draft) ----------

const POS_DEF = new Set(["CB", "CD", "LB", "RB", "RCB", "LCB", "LWB", "RWB", "SW", "D", "DF", "WB"]);
const POS_MID = new Set(["DM", "CM", "M", "LM", "RM", "AM", "MF", "CDM", "CAM", "RDM", "LDM"]);
const POS_FWD = new Set(["F", "CF", "ST", "FW", "LW", "RW", "W", "SS", "RF", "LF"]);

function mapPosition(abbr: string): Position {
  const base = (abbr || "").toUpperCase().split("-")[0].trim();
  if (base.startsWith("G")) return "GK";
  if (POS_DEF.has(base)) return "DEF";
  if (POS_FWD.has(base)) return "FWD";
  if (POS_MID.has(base)) return "MID";
  if (/B$/.test(base)) return "DEF"; // LB / RB / WB
  if (base.endsWith("F") || base.endsWith("W")) return "FWD";
  return "MID";
}

function flattenAthletes(data: any): any[] {
  const ath = data?.athletes ?? data?.team?.athletes ?? [];
  const out: any[] = [];
  for (const grp of Array.isArray(ath) ? ath : []) {
    if (grp?.items && Array.isArray(grp.items)) out.push(...grp.items);
    else if (grp?.id || grp?.displayName) out.push(grp);
  }
  return out;
}

// One nation's roster, with a single retry — a lone transient miss used to drop that whole
// squad from the pool, so it's worth one more attempt before giving up on the team.
async function fetchTeamRoster(teamId: string): Promise<any | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await espnFetch(`/teams/${teamId}/roster`);
    } catch {
      /* fall through to the retry, then to null */
    }
  }
  return null;
}

export async function getPlayerPool(env: Env): Promise<PoolPlayer[]> {
  const key = "espn:playerpool";
  const cached = await cacheGet<PoolPlayer[]>(env, key);
  if (cached) return cached;

  const teams = await getTeams(env);
  const pool: PoolPlayer[] = [];
  const covered = new Set<string>(); // team ids that contributed at least one player
  // Fetch in small batches, not all 32 at once. A concurrent burst trips ESPN's rate limit
  // (and flirts with the Worker subrequest cap); every team that failed was silently skipped.
  // See getMatchNumberMap for the same batching rationale.
  const BATCH = 6;
  for (let i = 0; i < teams.length; i += BATCH) {
    await Promise.all(
      teams.slice(i, i + BATCH).map(async (team) => {
        const data = await fetchTeamRoster(team.id);
        if (!data) return; // missed even after a retry — better a short cache than a poisoned one
        for (const a of flattenAthletes(data)) {
          const id = String(a.id ?? a.athlete?.id ?? "");
          const name = a.displayName ?? a.fullName ?? a.athlete?.displayName ?? "";
          const posAbbr =
            a.position?.abbreviation ?? a.athlete?.position?.abbreviation ?? a.position?.name ?? "";
          if (!id || !name) continue;
          pool.push({ id, name, position: mapPosition(posAbbr), posAbbr, team });
          covered.add(team.id);
        }
      })
    );
  }
  pool.sort((a, b) => a.team.name.localeCompare(b.team.name) || a.name.localeCompare(b.name));
  // Only persist a COMPLETE pool for the long window. A partial pool (some nation's roster
  // fetch failed) poisons every consumer — the draftable pool, projections, and the
  // leaderboard's name/flag lookup — rendering that nation's scorers as bare numeric ids.
  // Cache a partial for just a minute so the next request retries and self-heals.
  if (pool.length > 0) {
    const complete = teams.every((t) => covered.has(t.id));
    await cacheSet(env, key, pool, complete ? 6 * 60 * 60 * 1000 : 60_000);
  }
  return pool;
}

export interface MatchPlayerStat {
  appeared: boolean;
  goals: number;
  assists: number;
  yellow: number;
  red: number;
  og: number;
  saves: number;
  conceded: number;
  // Earned a clean sheet: their team kept it clean AND they were on the pitch 60+ minutes
  // (FPL rule). Precomputed here so every scoring path stays consistent.
  cleanSheet: boolean;
}

// Leading minute of an ESPN clock string like "78'" or "90'+3'" (stoppage ignored).
export function parseClockMinute(s: string | undefined): number | null {
  const mm = /^(\d+)/.exec(s ?? "");
  return mm ? Number(mm[1]) : null;
}

// Minutes a player was on the pitch, derived from their starter/sub flags plus the minute
// stamps ESPN records on the player's OWN `plays` (keyed by player id — no fragile name
// matching against the play-by-play). A subbed-off player's last play is their exit; a
// sub's first play is their entry. Used to gate clean sheets on the 60-minute rule.
export function playerMinutes(p: {
  starter?: boolean;
  subbedIn?: boolean;
  subbedOut?: boolean;
  plays?: { clock?: { displayValue?: string } }[];
}): number {
  const clocks = (p.plays ?? [])
    .map((x) => parseClockMinute(x.clock?.displayValue))
    .filter((n): n is number => n !== null);
  const starter = !!p.starter;
  const subIn = !!p.subbedIn;
  const subOut = !!p.subbedOut;
  const FULL = 90; // regulation; stoppage ignored (doesn't affect the 60' threshold)
  if (starter && !subOut) return FULL; // played the whole match
  if (starter && subOut) return clocks.length ? Math.max(...clocks) : FULL; // off at last play
  if (subIn && !subOut) return FULL - (clocks.length ? Math.min(...clocks) : FULL); // on at first play
  if (subIn && subOut) return clocks.length >= 2 ? Math.max(...clocks) - Math.min(...clocks) : 0;
  return 0; // never took the pitch
}

export async function getMatchPlayerStats(
  env: Env,
  eventId: string,
  final: boolean
): Promise<Record<string, MatchPlayerStat>> {
  // v2: clean sheet now requires 60+ minutes on the pitch (see playerMinutes) — bump the
  // cache key so already-cached matches recompute under the new rule.
  const key = `espn:pstats:v2:${eventId}`;
  const cached = await cacheGet<Record<string, MatchPlayerStat>>(env, key);
  if (cached) return cached;
  let data: any;
  try {
    data = await espnFetch(`/summary?event=${eventId}`);
  } catch {
    return {};
  }
  // Goals each side conceded (= the opponent's score), so clean sheets are team-wide.
  let homeScore = 0;
  let awayScore = 0;
  for (const c of data.header?.competitions?.[0]?.competitors ?? []) {
    const sc = Number(c.score ?? 0) || 0;
    if (c.homeAway === "away") awayScore = sc;
    else homeScore = sc;
  }
  const out: Record<string, MatchPlayerStat> = {};
  for (const r of data.rosters ?? []) {
    const teamConceded = r.homeAway === "away" ? homeScore : awayScore;
    for (const p of r.roster ?? []) {
      const id = String(p.athlete?.id ?? "");
      if (!id) continue;
      const s: Record<string, number> = {};
      for (const st of p.stats ?? []) s[st.name] = Number(st.displayValue ?? st.value ?? 0) || 0;
      const mins = playerMinutes(p);
      out[id] = {
        appeared: (s["appearances"] ?? 0) > 0 || !!p.starter || !!p.subbedIn,
        goals: s["totalGoals"] ?? 0,
        assists: s["goalAssists"] ?? 0,
        yellow: s["yellowCards"] ?? 0,
        red: s["redCards"] ?? 0,
        og: s["ownGoals"] ?? 0,
        saves: s["saves"] ?? 0,
        conceded: s["goalsConceded"] ?? 0,
        // FPL rule: clean sheet needs the team to keep it clean AND 60+ minutes on the pitch,
        // so late subs and early-subbed starters don't get one.
        cleanSheet: mins >= 60 && teamConceded === 0,
      };
    }
  }
  // Final matches never change — cache long; live ones briefly.
  await cacheSet(env, key, out, final ? 24 * 60 * 60 * 1000 : 30_000);
  return out;
}

// Aggregate every player's SCORING_ROUNDS stats across completed knockout matches.
export async function getFantasyStatsMap(env: Env): Promise<Record<string, PlayerAgg>> {
  // Aggregates only COMPLETED matches, so it's stable between match completions — cache the
  // whole thing briefly instead of re-summing every match's stats on every request.
  // v3: 3RD dropped (see getFantasyStatsByRound) — v2 entries still carry it.
  const key = "espn:fstatsmap:v3";
  const cached = await cacheGet<Record<string, PlayerAgg>>(env, key);
  if (cached) return cached;
  const matches = await getKnockoutMatches(env);
  // Same SCORING_ROUNDS rule as the per-round feed: this is what a player is WORTH to a manager,
  // so it has to agree with the leaderboard. Otherwise the pool projects a 3rd-place hat-trick
  // the Total board refuses to pay.
  const completed = matches.filter(
    (m) => m.state === "post" && m.winnerId && SCORING_ROUNDS.includes(m.round)
  );
  const agg: Record<string, PlayerAgg> = {};
  for (const m of completed) {
    const ps = await getMatchPlayerStats(env, m.id, true);
    for (const [id, s] of Object.entries(ps)) {
      const a =
        agg[id] ??
        (agg[id] = {
          apps: 0,
          goals: 0,
          assists: 0,
          yellow: 0,
          red: 0,
          og: 0,
          saves: 0,
          conceded: 0,
          cleanSheets: 0,
        });
      if (s.appeared) a.apps++;
      a.goals += s.goals;
      a.assists += s.assists;
      a.yellow += s.yellow;
      a.red += s.red;
      a.og += s.og;
      a.saves += s.saves;
      a.conceded += s.conceded;
      if (s.cleanSheet) a.cleanSheets++;
    }
  }
  await cacheSet(env, key, agg, 60_000);
  return agg;
}

// Same stats, but broken down per knockout round (and carrying the match id, for
// upset weighting). Powers captain (double one round) and the giant-killer bonus.
export async function getFantasyStatsByRound(
  env: Env
): Promise<Record<string, Partial<Record<RoundCode, { agg: PlayerAgg; matchId: string }>>>> {
  type ByRound = Record<string, Partial<Record<RoundCode, { agg: PlayerAgg; matchId: string }>>>;
  // Completed matches only → stable between completions; cache briefly (see getFantasyStatsMap).
  // v3: 3RD dropped from the fantasy view (see below) — v2 entries still carry it.
  const key = "espn:fbyround:v3";
  const cached = await cacheGet<ByRound>(env, key);
  if (cached) return cached;
  const matches = await getKnockoutMatches(env);
  // SCORING_ROUNDS only — this is the fantasy view of the tournament, not the tournament. Every
  // draft consumer reads 3RD-free data off this one map, which is what keeps the Total board, the
  // H2H board, the eliminated flag and the transfer rules agreeing with each other.
  const completed = matches.filter(
    (m) => m.state === "post" && m.winnerId && SCORING_ROUNDS.includes(m.round)
  );
  const out: ByRound = {};
  for (const m of completed) {
    const ps = await getMatchPlayerStats(env, m.id, true);
    for (const [id, s] of Object.entries(ps)) {
      const byR = out[id] ?? (out[id] = {});
      const e =
        byR[m.round] ??
        (byR[m.round] = {
          matchId: m.id,
          agg: { apps: 0, goals: 0, assists: 0, yellow: 0, red: 0, og: 0, saves: 0, conceded: 0, cleanSheets: 0 },
        });
      const a = e.agg;
      if (s.appeared) a.apps++;
      a.goals += s.goals;
      a.assists += s.assists;
      a.yellow += s.yellow;
      a.red += s.red;
      a.og += s.og;
      a.saves += s.saves;
      a.conceded += s.conceded;
      if (s.cleanSheet) a.cleanSheets++;
    }
  }
  await cacheSet(env, key, out, 60_000);
  return out;
}

// ---------- odds / upset factor ----------
// Each match's closing line gives a market win-probability. We capture it once
// the match is underway/finished (the summary retains it) and freeze it — that's
// the kickoff "closing line", reflecting any late news like injuries/lineups.

import type { OddsMap } from "../shared/types";

function impliedProb(ml: number): number {
  // American moneyline -> implied probability
  return ml < 0 ? -ml / (-ml + 100) : 100 / (ml + 100);
}

function extractOdds(summary: any): { pHome: number; pAway: number } | null {
  const o = (summary?.odds ?? [])[0];
  if (!o) return null;
  const hml = o.homeTeamOdds?.moneyLine;
  const aml = o.awayTeamOdds?.moneyLine;
  if (typeof hml !== "number" || typeof aml !== "number") return null;
  const ph = impliedProb(hml);
  const pa = impliedProb(aml);
  const s = ph + pa;
  if (s <= 0) return null;
  return { pHome: ph / s, pAway: pa / s }; // normalized: removes the bookmaker margin
}

interface StoredOdds {
  pHome: number;
  pAway: number;
  frozen: boolean;
}

// Current (live, pre-match) odds for ONE match — used to show the upset-weighted winner's
// per-side payout at pick time. Scoring still uses the frozen closing line (getOddsMap);
// this is just the indicative current line for display. Cached briefly since it drifts.
export async function getMatchOdds(
  env: Env,
  eventId: string
): Promise<{ pHome: number; pAway: number } | null> {
  const key = `espn:liveodds:${eventId}`;
  const cached = await cacheGet<{ pHome: number; pAway: number }>(env, key);
  if (cached) return cached;
  try {
    const data = await espnFetch(`/summary?event=${eventId}`);
    const odds = extractOdds(data);
    if (odds) {
      await cacheSet(env, key, odds, 5 * 60_000);
      return odds;
    }
  } catch {
    /* no odds available for this match */
  }
  return null;
}

// Self-maintaining odds map: refreshes at most every 5 min, fetching the closing
// line only for matches that have started but aren't captured yet. Warmed by cron.
export async function getOddsMap(env: Env): Promise<OddsMap> {
  const key = "espn:oddsmap";
  const cached = await cacheGet<{ at: number; map: Record<string, StoredOdds> }>(env, key);
  const map: Record<string, StoredOdds> = cached?.map ?? {};
  const fresh = cached && Date.now() - cached.at < 5 * 60_000;

  if (!fresh) {
    try {
      const matches = await getKnockoutMatches(env);
      const todo = matches.filter((m) => m.state !== "pre" && !map[m.id]?.frozen).slice(0, 16);
      for (const m of todo) {
        try {
          const data = await espnFetch(`/summary?event=${m.id}`);
          const odds = extractOdds(data);
          if (odds) map[m.id] = { ...odds, frozen: true };
        } catch {
          /* skip this match, try again next refresh */
        }
      }
      await cacheSet(env, key, { at: Date.now(), map }, 30 * 24 * 60 * 60_000);
    } catch {
      /* ignore; return whatever we have */
    }
  }

  const out: OddsMap = {};
  for (const [id, v] of Object.entries(map)) out[id] = { pHome: v.pHome, pAway: v.pAway };
  return out;
}
