import { Hono } from "hono";
import type { Env } from "./espn";
import {
  getKnockoutMatches,
  getTeams,
  getMatchDetail,
  getOddsMap,
  getMatchOdds,
  getMatchPlayerStats,
  getPlayerPool,
  getFantasyStatsMap,
  getFantasyStatsByRound,
} from "./espn";
import { attributeByMatch, computeStandingsByMatch, computeH2HStandings, eliminatedTeams, fantasyPoints, scoreBreakdown } from "./fantasy";
import { buildBracket, resolveMemberPicks } from "./bracket";
import { getProjectedPool } from "./projection";
import { computeBracketStandings, upsetMultiplier } from "./scoring";
import {
  validateValue,
  buildSlateView,
  computePredictionStandings,
  propsForLeague,
  scoreWinner,
  type RevealRow,
} from "./predictions";
import type {
  ChipId,
  DraftState,
  DraftStatus,
  League,
  Match,
  PlayerAgg,
  PoolPlayer,
  Position,
  PublicMember,
  RoundCode,
  Session,
} from "../shared/types";
import { CHIPS, FORMATIONS, PICK_CLOCKS, REACTIONS, squadFromFormation } from "../shared/types";

interface MemberRow {
  id: string;
  token: string;
  league_id: string;
  name: string;
  is_commissioner: number;
  in_draft: number;
  auto_draft: number;
  draft_position: number | null;
  created_at: number;
}
interface LeagueRow {
  id: string;
  name: string;
  code: string;
  draft_status: DraftStatus;
  draft_started_at: number | null;
  bracket_locked: number;
  scoring: string | null;
  formation: string;
  pick_clock_seconds: number;
  created_at: number;
}

type Variables = { member: MemberRow; league: LeagueRow };

const TRANSFERS_PER_ROUND = 2;
const KNOCKOUT_ROUNDS: { round: RoundCode; label: string }[] = [
  { round: "R32", label: "Round of 32" },
  { round: "R16", label: "Round of 16" },
  { round: "QF", label: "Quarters" },
  { round: "SF", label: "Semis" },
  { round: "F", label: "Final" },
];

function countCompletedRounds(matches: Match[]): number {
  const rounds = ["R32", "R16", "QF", "SF", "F"];
  let done = 0;
  for (const r of rounds) {
    const inRound = matches.filter((m) => m.round === r);
    if (inRound.length > 0 && inRound.every((m) => m.state === "post")) done++;
  }
  return done;
}

// The round currently being played: kicked off but not fully finished (null between rounds).
function activeRound(matches: Match[]): RoundCode | null {
  const rounds: RoundCode[] = ["R32", "R16", "QF", "SF", "F"];
  for (const r of rounds) {
    const inRound = matches.filter((m) => m.round === r);
    if (inRound.length === 0) continue;
    const started = inRound.some((m) => m.state !== "pre");
    const allDone = inRound.every((m) => m.state === "post");
    if (started && !allDone) return r;
  }
  return null;
}

// Teams whose match in the active round has already kicked off (in/post). Their players are
// frozen for transfers this round — dropping a player who's played banks + cycles, and adding
// one who's played does nothing this round. Teams still to play can be freely swapped.
function lockedRoundTeams(matches: Match[]): string[] {
  const r = activeRound(matches);
  if (!r) return [];
  const out = new Set<string>();
  for (const m of matches) {
    if (m.round !== r || m.state === "pre") continue;
    if (m.home?.id) out.add(m.home.id);
    if (m.away?.id) out.add(m.away.id);
  }
  return [...out];
}
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// ---------- helpers ----------
const uid = () => crypto.randomUUID();
const now = () => Date.now();

function makeCode(len = 5): string {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  let s = "";
  for (let i = 0; i < len; i++) s += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return s;
}

// Trim, collapse whitespace, and bound length. Returns null if empty or over cap.
// (Injection/XSS are already handled by parameterized binds + React escaping; this
// is hygiene to stop oversized-name abuse.)
function validName(raw: unknown, max: number): string | null {
  const s = String(raw ?? "").trim().replace(/\s+/g, " ");
  return s && s.length <= max ? s : null;
}

