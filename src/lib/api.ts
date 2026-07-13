import type {
  ActivityItem,
  Bracket,
  BracketStanding,
  DraftStanding,
  DraftState,
  H2HStanding,
  League,
  LiveMatchMine,
  Match,
  MatchDetail,
  MatchFantasyView,
  PlayerCard,
  PlayerStanding,
  PoolPlayer,
  PredictionSlateView,
  PredictionStanding,
  Session,
  TeamRef,
  TransferLogEntry,
} from "../../shared/types";

const SESSION_KEY = "hattrick.session";

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}
export function saveSession(s: Session) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(s));
}
export function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

async function req<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const session = loadSession();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(opts.headers as Record<string, string>),
  };
  if (session) headers.Authorization = `Bearer ${session.token}`;
  const res = await fetch(path, { ...opts, headers });
  const data = (await res.json().catch(() => null)) as any;
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data as T;
}

export interface BracketResponse {
  bracket: Bracket;
  picks: Record<string, { teamId: string; teamName: string }>;
  locked: boolean;
}

export interface RevealEntry {
  memberId: string;
  memberName: string;
  teamId: string;
  teamName: string;
}
export interface RevealResponse {
  slots: Record<string, RevealEntry[]>;
  locked: boolean;
}

export const api = {
  matches: () => req<Match[]>("/api/matches"),
  match: (id: string) => req<MatchDetail>(`/api/matches/${id}`),
  teams: () => req<TeamRef[]>("/api/teams"),
  players: () => req<PoolPlayer[]>("/api/players"),

  createLeague: (name: string, commissionerName: string) =>
    req<{ session: Session; league: League }>("/api/leagues", {
      method: "POST",
      body: JSON.stringify({ name, commissionerName }),
    }),
  joinLeague: (code: string, name: string) =>
    req<{ session: Session; league: League }>("/api/leagues/join", {
      method: "POST",
      body: JSON.stringify({ code, name }),
    }),
  league: () => req<League>("/api/league"),
  removeMember: (memberId: string) =>
    req<League>("/api/members/remove", {
      method: "POST",
      body: JSON.stringify({ memberId }),
    }),
  draftOptIn: (inDraft: boolean, memberId?: string) =>
    req<League>("/api/draft/optin", {
      method: "POST",
      body: JSON.stringify({ in: inDraft, ...(memberId ? { memberId } : {}) }),
    }),
  setFormation: (formation: string) =>
    req<League>("/api/league/formation", {
      method: "POST",
      body: JSON.stringify({ formation }),
    }),
  setClock: (seconds: number) =>
    req<League>("/api/league/clock", {
      method: "POST",
      body: JSON.stringify({ seconds }),
    }),
  autopick: () => req<DraftState>("/api/draft/autopick", { method: "POST" }),
  resumeDraft: () => req<DraftState>("/api/draft/resume", { method: "POST" }),
  setCaptain: (round: string, playerId: string) =>
    req<DraftState>("/api/draft/captain", {
      method: "POST",
      body: JSON.stringify({ round, playerId }),
    }),
  playChip: (chip: string, round: string | null) =>
    req<DraftState>("/api/draft/chip", {
      method: "POST",
      body: JSON.stringify({ chip, round }),
    }),
  rename: (name: string) =>
    req<{ session: Session }>("/api/me/name", { method: "POST", body: JSON.stringify({ name }) }),
  // Validate a token (from a magic login link) and return its full session.
  loginWithToken: async (token: string): Promise<Session> => {
    const res = await fetch("/api/me", { headers: { Authorization: `Bearer ${token}` } });
    const data: any = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error || "This login link is invalid or expired.");
    return data.session as Session;
  },

  draft: () => req<DraftState>("/api/draft"),
  liveMatchMine: (matchId: string) =>
    req<LiveMatchMine>(`/api/draft/match/${matchId}/mine`),
  matchFantasy: (matchId: string) =>
    req<MatchFantasyView>(`/api/match/${matchId}/fantasy`),
  transfers: () => req<TransferLogEntry[]>("/api/draft/transfers"),
  playerStandings: () => req<PlayerStanding[]>("/api/leaderboard/players"),
  player: (id: string) => req<PlayerCard>(`/api/player/${id}`),
  startDraft: () => req<DraftState>("/api/draft/start", { method: "POST" }),
  pick: (playerId: string) =>
    req<DraftState>("/api/draft/pick", { method: "POST", body: JSON.stringify({ playerId }) }),
  resetDraft: () => req<DraftState>("/api/draft/reset", { method: "POST" }),
  transfer: (dropPlayerId: string, addPlayerId: string) =>
    req<DraftState>("/api/draft/transfer", {
      method: "POST",
      body: JSON.stringify({ dropPlayerId, addPlayerId }),
    }),

  bracket: () => req<BracketResponse>("/api/bracket"),
  bracketPick: (slotKey: string, teamId: string, teamName: string) =>
    req<{ ok: boolean; picks: Record<string, { teamId: string; teamName: string }> }>(
      "/api/bracket/pick",
      {
        method: "POST",
        body: JSON.stringify({ slotKey, teamId, teamName }),
      }
    ),
  bracketReveal: () => req<RevealResponse>("/api/bracket/reveal"),
  lockBracket: (locked: boolean) =>
    req<{ ok: boolean; locked: boolean }>("/api/bracket/lock", {
      method: "POST",
      body: JSON.stringify({ locked }),
    }),

  draftStandings: () => req<DraftStanding[]>("/api/leaderboard/draft"),
  h2hStandings: () => req<H2HStanding[]>("/api/leaderboard/h2h"),
  activity: () => req<ActivityItem[]>("/api/activity"),
  react: (id: number, emoji: string) =>
    req<{ ok: boolean }>(`/api/activity/${id}/react`, {
      method: "POST",
      body: JSON.stringify({ emoji }),
    }),
  bracketStandings: () => req<BracketStanding[]>("/api/leaderboard/bracket"),

  predictionSlate: (eventId: string) => req<PredictionSlateView>(`/api/predictions/${eventId}`),
  savePrediction: (eventId: string, prop: string, value: string) =>
    req<{ ok: boolean }>(`/api/predictions/${eventId}`, {
      method: "POST",
      body: JSON.stringify({ prop, value }),
    }),
  predictionStandings: () => req<PredictionStanding[]>("/api/leaderboard/predictions"),
};