// Append a line to a league's activity feed. dedupeKey is a deterministic id so the
// cron can re-derive match events every run without creating duplicates.
async function addActivity(
  env: Env,
  leagueId: string,
  kind: string,
  emoji: string,
  text: string,
  dedupeKey: string,
  // When the event actually HAPPENED (match kickoff for derived events) — drives the
  // timeline order. Defaults to now() for real-time actions (transfers, chips).
  createdAt: number = now()
) {
  await env.DB.prepare(
    "INSERT OR IGNORE INTO activity (league_id, kind, emoji, text, dedupe_key, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  )
    .bind(leagueId, kind, emoji, text, dedupeKey, createdAt)
    .run();
}

function publicMember(m: MemberRow): PublicMember {
  return {
    id: m.id,
    name: m.name,
    isCommissioner: !!m.is_commissioner,
    inDraft: !!m.in_draft,
    draftPosition: m.draft_position,
  };
}

async function loadMembers(env: Env, leagueId: string): Promise<MemberRow[]> {
  const res = await env.DB.prepare(
    "SELECT * FROM members WHERE league_id = ? ORDER BY created_at"
  )
    .bind(leagueId)
    .all<MemberRow>();
  return res.results ?? [];
}

async function leaguePayload(env: Env, league: LeagueRow): Promise<League> {
  const members = await loadMembers(env, league.id);
  return {
    id: league.id,
    name: league.name,
    code: league.code,
    draftStatus: league.draft_status,
    bracketLocked: !!league.bracket_locked,
    formation: league.formation || "4-4-2",
    pickClockSeconds: league.pick_clock_seconds ?? 0,
    members: members.map(publicMember),
  };
}

// snake order: 1-based seat (draft_position) that owns a 1-based overall pick
function seatForPick(pickNumber: number, n: number): number {
  const idx = pickNumber - 1;
  const round = Math.floor(idx / n);
  const pos = idx % n;
  const seat = round % 2 === 0 ? pos : n - 1 - pos;
  return seat + 1;
}

async function getDraftState(
  env: Env,
  league: LeagueRow,
  memberId?: string
): Promise<DraftState> {
  const members = await loadMembers(env, league.id);
  const ordered = members
    .filter((m) => m.draft_position != null)
    .sort((a, b) => (a.draft_position! - b.draft_position!));

  // Active picks only (dropped players are off the squad and free again).
  const picksRes = await env.DB.prepare(
    `SELECT dp.pick_number, dp.member_id, dp.team_id, dp.team_name, dp.position, dp.country, dp.country_id, m.name AS member_name
     FROM draft_picks dp JOIN members m ON m.id = dp.member_id
     WHERE dp.league_id = ? AND dp.dropped = 0 ORDER BY dp.pick_number`
  )
    .bind(league.id)
    .all<any>();
  const picks = (picksRes.results ?? []).map((r: any) => ({
    pickNumber: r.pick_number,
    memberId: r.member_id,
    memberName: r.member_name,
    playerId: r.team_id,
    playerName: r.team_name,
    position: r.position,
    country: r.country,
    teamId: r.country_id,
  }));

  const squad = squadFromFormation(league.formation);
  const squadSize = squad.GK + squad.DEF + squad.MID + squad.FWD;
  const n = ordered.length;
  const totalPicks = squadSize * n;
  const currentPickNumber = picks.length + 1;
  let onTheClockMemberId: string | null = null;
  if (league.draft_status === "active" && n > 0 && currentPickNumber <= totalPicks) {
    const seat = seatForPick(currentPickNumber, n);
    onTheClockMemberId = ordered.find((m) => m.draft_position === seat)?.id ?? null;
  }

  const clockSeconds = league.pick_clock_seconds ?? 0;
  const autoMemberIds = ordered.filter((m) => m.auto_draft).map((m) => m.id);
  let deadline: number | null = null;
  if (clockSeconds > 0 && league.draft_status === "active" && onTheClockMemberId) {
    if (autoMemberIds.includes(onTheClockMemberId)) {
      deadline = now() - 1; // already on autopick — fire immediately, no clock wait
    } else {
      const r = await env.DB.prepare(
        "SELECT MAX(created_at) AS t FROM draft_picks WHERE league_id = ?"
      )
        .bind(league.id)
        .first<{ t: number | null }>();
      deadline = (r?.t ?? league.draft_started_at ?? now()) + clockSeconds * 1000;
    }
  }

  const km = await getKnockoutMatches(env);
  const completedRounds = countCompletedRounds(km);
  let myTransfersUsed = 0;
  let captainRounds: DraftState["captainRounds"] = [];
  let chips: DraftState["chips"] = [];
  if (memberId) {
    const t = await env.DB.prepare(
      "SELECT COUNT(*) AS c FROM draft_picks WHERE league_id = ? AND member_id = ? AND dropped = 1"
    )
      .bind(league.id, memberId)
      .first<{ c: number }>();
    myTransfersUsed = t?.c ?? 0;

    if (league.draft_status === "done") {
      const caps = await env.DB.prepare(
        "SELECT round, player_id FROM captains WHERE league_id = ? AND member_id = ?"
      )
        .bind(league.id, memberId)
        .all<{ round: RoundCode; player_id: string }>();
      const mine = new Map((caps.results ?? []).map((r) => [r.round, r.player_id]));
      captainRounds = KNOCKOUT_ROUNDS.map(({ round, label }) => ({
        round,
        label,
        locked: km.some((m) => m.round === round && m.state !== "pre"), // round kicked off
        captainPlayerId: mine.get(round) ?? null,
      }));

      const chipRows = await env.DB.prepare(
        "SELECT chip, round FROM chips WHERE league_id = ? AND member_id = ?"
      )
        .bind(league.id, memberId)
        .all<{ chip: ChipId; round: RoundCode }>();
      const played = new Map((chipRows.results ?? []).map((r) => [r.chip, r.round]));
      const roundKickedOff = (r: RoundCode) => km.some((m) => m.round === r && m.state !== "pre");
      chips = CHIPS.map(({ id }) => {
        const round = played.get(id) ?? null;
        return { chip: id, round, committed: round != null && roundKickedOff(round) };
      });
    }
  }

  // The original draft board: every original pick (pick_number ≤ totalPicks), INCLUDING
  // ones since transferred out, so a transfer never leaves a blank cell. Transfer rows tell
  // us who replaced a dropped player and how many times each player has changed hands.
  const boardRes = await env.DB.prepare(
    `SELECT dp.pick_number, dp.member_id, dp.team_id, dp.team_name, dp.position, dp.country, dp.country_id, dp.dropped, m.name AS member_name
     FROM draft_picks dp JOIN members m ON m.id = dp.member_id
     WHERE dp.league_id = ? AND dp.pick_number <= ? ORDER BY dp.pick_number`
  )
    .bind(league.id, totalPicks)
    .all<any>();
  const txRes = await env.DB.prepare(
    "SELECT out_player_id, in_player_id, in_player_name FROM transfers WHERE league_id = ?"
  )
    .bind(league.id)
    .all<{ out_player_id: string; in_player_id: string; in_player_name: string }>();
  const replacedBy = new Map<string, string>(); // dropped player id -> who replaced them
  const txCount = new Map<string, number>(); // player id -> times involved in a transfer
  for (const t of txRes.results ?? []) {
    replacedBy.set(t.out_player_id, t.in_player_name);
    txCount.set(t.out_player_id, (txCount.get(t.out_player_id) ?? 0) + 1);
    txCount.set(t.in_player_id, (txCount.get(t.in_player_id) ?? 0) + 1);
  }
  const elimSet = eliminatedTeams(km);
  const boardPicks = (boardRes.results ?? []).map((r: any) => ({
    pickNumber: r.pick_number,
    memberId: r.member_id,
    memberName: r.member_name,
    playerId: r.team_id,
    playerName: r.team_name,
    position: r.position,
    country: r.country,
    teamId: r.country_id,
    dropped: !!r.dropped,
    replacedByName: r.dropped ? replacedBy.get(r.team_id) ?? null : null,
    transferCount: txCount.get(r.team_id) ?? 0,
    eliminated: elimSet.has(r.country_id),
  }));

  return {
    status: league.draft_status,
    order: ordered.map(publicMember),
    picks,
    boardPicks,
    onTheClockMemberId,
    currentPickNumber,
    totalPicks,
    squad,
    completedRounds,
    transfersPerRound: TRANSFERS_PER_ROUND,
    lockedTeams: lockedRoundTeams(km),
    myTransfersUsed,
    clockSeconds,
    deadline,
    autoMemberIds,
    captainRounds,
    chips,
  };
}

// Atomic, race-safe pick insert: adds the row only if that pick_number is still open,
// so a client autopick and the cron backstop can't both fill the same slot. Returns
// whether THIS call made the pick.
// A player's accumulated points at the moment they're acquired — their scoring baseline,
// so they only earn from acquisition forward (no retroactive credit for matches already
// played). 0 for a pre-tournament draft; the same rule the transfer path uses.
function acquisitionBaseline(
  statsMap: Record<string, PlayerAgg>,
  playerId: string,
  position: Position
): number {
  return statsMap[playerId] ? fantasyPoints(statsMap[playerId], position) : 0;
}

async function insertPickIfOpen(
  env: Env,
  leagueId: string,
  memberId: string,
  player: PoolPlayer,
  pickNumber: number,
  baseline: number
): Promise<boolean> {
  try {
    const res = await env.DB.prepare(
      `INSERT INTO draft_picks (league_id, member_id, team_id, team_name, position, country, country_id, baseline_pts, pick_number, created_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
       WHERE NOT EXISTS (SELECT 1 FROM draft_picks WHERE league_id = ? AND pick_number = ?)`
    )
      .bind(
        leagueId,
        memberId,
        player.id,
        player.name,
        player.position,
        player.team.name,
        player.team.id,
        baseline,
        pickNumber,
        now(),
        leagueId,
        pickNumber
      )
      .run();
    return (res.meta?.changes ?? 0) > 0;
  } catch {
    // Lost the race — pick_number taken, or the idx_active_owner lock rejected this
    // player (already on an active squad). Either way, this call didn't place the pick.
    return false;
  }
}

// Autopick any expired turns for a league (used by the autopick endpoint and the cron).
// Each pick resets the clock, so this normally makes at most one pick per call; the loop
// is just a safety catch-up. Picks the top of the ranked board for a still-needed slot.
async function runAutopick(env: Env, league: LeagueRow): Promise<number> {
  const clockMs = (league.pick_clock_seconds ?? 0) * 1000;
  if (clockMs <= 0 || league.draft_status !== "active") return 0;
  const pool = await getProjectedPool(env);
  const ranked = [...pool].sort((a, b) => (b.proj ?? 0) - (a.proj ?? 0));
  const statsMap = await getFantasyStatsMap(env); // for acquisition baselines (mid-tournament drafts)

  let made = 0;
  for (let guard = 0; guard < 200; guard++) {
    const fresh = await env.DB.prepare("SELECT * FROM leagues WHERE id = ?")
      .bind(league.id)
      .first<LeagueRow>();
    if (!fresh || fresh.draft_status !== "active") break;
    const state = await getDraftState(env, fresh);
    if (!state.onTheClockMemberId || state.deadline == null || now() < state.deadline) break;

    const memberId = state.onTheClockMemberId;
    const mine = state.picks.filter((p) => p.memberId === memberId);
    const need = (pos: Position) =>
      state.squad[pos] - mine.filter((p) => p.position === pos).length;
    const taken = new Set(state.picks.map((p) => p.playerId));
    const pick = ranked.find((p) => !taken.has(p.id) && need(p.position) > 0);
    if (!pick) break;

    const baseline = acquisitionBaseline(statsMap, pick.id, pick.position);
    const ok = await insertPickIfOpen(env, fresh.id, memberId, pick, state.currentPickNumber, baseline);
    if (!ok) break; // someone else just took this pick — let the next loop re-read
    // Sticky autopick: once you miss a pick you stay on autopick (subsequent turns fire
    // immediately, no clock wait) until you take control back.
    if (!state.autoMemberIds.includes(memberId))
      await env.DB.prepare("UPDATE members SET auto_draft = 1 WHERE id = ?").bind(memberId).run();
    const who = state.order.find((m) => m.id === memberId)?.name ?? "Someone";
    await addActivity(
      env,
      fresh.id,
      "draft",
      "🤖",
      `${who} (autopick) · ${pick.name} (${pick.team.abbr}) · pick ${state.currentPickNumber}`,
      `draft:${fresh.id}:${state.currentPickNumber}`
    );
    if (state.currentPickNumber >= state.totalPicks) {
      await env.DB.prepare("UPDATE leagues SET draft_status = 'done' WHERE id = ?")
        .bind(fresh.id)
        .run();
      await addActivity(env, fresh.id, "draft", "✅", "Draft complete — squads are set", `draftdone:${fresh.id}`);
    }
    made++;
  }
  return made;
}

// Re-derive match-driven feed events (owned-player performances + eliminations) from
// current state. Idempotent via dedupe_key, so the cron runs it safely every cycle.
async function deriveMatchActivity(env: Env) {
  const matches = await getKnockoutMatches(env);
  const completed = matches.filter((m) => m.state === "post" && m.winnerId);
  if (completed.length === 0) return;
  const completedIds = new Set(completed.map((m) => m.id));
  const matchById = new Map(completed.map((m) => [m.id, m]));
  const byRound = await getFantasyStatsByRound(env);
  const pool = await getPlayerPool(env);
  const meta = new Map(pool.map((p) => [p.id, p]));

  // player_id -> who owns them, WITH when they acquired them, so a match's credit only goes
  // to whoever actually held the player at kickoff (no pre-acquisition goals).
  const ownRes = await env.DB.prepare(
    `SELECT dp.league_id, dp.member_id, dp.team_id AS player_id, dp.created_at AS acquired_at, m.name AS member_name
     FROM draft_picks dp JOIN members m ON m.id = dp.member_id WHERE dp.dropped = 0`
  ).all<{ league_id: string; member_id: string; player_id: string; acquired_at: number; member_name: string }>();
  const owners = new Map<string, { leagueId: string; memberId: string; memberName: string; acquiredAt: number }[]>();
  for (const r of ownRes.results ?? [])
    (owners.get(r.player_id) ?? owners.set(r.player_id, []).get(r.player_id)!).push({
      leagueId: r.league_id,
      memberId: r.member_id,
      memberName: r.member_name,
      acquiredAt: r.acquired_at,
    });

  // 1) Notable fantasy performances for owned players — stamped at the MATCH time, tagged
  //    with the opponent + points earned, and only credited to owners who held them then.
  for (const [playerId, rounds] of Object.entries(byRound)) {
    const own = owners.get(playerId);
    if (!own?.length) continue;
    const pm = meta.get(playerId);
    const pos = pm?.position;
    for (const entry of Object.values(rounds)) {
      if (!entry || !completedIds.has(entry.matchId)) continue;
      const m = matchById.get(entry.matchId);
      const kickoff = m ? new Date(m.date).getTime() : now();
      const opp = m ? (m.home?.id === pm?.team.id ? m.away?.abbr : m.home?.abbr) : "";
      const a = entry.agg;
      const bits: string[] = [];
      if (a.goals > 0) bits.push(`${a.goals} goal${a.goals > 1 ? "s" : ""}`);
      if (a.assists > 0) bits.push(`${a.assists} assist${a.assists > 1 ? "s" : ""}`);
      if (a.cleanSheets > 0 && (pos === "GK" || pos === "DEF")) bits.push("clean sheet");
      if (a.red > 0) bits.push("a red card");
      if (a.og > 0) bits.push("an own goal");
      if (!bits.length) continue;
      const pts = pos ? fantasyPoints(a, pos) : 0;
      const emoji =
        a.goals > 0 ? "⚽" : a.assists > 0 ? "🎯" : a.cleanSheets > 0 ? "🧤" : a.red > 0 ? "🟥" : "😬";
      const name = pm?.name ?? "a player";
      for (const o of own) {
        if (kickoff < o.acquiredAt) continue; // they didn't own the player during this match
        await addActivity(
          env,
          o.leagueId,
          "perf",
          emoji,
          `${name} — ${bits.join(", ")}${opp ? ` vs ${opp}` : ""} · ${pts >= 0 ? "+" : ""}${pts} for ${o.memberName}`,
          `perf:${entry.matchId}:${playerId}:${o.leagueId}`,
          kickoff
        );
      }
    }
  }

  // 2) Eliminations — per member who owned players from the losing team (at match time).
  for (const m of completed) {
    const loserId = m.winnerId === m.home?.id ? m.away?.id : m.home?.id;
    const loserName = m.winnerId === m.home?.id ? m.away?.name : m.home?.name;
    if (!loserId) continue;
    const kickoff = new Date(m.date).getTime();
    const hit = new Map<string, { leagueId: string; memberId: string; memberName: string; n: number }>();
    for (const [playerId, own] of owners) {
      if (meta.get(playerId)?.team.id !== loserId) continue;
      for (const o of own) {
        if (kickoff < o.acquiredAt) continue; // acquired after this team was already out
        const k = `${o.leagueId}|${o.memberId}`;
        const e = hit.get(k) ?? hit.set(k, { ...o, n: 0 }).get(k)!;
        e.n++;
      }
    }
    for (const e of hit.values())
      await addActivity(env, e.leagueId, "elim", "💀", `${e.memberName} lost ${e.n} player${e.n > 1 ? "s" : ""} — ${loserName} eliminated`, `elim:${m.id}:${e.memberId}`, kickoff);
  }
}

// ---------- auth ----------
const requireAuth = async (c: any, next: any) => {
  const auth = c.req.header("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : c.req.header("x-token") || undefined;
  if (!token) return c.json({ error: "unauthorized" }, 401);
  const member = await c.env.DB.prepare("SELECT * FROM members WHERE token = ?")
    .bind(token)
    .first<MemberRow>();
  if (!member) return c.json({ error: "unauthorized" }, 401);
  const league = await c.env.DB.prepare("SELECT * FROM leagues WHERE id = ?")
    .bind(member.league_id)
    .first<LeagueRow>();
  if (!league) return c.json({ error: "unauthorized" }, 401);
  c.set("member", member);
  c.set("league", league);
  await next();
};

// ---------- public data ----------
app.get("/api/health", (c) => c.json({ ok: true }));
app.get("/api/matches", async (c) => c.json(await getKnockoutMatches(c.env)));
app.get("/api/matches/:id", async (c) => {
  const d = await getMatchDetail(c.env, c.req.param("id"));
  return d ? c.json(d) : c.json({ error: "match not found" }, 404);
});
app.get("/api/teams", async (c) => c.json(await getTeams(c.env)));
app.get("/api/players", async (c) => c.json(await getProjectedPool(c.env)));
app.get("/api/bracket-structure", async (c) =>
  c.json(buildBracket(await getKnockoutMatches(c.env)))
);

// ---------- leagues / auth ----------
app.post("/api/leagues", async (c) => {
  const body = await c.req.json().catch(() => ({}) as any);
  const name = validName(body.name, 50);
  const commissionerName = validName(body.commissionerName, 24);
  if (!name || !commissionerName)
    return c.json({ error: "league name (≤50) and your name (≤24) are required" }, 400);

  let code = makeCode();
  for (let i = 0; i < 6; i++) {
    const ex = await c.env.DB.prepare("SELECT id FROM leagues WHERE code = ?").bind(code).first();
    if (!ex) break;
    code = makeCode();
  }
  const leagueId = uid();
  const memberId = uid();
  const token = uid();
  const t = now();
  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO leagues (id, name, code, draft_status, bracket_locked, created_at) VALUES (?, ?, ?, 'pending', 0, ?)"
    ).bind(leagueId, name, code, t),
    c.env.DB.prepare(
      "INSERT INTO members (id, token, league_id, name, is_commissioner, created_at) VALUES (?, ?, ?, ?, 1, ?)"
    ).bind(memberId, token, leagueId, commissionerName, t),
  ]);
  const league = await c.env.DB.prepare("SELECT * FROM leagues WHERE id = ?")
    .bind(leagueId)
    .first<LeagueRow>();
  const session: Session = {
    token,
    memberId,
    leagueId,
    name: commissionerName,
    isCommissioner: true,
  };
  return c.json({ session, league: await leaguePayload(c.env, league!) });
});

app.post("/api/leagues/join", async (c) => {
  const body = await c.req.json().catch(() => ({}) as any);
  const code = String(body.code ?? "").trim().toUpperCase();
  const name = validName(body.name, 24);
  if (!code || !name) return c.json({ error: "league code and your name (≤24) are required" }, 400);

  const league = await c.env.DB.prepare("SELECT * FROM leagues WHERE code = ?")
    .bind(code)
    .first<LeagueRow>();
  if (!league) return c.json({ error: "no league found for that code" }, 404);

  const existing = await c.env.DB.prepare(
    "SELECT id FROM members WHERE league_id = ? AND lower(name) = lower(?)"
  )
    .bind(league.id, name)
    .first();
  if (existing) return c.json({ error: "that name is already taken in this league" }, 409);
  // Joining is allowed anytime. If the draft has already started, the new member
  // simply has no draft seat (bracket-only) until the commissioner resets & re-drafts.

  const memberId = uid();
  const token = uid();
  await c.env.DB.prepare(
    "INSERT INTO members (id, token, league_id, name, is_commissioner, created_at) VALUES (?, ?, ?, ?, 0, ?)"
  )
    .bind(memberId, token, league.id, name, now())
    .run();
  const session: Session = { token, memberId, leagueId: league.id, name, isCommissioner: false };
  return c.json({ session, league: await leaguePayload(c.env, league) });
});

app.get("/api/league", requireAuth, async (c) =>
  c.json(await leaguePayload(c.env, c.get("league")))
);

// Commissioner removes a player from the league. Only before the draft starts —
// once seats and squads exist, dropping a member would renumber the snake draft.
app.post("/api/members/remove", requireAuth, async (c) => {
  const league = c.get("league");
  const member = c.get("member");
  if (!member.is_commissioner)
    return c.json({ error: "only the commissioner can remove players" }, 403);
  if (league.draft_status !== "pending")
    return c.json({ error: "players can only be removed before the draft starts" }, 409);

  const body = await c.req.json().catch(() => ({}) as any);
  const memberId = String(body.memberId ?? "");
  if (!memberId) return c.json({ error: "memberId is required" }, 400);
  if (memberId === member.id) return c.json({ error: "you can't remove yourself" }, 400);

  const target = await c.env.DB.prepare(
    "SELECT id, is_commissioner FROM members WHERE id = ? AND league_id = ?"
  )
    .bind(memberId, league.id)
    .first<any>();
  if (!target) return c.json({ error: "player not found in this league" }, 404);
  if (target.is_commissioner) return c.json({ error: "can't remove the commissioner" }, 400);

  // Cascade: drop the member's picks across all three games, then the member.
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM draft_picks WHERE league_id = ? AND member_id = ?").bind(league.id, memberId),
    c.env.DB.prepare("DELETE FROM bracket_picks WHERE league_id = ? AND member_id = ?").bind(league.id, memberId),
    c.env.DB.prepare("DELETE FROM predictions WHERE league_id = ? AND member_id = ?").bind(league.id, memberId),
    c.env.DB.prepare("DELETE FROM members WHERE id = ? AND league_id = ?").bind(memberId, league.id),
  ]);
  return c.json(await leaguePayload(c.env, league));
});
app.get("/api/me", requireAuth, (c) => {
  const m = c.get("member");
  const session: Session = {
    token: m.token,
    memberId: m.id,
    leagueId: m.league_id,
    name: m.name,
    isCommissioner: !!m.is_commissioner,
  };
  return c.json({ session });
});

// Change your display name (unique within the league).
app.post("/api/me/name", requireAuth, async (c) => {
  const m = c.get("member");
  const body = await c.req.json().catch(() => ({}) as any);
  const name = String(body.name ?? "").trim();
  if (!name) return c.json({ error: "name is required" }, 400);
  if (name.length > 24) return c.json({ error: "name is too long (max 24)" }, 400);
  const dup = await c.env.DB.prepare(
    "SELECT id FROM members WHERE league_id = ? AND lower(name) = lower(?) AND id <> ?"
  )
    .bind(m.league_id, name, m.id)
    .first();
  if (dup) return c.json({ error: "that name is already taken in this league" }, 409);
  await c.env.DB.prepare("UPDATE members SET name = ? WHERE id = ?").bind(name, m.id).run();
  const session: Session = {
    token: m.token,
    memberId: m.id,
    leagueId: m.league_id,
    name,
    isCommissioner: !!m.is_commissioner,
  };
  return c.json({ session });
});

// ---------- draft ----------
app.get("/api/draft", requireAuth, async (c) =>
  c.json(await getDraftState(c.env, c.get("league"), c.get("member").id))
);

// Toggle draft participation (only before the draft starts). Members set their own;
// the commissioner can set anyone's. Bracket & predictions stay open to everyone.
app.post("/api/draft/optin", requireAuth, async (c) => {
  const member = c.get("member");
  const league = c.get("league");
  if (league.draft_status !== "pending")
    return c.json({ error: "the draft has already started" }, 409);
  const body = await c.req.json().catch(() => ({}) as any);
  const inDraft = body.in ? 1 : 0;
  const targetId = String(body.memberId ?? member.id);
  if (targetId !== member.id && !member.is_commissioner)
    return c.json({ error: "only the commissioner can change another player" }, 403);
  const target = await c.env.DB.prepare(
    "SELECT id FROM members WHERE id = ? AND league_id = ?"
  )
    .bind(targetId, league.id)
    .first();
  if (!target) return c.json({ error: "player not found in this league" }, 404);
  await c.env.DB.prepare("UPDATE members SET in_draft = ? WHERE id = ? AND league_id = ?")
    .bind(inDraft, targetId, league.id)
    .run();
  return c.json(await leaguePayload(c.env, league));
});

// Commissioner sets the league formation (shared squad shape), before the draft starts.
app.post("/api/league/formation", requireAuth, async (c) => {
  const member = c.get("member");
  const league = c.get("league");
  if (!member.is_commissioner)
    return c.json({ error: "only the commissioner can set the formation" }, 403);
  if (league.draft_status !== "pending")
    return c.json({ error: "the formation locks once the draft starts" }, 409);
  const body = await c.req.json().catch(() => ({}) as any);
  const formation = String(body.formation ?? "");
  if (!(FORMATIONS as readonly string[]).includes(formation))
    return c.json({ error: "invalid formation" }, 400);
  await c.env.DB.prepare("UPDATE leagues SET formation = ? WHERE id = ?")
    .bind(formation, league.id)
    .run();
  const fresh = await c.env.DB.prepare("SELECT * FROM leagues WHERE id = ?")
    .bind(league.id)
    .first<LeagueRow>();
  return c.json(await leaguePayload(c.env, fresh!));
});

// Commissioner sets the per-pick draft clock (0 = off), before the draft starts.
app.post("/api/league/clock", requireAuth, async (c) => {
  const member = c.get("member");
  const league = c.get("league");
  if (!member.is_commissioner)
    return c.json({ error: "only the commissioner can set the clock" }, 403);
  if (league.draft_status !== "pending")
    return c.json({ error: "the clock locks once the draft starts" }, 409);
  const body = await c.req.json().catch(() => ({}) as any);
  const seconds = Number(body.seconds);
  if (!(PICK_CLOCKS as readonly number[]).includes(seconds))
    return c.json({ error: "invalid clock" }, 400);
  await c.env.DB.prepare("UPDATE leagues SET pick_clock_seconds = ? WHERE id = ?")
    .bind(seconds, league.id)
    .run();
  const fresh = await c.env.DB.prepare("SELECT * FROM leagues WHERE id = ?")
    .bind(league.id)
    .first<LeagueRow>();
  return c.json(await leaguePayload(c.env, fresh!));
});

app.post("/api/draft/start", requireAuth, async (c) => {
  const member = c.get("member");
  const league = c.get("league");
  if (!member.is_commissioner)
    return c.json({ error: "only the commissioner can start the draft" }, 403);
  if (league.draft_status !== "pending")
    return c.json({ error: "the draft has already started" }, 409);
  const members = (await loadMembers(c.env, league.id)).filter((m) => m.in_draft);
  if (members.length < 2)
    return c.json({ error: "you need at least 2 players opted in to draft" }, 400);

  const arr = [...members];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  const stmts = arr.map((m, i) =>
    c.env.DB.prepare("UPDATE members SET draft_position = ? WHERE id = ?").bind(i + 1, m.id)
  );
  stmts.push(
    c.env.DB.prepare(
      "UPDATE leagues SET draft_status = 'active', draft_started_at = ? WHERE id = ?"
    ).bind(now(), league.id)
  );
  await c.env.DB.batch(stmts);
  await addActivity(c.env, league.id, "draft", "🏁", "The draft is live!", `draftstart:${league.id}`);
  const fresh = await c.env.DB.prepare("SELECT * FROM leagues WHERE id = ?")
    .bind(league.id)
    .first<LeagueRow>();
  return c.json(await getDraftState(c.env, fresh!, member.id));
});

app.post("/api/draft/pick", requireAuth, async (c) => {
  const member = c.get("member");
  let league = c.get("league");
  if (league.draft_status !== "active") return c.json({ error: "the draft is not active" }, 409);

  const body = await c.req.json().catch(() => ({}) as any);
  const playerId = String(body.playerId ?? "");
  if (!playerId) return c.json({ error: "playerId is required" }, 400);

  const state = await getDraftState(c.env, league, member.id);
  if (state.onTheClockMemberId !== member.id)
    return c.json({ error: "it's not your pick yet" }, 409);

  const player = (await getPlayerPool(c.env)).find((p) => p.id === playerId);
  if (!player) return c.json({ error: "unknown player" }, 400);
  if (state.picks.some((p) => p.playerId === playerId))
    return c.json({ error: "that player is already drafted" }, 409);

  const myAtPos = state.picks.filter(
    (p) => p.memberId === member.id && p.position === player.position
  ).length;
  if (myAtPos >= state.squad[player.position])
    return c.json({ error: `your ${player.position} slots are full` }, 409);

  const pickNumber = state.currentPickNumber;
  // Acquisition baseline: if drafting mid-tournament, the player only scores from now on.
  const statsMap = await getFantasyStatsMap(c.env);
  const baseline = acquisitionBaseline(statsMap, player.id, player.position);
  // Race-safe: if the clock just expired and an autopick filled this slot first, this
  // no-ops and we return the current state rather than double-pick.
  const placed = await insertPickIfOpen(c.env, league.id, member.id, player, pickNumber, baseline);
  if (!placed) return c.json(await getDraftState(c.env, league, member.id));
  await c.env.DB.prepare("UPDATE members SET auto_draft = 0 WHERE id = ?").bind(member.id).run(); // back in control
  await addActivity(
    c.env,
    league.id,
    "draft",
    "🟢",
    `${member.name} drafted ${player.name} (${player.team.abbr}) · pick ${pickNumber}`,
    `draft:${league.id}:${pickNumber}`
  );

  if (pickNumber >= state.totalPicks) {
    await c.env.DB.prepare("UPDATE leagues SET draft_status = 'done' WHERE id = ?")
      .bind(league.id)
      .run();
    league = { ...league, draft_status: "done" };
    await addActivity(c.env, league.id, "draft", "✅", "Draft complete — squads are set", `draftdone:${league.id}`);
  }
  return c.json(await getDraftState(c.env, league, member.id));
});

// Fill any turn whose clock has expired (autopick the top of the ranked board).
// Called by clients the instant their countdown hits 0, and by the cron as a backstop.
app.post("/api/draft/autopick", requireAuth, async (c) => {
  const league = c.get("league");
  const member = c.get("member");
  await runAutopick(c.env, league);
  const fresh = await c.env.DB.prepare("SELECT * FROM leagues WHERE id = ?")
    .bind(league.id)
    .first<LeagueRow>();
  return c.json(await getDraftState(c.env, fresh!, member.id));
});

// Take back control after being put on sticky autopick (your clock resumes normally).
app.post("/api/draft/resume", requireAuth, async (c) => {
  const member = c.get("member");
  const league = c.get("league");
  await c.env.DB.prepare("UPDATE members SET auto_draft = 0 WHERE id = ?").bind(member.id).run();
  return c.json(await getDraftState(c.env, league, member.id));
});

// Set (or clear) your captain for a knockout round — their points that round count
// double. Open once the draft's done; locks the moment that round kicks off.
app.post("/api/draft/captain", requireAuth, async (c) => {
  const member = c.get("member");
  const league = c.get("league");
  if (league.draft_status !== "done")
    return c.json({ error: "captains open once the draft is complete" }, 409);
  const body = await c.req.json().catch(() => ({}) as any);
  const round = String(body.round ?? "") as RoundCode;
  const playerId = String(body.playerId ?? "");
  if (!KNOCKOUT_ROUNDS.some((r) => r.round === round))
    return c.json({ error: "invalid round" }, 400);
  const km = await getKnockoutMatches(c.env);
  if (km.some((m) => m.round === round && m.state !== "pre"))
    return c.json({ error: "that round has already kicked off — captain is locked" }, 409);

  if (playerId) {
    const owns = await c.env.DB.prepare(
      "SELECT 1 FROM draft_picks WHERE league_id = ? AND member_id = ? AND team_id = ? AND dropped = 0"
    )
      .bind(league.id, member.id, playerId)
      .first();
    if (!owns) return c.json({ error: "you don't have that player on your squad" }, 400);
    await c.env.DB.prepare(
      `INSERT INTO captains (league_id, member_id, round, player_id, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(league_id, member_id, round)
       DO UPDATE SET player_id = excluded.player_id, updated_at = excluded.updated_at`
    )
      .bind(league.id, member.id, round, playerId, now())
      .run();
  } else {
    await c.env.DB.prepare(
      "DELETE FROM captains WHERE league_id = ? AND member_id = ? AND round = ?"
    )
      .bind(league.id, member.id, round)
      .run();
  }
  return c.json(await getDraftState(c.env, league, member.id));
});

// Play a one-time chip on a round (or move/cancel it before that round kicks off).
// Each chip is usable once for the whole tournament; once its round starts it's locked.
app.post("/api/draft/chip", requireAuth, async (c) => {
  const member = c.get("member");
  const league = c.get("league");
  if (league.draft_status !== "done")
    return c.json({ error: "chips open once the draft is complete" }, 409);
  const body = await c.req.json().catch(() => ({}) as any);
  const chip = String(body.chip ?? "") as ChipId;
  const round =
    body.round == null || body.round === "" ? null : (String(body.round) as RoundCode);
  if (!CHIPS.some((ch) => ch.id === chip)) return c.json({ error: "invalid chip" }, 400);

  const km = await getKnockoutMatches(c.env);
  const kickedOff = (r: RoundCode) => km.some((m) => m.round === r && m.state !== "pre");

  // If the chip is already on a round that has kicked off, it's locked — no changes.
  const existing = await c.env.DB.prepare(
    "SELECT round FROM chips WHERE league_id = ? AND member_id = ? AND chip = ?"
  )
    .bind(league.id, member.id, chip)
    .first<{ round: RoundCode }>();
  if (existing && kickedOff(existing.round))
    return c.json({ error: "that chip is already locked in" }, 409);

  if (round == null) {
    await c.env.DB.prepare("DELETE FROM chips WHERE league_id = ? AND member_id = ? AND chip = ?")
      .bind(league.id, member.id, chip)
      .run();
    return c.json(await getDraftState(c.env, league, member.id));
  }

  if (!KNOCKOUT_ROUNDS.some((r) => r.round === round))
    return c.json({ error: "invalid round" }, 400);
  if (kickedOff(round))
    return c.json({ error: "that round has already kicked off" }, 409);
  // One chip per round — can't stack Triple Captain and All-In on the same round.
  const clash = await c.env.DB.prepare(
    "SELECT 1 FROM chips WHERE league_id = ? AND member_id = ? AND chip != ? AND round = ?"
  )
    .bind(league.id, member.id, chip, round)
    .first();
  if (clash) return c.json({ error: "you can only play one chip per round" }, 409);

  await c.env.DB.prepare(
    `INSERT INTO chips (league_id, member_id, chip, round, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(league_id, member_id, chip)
     DO UPDATE SET round = excluded.round, updated_at = excluded.updated_at`
  )
    .bind(league.id, member.id, chip, round, now())
    .run();
  return c.json(await getDraftState(c.env, league, member.id));
});

// Per-round transfer: drop a squad player, add a free agent (same position).
// Budget = TRANSFERS_PER_ROUND per completed knockout round. Snapshot scoring keeps
// the dropped player's banked points and starts the new player from their baseline.
app.post("/api/draft/transfer", requireAuth, async (c) => {
  const member = c.get("member");
  const league = c.get("league");
  if (league.draft_status !== "done")
    return c.json({ error: "transfers open once the draft is complete" }, 409);

  const body = await c.req.json().catch(() => ({}) as any);
  const dropPlayerId = String(body.dropPlayerId ?? "");
  const addPlayerId = String(body.addPlayerId ?? "");
  if (!dropPlayerId || !addPlayerId)
    return c.json({ error: "dropPlayerId and addPlayerId are required" }, 400);

  const matches = await getKnockoutMatches(c.env);
  const completedRounds = countCompletedRounds(matches);
  const usedRow = await c.env.DB.prepare(
    "SELECT COUNT(*) AS c FROM draft_picks WHERE league_id = ? AND member_id = ? AND dropped = 1"
  )
    .bind(league.id, member.id)
    .first<{ c: number }>();
  if ((usedRow?.c ?? 0) >= completedRounds * TRANSFERS_PER_ROUND)
    return c.json(
      {
        error:
          completedRounds === 0
            ? "transfers open after the first round finishes"
            : "no transfers left right now",
      },
      409
    );

  const dropPick = await c.env.DB.prepare(
    "SELECT id, position, team_name, country_id FROM draft_picks WHERE league_id = ? AND member_id = ? AND team_id = ? AND dropped = 0"
  )
    .bind(league.id, member.id, dropPlayerId)
    .first<any>();
  if (!dropPick) return c.json({ error: "you don't have that player on your squad" }, 400);

  const addPlayer = (await getPlayerPool(c.env)).find((p) => p.id === addPlayerId);
  if (!addPlayer) return c.json({ error: "unknown player" }, 400);
  if (addPlayer.position !== dropPick.position)
    return c.json({ error: `you must swap like-for-like (a ${dropPick.position})` }, 409);

  const active = await c.env.DB.prepare(
    "SELECT 1 FROM draft_picks WHERE league_id = ? AND team_id = ? AND dropped = 0"
  )
    .bind(league.id, addPlayerId)
    .first();
  if (active) return c.json({ error: "that player is already on a squad" }, 409);

  if (eliminatedTeams(matches).has(addPlayer.team.id))
    return c.json({ error: "that player's team is eliminated — they can't score" }, 409);

  // Mid-round, you may only swap players whose match this round hasn't kicked off yet — so you
  // can't drop someone who already played (banking their points) and add someone who hasn't
  // (collecting theirs) to cycle one slot across staggered games. Between rounds this is skipped.
  const ar = activeRound(matches);
  if (ar) {
    const roundMatch = (teamId: string) =>
      matches.find((m) => m.round === ar && (m.home?.id === teamId || m.away?.id === teamId));
    const dropM = roundMatch(dropPick.country_id);
    const addM = roundMatch(addPlayer.team.id);
    // Drop OK if their round match is still to come (or they're not in this round at all —
    // eliminated earlier, 0 points this round); add OK only if their round match hasn't started.
    const dropOk = !dropM || dropM.state === "pre";
    const addOk = !!addM && addM.state === "pre";
    if (!dropOk || !addOk)
      return c.json(
        { error: "mid-round you can only swap players whose match this round hasn't kicked off yet" },
        409
      );
  }

  const statsMap = await getFantasyStatsMap(c.env);
  const addBaseline = statsMap[addPlayerId]
    ? fantasyPoints(statsMap[addPlayerId], addPlayer.position)
    : 0;
  const dropCurrent = statsMap[dropPlayerId]
    ? fantasyPoints(statsMap[dropPlayerId], dropPick.position)
    : 0;
  const maxRow = await c.env.DB.prepare(
    "SELECT MAX(pick_number) AS m FROM draft_picks WHERE league_id = ?"
  )
    .bind(league.id)
    .first<{ m: number }>();
  const nextPick = (maxRow?.m ?? 0) + 1;

  try {
    // Atomic drop+add. If two managers race for the same free agent, the idx_active_owner
    // lock makes the second INSERT fail, the batch rolls back (the drop too), and we 409.
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE draft_picks SET dropped = 1, drop_pts = ? WHERE id = ?").bind(
        dropCurrent,
        dropPick.id
      ),
      c.env.DB.prepare(
        `INSERT INTO draft_picks (league_id, member_id, team_id, team_name, position, country, country_id, baseline_pts, dropped, drop_pts, pick_number, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?)`
      ).bind(
        league.id,
        member.id,
        addPlayer.id,
        addPlayer.name,
        addPlayer.position,
        addPlayer.team.name,
        addPlayer.team.id,
        addBaseline,
        nextPick,
        now()
      ),
    ]);
  } catch {
    return c.json({ error: "that player was just picked up by someone else" }, 409);
  }
  // Log the transfer event (drop + add) for the history feed and per-player churn counts.
  await c.env.DB.prepare(
    `INSERT INTO transfers (league_id, member_id, out_player_id, out_player_name, in_player_id, in_player_name, position, out_pts, in_baseline, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      league.id,
      member.id,
      dropPlayerId,
      dropPick.team_name,
      addPlayer.id,
      addPlayer.name,
      dropPick.position,
      dropCurrent,
      addBaseline,
      now()
    )
    .run();
  await addActivity(
    c.env,
    league.id,
    "transfer",
    "🔄",
    `${member.name} transferred in ${addPlayer.name} for ${dropPick.team_name}`,
    `transfer:${league.id}:${nextPick}`
  );

  return c.json(await getDraftState(c.env, league, member.id));
});

// The league's transfer history — every drop+add, newest first.
app.get("/api/draft/transfers", requireAuth, async (c) => {
  const league = c.get("league");
  const rows = await c.env.DB.prepare(
    `SELECT t.id, t.member_id, m.name AS member_name, t.out_player_id, t.out_player_name,
            t.in_player_id, t.in_player_name, t.position, t.out_pts, t.in_baseline, t.created_at
     FROM transfers t JOIN members m ON m.id = t.member_id
     WHERE t.league_id = ? ORDER BY t.created_at DESC, t.id DESC`
  )
    .bind(league.id)
    .all<any>();
  return c.json(
    (rows.results ?? []).map((r: any) => ({
      id: r.id,
      memberId: r.member_id,
      memberName: r.member_name,
      outPlayerId: r.out_player_id,
      outPlayerName: r.out_player_name,
      inPlayerId: r.in_player_id,
      inPlayerName: r.in_player_name,
      position: r.position,
      outPts: r.out_pts,
      inBaseline: r.in_baseline,
      createdAt: r.created_at,
    }))
  );
});

// Commissioner-only: wipe all draft picks + seats and reopen the draft. Lets a
// league re-draft from scratch (e.g. after late joiners arrive).
app.post("/api/draft/reset", requireAuth, async (c) => {
  const member = c.get("member");
  const league = c.get("league");
  if (!member.is_commissioner)
    return c.json({ error: "only the commissioner can reset the draft" }, 403);
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM draft_picks WHERE league_id = ?").bind(league.id),
    c.env.DB.prepare("DELETE FROM transfers WHERE league_id = ?").bind(league.id),
    c.env.DB.prepare("UPDATE members SET draft_position = NULL WHERE league_id = ?").bind(league.id),
    c.env.DB.prepare(
      "UPDATE leagues SET draft_status = 'pending', draft_started_at = NULL WHERE id = ?"
    ).bind(league.id),
  ]);
  const fresh = await c.env.DB.prepare("SELECT * FROM leagues WHERE id = ?")
    .bind(league.id)
    .first<LeagueRow>();
  return c.json(await getDraftState(c.env, fresh!, member.id));
});

// ---------- bracket ----------
app.get("/api/bracket", requireAuth, async (c) => {
  const league = c.get("league");
  const member = c.get("member");
  const matches = await getKnockoutMatches(c.env);
  const bracket = buildBracket(matches);
  const picksRes = await c.env.DB.prepare(
    "SELECT slot_key, team_id, team_name, updated_at FROM bracket_picks WHERE league_id = ? AND member_id = ?"
  )
    .bind(league.id, member.id)
    .all<any>();
  // Re-home legacy keys, dedupe, and drop path-orphans so the bracket is consistent.
  const { picks } = resolveMemberPicks(bracket, picksRes.results ?? []);
  return c.json({ bracket, picks, locked: !!league.bracket_locked });
});

app.post("/api/bracket/pick", requireAuth, async (c) => {
  const league = c.get("league");
  const member = c.get("member");
  if (league.bracket_locked) return c.json({ error: "the bracket is locked" }, 409);

  const body = await c.req.json().catch(() => ({}) as any);
  const slotKey = String(body.slotKey ?? "");
  const teamId = String(body.teamId ?? "");
  const teamName = String(body.teamName ?? "");
  if (!slotKey || !teamId) return c.json({ error: "slotKey and teamId are required" }, 400);

  const matches = await getKnockoutMatches(c.env);
  const bracket = buildBracket(matches);
  const slot = bracket.slots.find((s) => s.key === slotKey);
  if (!slot) return c.json({ error: "unknown bracket slot" }, 400);
  const ev = matches.find((m) => m.id === slot.eventId);
  if (ev && ev.state !== "pre")
    return c.json({ error: "that match has already kicked off — pick is locked" }, 409);

  // Persist against the match's immutable eventId, not the volatile "R32-N" slot
  // position — so a future re-numbering can never re-point this pick.
  await c.env.DB.prepare(
    `INSERT INTO bracket_picks (league_id, member_id, slot_key, team_id, team_name, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(league_id, member_id, slot_key)
     DO UPDATE SET team_id = excluded.team_id, team_name = excluded.team_name, updated_at = excluded.updated_at`
  )
    .bind(league.id, member.id, slot.eventId, teamId, teamName, now())
    .run();

  // Cascade-clear: this pick may have orphaned a downstream one (e.g. changing an R16
  // winner strands a QF pick for the team that no longer advances). Re-resolve and
  // delete the stale/orphaned rows so the bracket stays consistent. Never touch the row
  // we just wrote.
  const fresh = await c.env.DB.prepare(
    "SELECT slot_key, team_id, team_name, updated_at FROM bracket_picks WHERE league_id = ? AND member_id = ?"
  )
    .bind(league.id, member.id)
    .all<any>();
  const { picks, dropKeys } = resolveMemberPicks(bracket, fresh.results ?? []);
  for (const sk of dropKeys) {
    if (sk === slot.eventId) continue;
    await c.env.DB.prepare(
      "DELETE FROM bracket_picks WHERE league_id = ? AND member_id = ? AND slot_key = ?"
    )
      .bind(league.id, member.id, sk)
      .run();
  }
  return c.json({ ok: true, picks });
});

// Reveal everyone's picks — but only for slots whose match has kicked off (or
// once the commissioner locks the bracket). No peeking at upcoming picks.
app.get("/api/bracket/reveal", requireAuth, async (c) => {
  const league = c.get("league");
  const matches = await getKnockoutMatches(c.env);
  const bracket = buildBracket(matches);
  const stateByKey = new Map(bracket.slots.map((s) => [s.key, s.state]));
  const locked = !!league.bracket_locked;

  const rows = await c.env.DB.prepare(
    `SELECT bp.slot_key, bp.team_id, bp.team_name, bp.updated_at, bp.member_id, m.name AS member_name
     FROM bracket_picks bp JOIN members m ON m.id = bp.member_id
     WHERE bp.league_id = ?`
  )
    .bind(league.id)
    .all<any>();

  // Resolve each member's bracket independently (re-home + dedupe + prune orphans),
  // then group the consistent picks by slot — gated so only kicked-off slots reveal.
  const byMember = new Map<string, { name: string; rows: any[] }>();
  for (const r of rows.results ?? []) {
    const e = byMember.get(r.member_id) ?? byMember.set(r.member_id, { name: r.member_name, rows: [] }).get(r.member_id)!;
    e.rows.push(r);
  }
  const slots: Record<string, { memberId: string; memberName: string; teamId: string; teamName: string }[]> = {};
  for (const [memberId, { name, rows: mrows }] of byMember) {
    const { picks } = resolveMemberPicks(bracket, mrows);
    for (const [key, p] of Object.entries(picks)) {
      const revealed = locked || (stateByKey.get(key) ?? "pre") !== "pre";
      if (!revealed) continue;
      (slots[key] ||= []).push({ memberId, memberName: name, teamId: p.teamId, teamName: p.teamName });
    }
  }
  return c.json({ slots, locked });
});

app.post("/api/bracket/lock", requireAuth, async (c) => {
  const member = c.get("member");
  const league = c.get("league");
  if (!member.is_commissioner)
    return c.json({ error: "only the commissioner can lock the bracket" }, 403);
  const body = await c.req.json().catch(() => ({}) as any);
  const locked = body.locked === false ? 0 : 1;
  await c.env.DB.prepare("UPDATE leagues SET bracket_locked = ? WHERE id = ?")
    .bind(locked, league.id)
    .run();
  return c.json({ ok: true, locked: !!locked });
});

// ---------- leaderboards ----------
// Shared inputs for both draft fantasy boards (total points + head-to-head): the
// squad picks, per-round stats, the league's captains, and the upset multiplier.
async function draftScoringInputs(env: Env, league: LeagueRow) {
  const matches = await getKnockoutMatches(env);
  const members = (await loadMembers(env, league.id)).map(publicMember);
  const picksRes = await env.DB.prepare(
    "SELECT member_id, team_id, team_name, position, country, country_id, baseline_pts, dropped, drop_pts, created_at FROM draft_picks WHERE league_id = ?"
  )
    .bind(league.id)
    .all<any>();
  const picks = (picksRes.results ?? []).map((r: any) => ({
    memberId: r.member_id,
    playerId: r.team_id,
    playerName: r.team_name,
    position: r.position as Position,
    country: r.country,
    teamId: r.country_id,
    baseline: r.baseline_pts ?? 0,
    dropped: !!r.dropped,
    dropPts: r.drop_pts,
    acquiredAt: r.created_at ?? undefined,
    releasedAt: null as number | null,
  }));

  // Ownership windows: a dropped spell's release time is the transfer that moved that
  // player off that manager's squad. Zip a member+player's dropped spells (oldest first)
  // to their drop timestamps so re-acquire/re-drop chains still pair up correctly.
  const txRes = await env.DB.prepare(
    "SELECT member_id, out_player_id, created_at FROM transfers WHERE league_id = ?"
  )
    .bind(league.id)
    .all<{ member_id: string; out_player_id: string; created_at: number }>();
  const dropTimes = new Map<string, number[]>();
  for (const t of txRes.results ?? []) {
    const k = `${t.member_id}|${t.out_player_id}`;
    (dropTimes.get(k) ?? dropTimes.set(k, []).get(k)!).push(t.created_at);
  }
  for (const arr of dropTimes.values()) arr.sort((a, b) => a - b);
  const byMP = new Map<string, typeof picks>();
  for (const p of picks)
    (byMP.get(`${p.memberId}|${p.playerId}`) ?? byMP.set(`${p.memberId}|${p.playerId}`, []).get(`${p.memberId}|${p.playerId}`)!).push(p);
  for (const [k, spells] of byMP) {
    spells.sort((a, b) => (a.acquiredAt ?? 0) - (b.acquiredAt ?? 0));
    const drops = dropTimes.get(k) ?? [];
    let di = 0;
    for (const s of spells) s.releasedAt = s.dropped ? drops[di++] ?? null : null;
  }

  // Positions for EVERY player (drafted or not) — the per-match log covers free agents too.
  const pool = await getPlayerPool(env);
  const poolById = new Map(pool.map((p) => [p.id, p]));
  const positions: Record<string, Position> = {};
  for (const p of pool) positions[p.id] = p.position;
  for (const p of picks) positions[p.playerId] = p.position; // picks are authoritative

  // matchId -> kickoff epoch ms, so scoring can ignore matches that predate acquisition.
  const matchDate: Record<string, number> = {};
  for (const m of matches) matchDate[m.id] = new Date(m.date).getTime();

  const byRound = await getFantasyStatsByRound(env);
  const oddsMap = await getOddsMap(env);
  const matchById = new Map(matches.map((m) => [m.id, m]));
  const playerTeam = new Map(picks.map((p) => [p.playerId, p.teamId]));
  const capsRes = await env.DB.prepare(
    "SELECT member_id, round, player_id FROM captains WHERE league_id = ?"
  )
    .bind(league.id)
    .all<{ member_id: string; round: string; player_id: string }>();
  const captains: Record<string, Record<string, string>> = {};
  for (const r of capsRes.results ?? []) (captains[r.member_id] ??= {})[r.round] = r.player_id;
  const chipsRes = await env.DB.prepare(
    "SELECT member_id, chip, round FROM chips WHERE league_id = ?"
  )
    .bind(league.id)
    .all<{ member_id: string; chip: string; round: RoundCode }>();
  const chips: Record<string, Record<string, RoundCode>> = {};
  for (const r of chipsRes.results ?? []) (chips[r.member_id] ??= {})[r.chip] = r.round;
  // A player's points in a round their team won as an underdog get boosted.
  const upsetMult = (playerId: string, round: RoundCode): number => {
    const entry = byRound[playerId]?.[round];
    if (!entry) return 1;
    const m = matchById.get(entry.matchId);
    const teamId = playerTeam.get(playerId);
    if (!m?.winnerId || !teamId || teamId !== m.winnerId) return 1; // their team didn't win it
    const o = oddsMap[entry.matchId];
    if (!o) return 1;
    const wp = teamId === m.home?.id ? o.pHome : teamId === m.away?.id ? o.pAway : null;
    return wp == null ? 1 : upsetMultiplier(wp);
  };
  return {
    matches,
    members,
    picks,
    positions,
    poolById,
    extras: { byRound, captains, chips, matchDate, upsetMult },
  };
}

app.get("/api/leaderboard/draft", requireAuth, async (c) => {
  const { matches, members, picks, extras } = await draftScoringInputs(c.env, c.get("league"));
  return c.json(
    computeStandingsByMatch(members, picks, extras.byRound!, extras.matchDate!, eliminatedTeams(matches), extras)
  );
});

app.get("/api/leaderboard/h2h", requireAuth, async (c) => {
  const { members, picks, extras } = await draftScoringInputs(c.env, c.get("league"));
  return c.json(computeH2HStandings(members, picks, extras));
});

// Global player leaderboard: every player who's scored, ranked by total production, with
// their current owner and what that owner has actually banked from them (per-match model).
app.get("/api/leaderboard/players", requireAuth, async (c) => {
  const league = c.get("league");
  const me = c.get("member");
  const { picks, positions, extras, members, poolById } = await draftScoringInputs(c.env, league);
  const attr = attributeByMatch(picks, extras.byRound!, positions, extras.matchDate!, extras);
  const currentOwner = new Map<string, string>();
  for (const p of picks) if (!p.dropped) currentOwner.set(p.playerId, p.memberId);
  const memberName = new Map(members.map((m) => [m.id, m.name]));
  const rows = Object.entries(attr.playerLog)
    .map(([pid, log]) => {
      const total = log.reduce((s, e) => s + e.raw, 0);
      const ownerId = currentOwner.get(pid) ?? null;
      const banked = ownerId
        ? log.filter((e) => e.ownerId === ownerId).reduce((s, e) => s + e.attributed, 0)
        : 0;
      const pp = poolById.get(pid);
      return {
        playerId: pid,
        playerName: pp?.name ?? pid,
        position: positions[pid],
        team: pp?.team ?? { id: "", name: "?", abbr: "?" },
        total,
        ownerName: ownerId ? memberName.get(ownerId) ?? null : null,
        mine: ownerId === me.id,
        banked,
      };
    })
    .filter((r) => r.total !== 0)
    .sort((a, b) => b.total - a.total || a.playerName.localeCompare(b.playerName));
  return c.json(rows.slice(0, 100));
});

// One player's full fantasy history: match by match, what they did, who owned them then,
// any boost, and what that owner banked — the tap-through detail sheet.
app.get("/api/player/:playerId", requireAuth, async (c) => {
  const league = c.get("league");
  const me = c.get("member");
  const playerId = c.req.param("playerId");
  const { picks, positions, extras, members, matches, poolById } = await draftScoringInputs(c.env, league);
  const attr = attributeByMatch(picks, extras.byRound!, positions, extras.matchDate!, extras);
  const log = attr.playerLog[playerId] ?? [];
  const pp = poolById.get(playerId);
  const team = pp?.team ?? { id: "", name: "?", abbr: "?" };
  const byRound = extras.byRound!;
  const matchById = new Map(matches.map((m) => [m.id, m]));
  const memberName = new Map(members.map((m) => [m.id, m.name]));
  const matchLines = log.map((e) => {
    const m = matchById.get(e.matchId);
    const isHome = m?.home?.id === team.id;
    const opponent = (isHome ? m?.away : m?.home) ?? null;
    const teamScore = m ? (isHome ? m.homeScore : m.awayScore) : null;
    const oppScore = m ? (isHome ? m.awayScore : m.homeScore) : null;
    const won = m?.winnerId ? m.winnerId === team.id : null;
    const agg = byRound[playerId]?.[e.round]?.agg;
    return {
      round: e.round,
      matchId: e.matchId,
      opponent,
      teamScore,
      oppScore,
      won,
      breakdown: agg ? scoreBreakdown(agg, positions[playerId]) : [],
      raw: e.raw,
      ownerName: e.ownerId ? memberName.get(e.ownerId) ?? null : null,
      boost: e.multiplier,
      attributed: e.attributed,
    };
  });
  const total = log.reduce((s, e) => s + e.raw, 0);
  const ownerId = picks.find((p) => p.playerId === playerId && !p.dropped)?.memberId ?? null;
  const banked = ownerId
    ? log.filter((e) => e.ownerId === ownerId).reduce((s, e) => s + e.attributed, 0)
    : 0;
  return c.json({
    playerId,
    playerName: pp?.name ?? playerId,
    position: positions[playerId] ?? "MID",
    team,
    total,
    ownerName: ownerId ? memberName.get(ownerId) ?? null : null,
    mine: ownerId === me.id,
    banked,
    matches: matchLines,
  });
});

// Your squad's live fantasy points in one match — raw match points (no captain/chip),
// for the "points climbing" view while a game is on. Empty for a not-yet-started match.
app.get("/api/draft/match/:matchId/mine", requireAuth, async (c) => {
  const league = c.get("league");
  const member = c.get("member");
  const matchId = c.req.param("matchId");
  const m = (await getKnockoutMatches(c.env)).find((x) => x.id === matchId);
  if (!m) return c.json({ error: "match not found" }, 404);

  const picksRes = await c.env.DB.prepare(
    "SELECT team_id, team_name, position, country, country_id FROM draft_picks WHERE league_id = ? AND member_id = ? AND dropped = 0"
  )
    .bind(league.id, member.id)
    .all<any>();
  const mine = (picksRes.results ?? []).filter(
    (p: any) => p.country_id === m.home?.id || p.country_id === m.away?.id
  );
  if (m.state === "pre" || mine.length === 0)
    return c.json({ state: m.state, total: 0, players: [] });

  const stats = await getMatchPlayerStats(c.env, matchId, m.state === "post");
  const players = mine
    .map((p: any) => {
      const s = stats[p.team_id];
      const agg = {
        apps: s?.appeared ? 1 : 0,
        goals: s?.goals ?? 0,
        assists: s?.assists ?? 0,
        yellow: s?.yellow ?? 0,
        red: s?.red ?? 0,
        og: s?.og ?? 0,
        saves: s?.saves ?? 0,
        conceded: s?.conceded ?? 0,
        cleanSheets: s?.cleanSheet ? 1 : 0,
      };
      return {
        playerId: p.team_id,
        playerName: p.team_name,
        position: p.position,
        teamId: p.country_id,
        country: p.country,
        points: fantasyPoints(agg, p.position),
        goals: agg.goals,
        assists: agg.assists,
        breakdown: scoreBreakdown(agg, p.position),
      };
    })
    .sort((a, b) => b.points - a.points);
  return c.json({ state: m.state, total: players.reduce((s, p) => s + p.points, 0), players });
});

// Every player who took the pitch in this match (both teams) with the fantasy points they
// earned — the per-match scoreboard: top scorers, what each player got, who drafted them.
app.get("/api/match/:matchId/fantasy", requireAuth, async (c) => {
  const league = c.get("league");
  const member = c.get("member");
  const matchId = c.req.param("matchId");
  const m = (await getKnockoutMatches(c.env)).find((x) => x.id === matchId);
  if (!m) return c.json({ error: "match not found" }, 404);
  const base = { state: m.state, homeId: m.home?.id ?? null, awayId: m.away?.id ?? null };
  if (m.state === "pre") return c.json({ ...base, players: [] });

  const [stats, pool, picksRes, memRes] = await Promise.all([
    getMatchPlayerStats(c.env, matchId, m.state === "post"),
    getPlayerPool(c.env),
    c.env.DB.prepare(
      "SELECT team_id, member_id FROM draft_picks WHERE league_id = ? AND dropped = 0"
    )
      .bind(league.id)
      .all<{ team_id: string; member_id: string }>(),
    c.env.DB.prepare("SELECT id, name FROM members WHERE league_id = ?")
      .bind(league.id)
      .all<{ id: string; name: string }>(),
  ]);
  const poolById = new Map(pool.map((p) => [p.id, p]));
  const nameByMember = new Map((memRes.results ?? []).map((r) => [r.id, r.name]));
  const ownerByPlayer = new Map((picksRes.results ?? []).map((r) => [r.team_id, r.member_id]));
  const teamIds = new Set([m.home?.id, m.away?.id].filter(Boolean));

  const players = Object.entries(stats)
    .filter(([, s]) => s.appeared)
    .map(([id, s]) => {
      const pp = poolById.get(id);
      if (!pp || !teamIds.has(pp.team.id)) return null; // only the two teams' rostered players
      const agg = {
        apps: 1,
        goals: s.goals,
        assists: s.assists,
        yellow: s.yellow,
        red: s.red,
        og: s.og,
        saves: s.saves,
        conceded: s.conceded,
        cleanSheets: s.cleanSheet ? 1 : 0,
      };
      const ownerMember = ownerByPlayer.get(id) ?? null;
      return {
        playerId: id,
        playerName: pp.name,
        position: pp.position,
        teamId: pp.team.id,
        teamName: pp.team.name,
        points: fantasyPoints(agg, pp.position),
        goals: s.goals,
        assists: s.assists,
        breakdown: scoreBreakdown(agg, pp.position),
        ownerName: ownerMember ? nameByMember.get(ownerMember) ?? null : null,
        mine: ownerMember === member.id,
      };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null)
    .sort((a, b) => b.points - a.points || a.playerName.localeCompare(b.playerName));
  return c.json({ ...base, players });
});

// ---------- activity feed ----------
app.get("/api/activity", requireAuth, async (c) => {
  const league = c.get("league");
  const member = c.get("member");
  const rows = await c.env.DB.prepare(
    "SELECT id, kind, emoji, text, created_at FROM activity WHERE league_id = ? ORDER BY created_at DESC, id DESC LIMIT 40"
  )
    .bind(league.id)
    .all<{ id: number; kind: string; emoji: string; text: string; created_at: number }>();
  const items = rows.results ?? [];
  if (items.length === 0) return c.json([]);
  const ids = items.map((r) => r.id);
  const reRes = await c.env.DB.prepare(
    `SELECT activity_id, emoji, member_id FROM activity_reactions WHERE activity_id IN (${ids.map(() => "?").join(",")})`
  )
    .bind(...ids)
    .all<{ activity_id: number; emoji: string; member_id: string }>();
  const byItem = new Map<number, { counts: Record<string, number>; mine: string[] }>();
  for (const r of reRes.results ?? []) {
    const e = byItem.get(r.activity_id) ?? byItem.set(r.activity_id, { counts: {}, mine: [] }).get(r.activity_id)!;
    e.counts[r.emoji] = (e.counts[r.emoji] ?? 0) + 1;
    if (r.member_id === member.id) e.mine.push(r.emoji);
  }
  return c.json(
    items.map((r) => ({
      id: r.id,
      kind: r.kind,
      emoji: r.emoji,
      text: r.text,
      createdAt: r.created_at,
      reactions: byItem.get(r.id)?.counts ?? {},
      myReactions: byItem.get(r.id)?.mine ?? [],
    }))
  );
});

app.post("/api/activity/:id/react", requireAuth, async (c) => {
  const league = c.get("league");
  const member = c.get("member");
  const id = Number(c.req.param("id"));
  const body = await c.req.json().catch(() => ({}) as any);
  const emoji = String(body.emoji ?? "");
  if (!(REACTIONS as readonly string[]).includes(emoji))
    return c.json({ error: "invalid reaction" }, 400);
  const act = await c.env.DB.prepare("SELECT id FROM activity WHERE id = ? AND league_id = ?")
    .bind(id, league.id)
    .first();
  if (!act) return c.json({ error: "not found" }, 404);
  const existing = await c.env.DB.prepare(
    "SELECT 1 FROM activity_reactions WHERE activity_id = ? AND member_id = ? AND emoji = ?"
  )
    .bind(id, member.id, emoji)
    .first();
  if (existing) {
    await c.env.DB.prepare(
      "DELETE FROM activity_reactions WHERE activity_id = ? AND member_id = ? AND emoji = ?"
    )
      .bind(id, member.id, emoji)
      .run();
  } else {
    await c.env.DB.prepare(
      "INSERT OR IGNORE INTO activity_reactions (activity_id, member_id, emoji, created_at) VALUES (?, ?, ?, ?)"
    )
      .bind(id, member.id, emoji, now())
      .run();
  }
  return c.json({ ok: true });
});

app.get("/api/leaderboard/bracket", requireAuth, async (c) => {
  const league = c.get("league");
  const matches = await getKnockoutMatches(c.env);
  const bracket = buildBracket(matches);
  const members = (await loadMembers(c.env, league.id)).map(publicMember);
  const picksRes = await c.env.DB.prepare(
    "SELECT member_id, slot_key, team_id, team_name, updated_at FROM bracket_picks WHERE league_id = ?"
  )
    .bind(league.id)
    .all<any>();
  // Resolve each member's picks (re-home + dedupe + prune orphans), then flatten — so an
  // orphaned later pick can't earn or inflate a member's potential score.
  const byMember = new Map<string, any[]>();
  for (const r of picksRes.results ?? [])
    (byMember.get(r.member_id) ?? byMember.set(r.member_id, []).get(r.member_id)!).push(r);
  const picks: { memberId: string; slotKey: string; teamId: string; teamName: string }[] = [];
  for (const [memberId, rows] of byMember) {
    const { picks: pmap } = resolveMemberPicks(bracket, rows);
    for (const [slotKey, p] of Object.entries(pmap))
      picks.push({ memberId, slotKey, teamId: p.teamId, teamName: p.teamName });
  }
  // Champion picks stay secret until the Final kicks off (or the bracket is locked).
  const champSlot = bracket.slots.find((s) => s.key === bracket.champKey);
  const revealChampion = !!league.bracket_locked || (!!champSlot && champSlot.state !== "pre");
  const odds = await getOddsMap(c.env);
  return c.json(computeBracketStandings(bracket, members, picks, odds, { revealChampion }));
});

// ---------- matchday predictions ----------
app.get("/api/predictions/:id", requireAuth, async (c) => {
  const league = c.get("league");
  const member = c.get("member");
  const eventId = c.req.param("id");
  const matches = await getKnockoutMatches(c.env);
  const m = matches.find((x) => x.id === eventId);
  if (!m) return c.json({ error: "match not found" }, 404);
  const odds = await getOddsMap(c.env);
  // Pre-match, the closing line isn't frozen yet — pull the current line so the winner prop
  // can show each side's potential payout while it's still pickable.
  if (m.state === "pre") {
    const live = await getMatchOdds(c.env, m.id);
    if (live) odds[m.id] = live;
  }

  const mine = await c.env.DB.prepare(
    "SELECT prop, value FROM predictions WHERE league_id = ? AND member_id = ? AND event_id = ?"
  )
    .bind(league.id, member.id, eventId)
    .all<any>();
  const myPicks: Record<string, string> = {};
  for (const r of mine.results ?? []) myPicks[r.prop] = r.value;

  // Others' picks are only revealed once the match has kicked off.
  let revealRows: RevealRow[] | null = null;
  if (m.state !== "pre") {
    const all = await c.env.DB.prepare(
      `SELECT p.prop, p.value, mb.name AS member_name
       FROM predictions p JOIN members mb ON mb.id = p.member_id
       WHERE p.league_id = ? AND p.event_id = ?`
    )
      .bind(league.id, eventId)
      .all<any>();
    revealRows = (all.results ?? []).map((r: any) => ({
      prop: r.prop,
      value: r.value,
      memberName: r.member_name,
    }));
  }

  return c.json(buildSlateView(m, odds, myPicks, revealRows, propsForLeague(league.scoring)));
});

app.post("/api/predictions/:id", requireAuth, async (c) => {
  const league = c.get("league");
  const member = c.get("member");
  const eventId = c.req.param("id");
  const matches = await getKnockoutMatches(c.env);
  const m = matches.find((x) => x.id === eventId);
  if (!m) return c.json({ error: "match not found" }, 404);
  if (m.state !== "pre")
    return c.json({ error: "predictions are locked — the match has kicked off" }, 409);

  const body = await c.req.json().catch(() => ({}) as any);
  const prop = String(body.prop ?? "");
  const value = String(body.value ?? "").trim();
  const def = propsForLeague(league.scoring).find((d) => d.key === prop);
  if (!def) return c.json({ error: "unknown prop" }, 400); // also rejects dropped props (e.g. exact-score in a V2 league)
  if (!validateValue(def, value)) return c.json({ error: "invalid value for that prop" }, 400);

  // Winner ↔ exact-score must agree: a decisive score sets the winner; only a tie (→ pens)
  // lets you call the advancer freely. This makes the old "A wins + B wins it 2-0"
  // contradiction impossible to submit.
  if (prop === "winner" || prop === "score") {
    const otherKey = prop === "winner" ? "score" : "winner";
    const other = await c.env.DB.prepare(
      "SELECT value FROM predictions WHERE league_id = ? AND member_id = ? AND event_id = ? AND prop = ?"
    )
      .bind(league.id, member.id, eventId, otherKey)
      .first<{ value: string }>();
    if (other) {
      const sw = scoreWinner(prop === "score" ? value : other.value);
      const winnerVal = prop === "winner" ? value : other.value;
      if (sw && sw !== winnerVal)
        return c.json(
          { error: "Your winner and exact score must agree — match them, or predict a tie." },
          409
        );
    }
  }

  await c.env.DB.prepare(
    `INSERT INTO predictions (league_id, member_id, event_id, prop, value, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(league_id, member_id, event_id, prop)
     DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  )
    .bind(league.id, member.id, eventId, prop, value, now())
    .run();
  return c.json({ ok: true });
});

app.get("/api/leaderboard/predictions", requireAuth, async (c) => {
  const league = c.get("league");
  const matches = await getKnockoutMatches(c.env);
  const odds = await getOddsMap(c.env);
  const members = (await loadMembers(c.env, league.id)).map(publicMember);
  const rowsRes = await c.env.DB.prepare(
    "SELECT member_id, event_id, prop, value FROM predictions WHERE league_id = ?"
  )
    .bind(league.id)
    .all<any>();
  const rows = (rowsRes.results ?? []).map((r: any) => ({
    memberId: r.member_id,
    eventId: r.event_id,
    prop: r.prop,
    value: r.value,
  }));
  return c.json(computePredictionStandings(matches, members, rows, odds));
});

// ---------- fallbacks ----------
app.all("/api/*", (c) => c.json({ error: "not found" }, 404));
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default {
  fetch: (req: Request, env: Env, ctx: ExecutionContext) => app.fetch(req, env, ctx),
  async scheduled(_event: ScheduledController, env: Env, _ctx: ExecutionContext) {
    // Keep the cache warm so the first visitor after a goal gets fresh data fast,
    // and capture closing-line odds for any newly-finished match.
    try {
      await getKnockoutMatches(env, true);
      await getOddsMap(env);
      await getPlayerPool(env);
      await getFantasyStatsMap(env);
    } catch (e) {
      console.error("cron refresh failed", e);
    }
    // Backstop: autopick any active draft with a clock whose turn has expired, so an
    // unattended draft doesn't stall waiting on someone who's away.
    try {
      const due = await env.DB.prepare(
        "SELECT * FROM leagues WHERE draft_status = 'active' AND pick_clock_seconds > 0"
      ).all<LeagueRow>();
      for (const league of due.results ?? []) await runAutopick(env, league);
    } catch (e) {
      console.error("cron autopick failed", e);
    }
    // Append any new match-driven feed events (goals, eliminations).
    try {
      await deriveMatchActivity(env);
    } catch (e) {
      console.error("cron activity failed", e);
    }
  },
};
