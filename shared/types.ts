// Shared types between the Cloudflare Worker (API) and the React frontend.

export type MatchState = "pre" | "in" | "post";

export type RoundCode = "R32" | "R16" | "QF" | "SF" | "F" | "3RD";

export interface TeamRef {
  id: string;
  name: string;
  abbr: string;
  logo?: string;
}

export interface Match {
  id: string; // ESPN event id
  date: string; // ISO timestamp
  state: MatchState;
  statusDetail: string; // "FT", "HT", "63'", or scheduled time
  clock?: string;
  period?: number;
  round: RoundCode;
  roundLabel: string; // human label, e.g. "Round of 32"
  matchNumber: number; // 1-based within the round
  home: TeamRef | null;
  away: TeamRef | null;
  homePlaceholder?: string; // e.g. "Round of 32 3 Winner" when team undecided
  awayPlaceholder?: string;
  homeScore: number | null;
  awayScore: number | null;
  winnerId: string | null; // team id of the winner once completed
  venue?: string;
}

export interface CommentaryItem {
  sequence: number;
  clock: string;
  text: string;
  isGoal: boolean;
}

export interface KeyEvent {
  clock: string;
  type: string;
  text: string;
  isGoal: boolean;
  teamId?: string;
  scorer?: string;
}

// ---- Fantasy (player draft) ----

export type Position = "GK" | "DEF" | "MID" | "FWD";

export interface PoolPlayer {
  id: string;
  name: string;
  position: Position;
  posAbbr: string;
  team: TeamRef;
  // Draft-board projection (server-computed on GET /api/players; absent on the raw
  // pool used for pick/transfer id lookups).
  proj?: number; // projected fantasy value: banked points + expected remaining
  projMatches?: number; // expected remaining knockout matches the team will play (0–5)
  tier?: 1 | 2 | 3; // 3 = elite, by projection quantile across the pool
}

// Aggregated tournament stats per player (summed across completed knockout matches).
export interface PlayerAgg {
  apps: number;
  goals: number;
  assists: number;
  yellow: number;
  red: number;
  og: number;
  saves: number;
  conceded: number;
  cleanSheets: number;
}

// ---- Lineups ----

export interface PlayerStat {
  label: string;
  value: string;
}

export interface LineupPlayer {
  id: string;
  name: string;
  jersey?: string;
  position?: string;
  starter: boolean;
  subbedIn?: boolean;
  subbedOut?: boolean;
  stats: PlayerStat[];
}

export interface TeamLineup {
  teamId?: string;
  teamName: string;
  homeAway: "home" | "away";
  formation?: string;
  players: LineupPlayer[];
}

export interface MatchDetail extends Match {
  commentary: CommentaryItem[];
  keyEvents: KeyEvent[];
  lineups: TeamLineup[];
}

// ---- Bracket ----

export interface BracketSlot {
  key: string; // e.g. "R32-1", "R16-3", "QF-2", "SF-1", "F-1", "3RD-1"
  round: RoundCode;
  roundLabel: string;
  matchNumber: number;
  eventId: string;
  childAKey: string | null; // lower slot feeding side A (null for R32 leaves)
  childBKey: string | null;
  teamA: TeamRef | null; // actual team if decided (R32 always; higher rounds once results land)
  teamB: TeamRef | null;
  actualWinnerId: string | null; // real result winner, once the match is completed
  state: MatchState;
  date: string; // ISO kickoff
  statusDetail: string; // "FT", "63'", or scheduled time text
  loserMatch?: boolean; // true for the 3rd-place playoff: fed by the LOSERS of its children
}

export interface Bracket {
  slots: BracketSlot[]; // ordered R32 → F, plus the 3rd-place match
  champKey: string; // the slot whose winner is the champion (always "F-1")
  thirdPlaceKey: string | null; // the 3rd-place playoff slot (always "3RD-1" when present)
}

// ---- League / game ----

export type DraftStatus = "pending" | "active" | "done";

export interface PublicMember {
  id: string;
  name: string;
  isCommissioner: boolean;
  inDraft: boolean; // opted in to the snake draft (bracket/predictions are open to all)
  draftPosition: number | null;
}

export interface League {
  id: string;
  name: string;
  code: string;
  draftStatus: DraftStatus;
  bracketLocked: boolean;
  formation: string; // squad shape, e.g. "4-4-2" (1 GK implicit); shared by the whole league
  pickClockSeconds: number; // per-pick draft clock; 0 = off
  members: PublicMember[];
}

// What the client stores after create/join (includes the secret token).
export interface Session {
  token: string;
  memberId: string;
  leagueId: string;
  name: string;
  isCommissioner: boolean;
}

// ---- Draft ----

export interface SquadReq {
  GK: number;
  DEF: number;
  MID: number;
  FWD: number;
}

// Preset squad shapes (1 GK implicit; outfield always sums to 10). A per-league
// setting — everyone in a league drafts the same formation, so it stays fair.
export const FORMATIONS = ["3-4-3", "3-5-2", "4-3-3", "4-4-2", "4-5-1", "5-3-2", "5-4-1"] as const;
export type Formation = (typeof FORMATIONS)[number];
export const DEFAULT_FORMATION: Formation = "4-4-2";

export function squadFromFormation(f: string | null | undefined): SquadReq {
  const valid = (FORMATIONS as readonly string[]).includes(f ?? "")
    ? (f as string)
    : DEFAULT_FORMATION;
  const [def, mid, fwd] = valid.split("-").map(Number);
  return { GK: 1, DEF: def, MID: mid, FWD: fwd };
}

export interface DraftPick {
  pickNumber: number;
  memberId: string;
  memberName: string;
  playerId: string;
  playerName: string;
  position: Position;
  country: string; // national team name
  teamId: string; // national team id (for the flag)
}

// An original draft slot for the board view — kept visible even after the player is
// transferred out, so the board never goes blank. `dropped` + `replacedByName` tell the
// transfer story in-place; `transferCount` = times this player has changed hands.
export interface BoardPick extends DraftPick {
  dropped: boolean;
  replacedByName: string | null;
  transferCount: number;
  eliminated: boolean; // their national team is knocked out — RIP
}

export interface DraftState {
  status: DraftStatus;
  order: PublicMember[]; // seats in draft_position order
  picks: DraftPick[]; // active squad (dropped players removed)
  boardPicks: BoardPick[]; // the original draft grid (incl. transferred-out slots, flagged)
  onTheClockMemberId: string | null; // whose turn, null if not active/done
  currentPickNumber: number;
  totalPicks: number; // squadSize * players
  squad: SquadReq; // required composition per manager
  completedRounds: number; // knockout rounds fully finished
  transfersPerRound: number;
  myTransfersUsed: number; // transfers the requesting member has spent
  lockedTeams: string[]; // team ids whose match this round has kicked off — frozen for transfers
  clockSeconds: number; // per-pick clock; 0 = off
  deadline: number | null; // epoch ms the current pick auto-picks at (null if clock off / not active)
  autoMemberIds: string[]; // members currently on sticky autopick (missed a pick, haven't resumed)
  captainRounds: CaptainRound[]; // per knockout round: lock state + the member's captain (empty until draft done)
  chips: ChipState[]; // the requesting member's one-time power-up chips (empty until draft done)
}

// Your players' live fantasy points in a single (in-progress or finished) match — powers
// the "points climbing" view on the matchday panel.
export interface LiveMatchMine {
  state: MatchState;
  total: number;
  players: {
    playerId: string;
    playerName: string;
    position: Position;
    teamId: string;
    country: string;
    points: number;
    goals: number;
    assists: number;
    breakdown: { label: string; pts: number }[]; // itemized "what they did → points" (for the hover)
  }[];
}

// Every player who took the pitch in one match, with the fantasy points they earned —
// powers the "Fantasy points" scoreboard on the match page (top scorers, who got what,
// owner tags). Sorted high→low by points.
export interface MatchFantasyPlayer {
  playerId: string;
  playerName: string;
  position: Position;
  teamId: string; // national team id (for the flag)
  teamName: string;
  points: number;
  goals: number;
  assists: number;
  breakdown: { label: string; pts: number }[]; // itemized "what they did → points"
  ownerName: string | null; // who drafted them in the viewer's league (null = undrafted)
  mine: boolean; // the viewer drafted them
}

export interface MatchFantasyView {
  state: MatchState;
  homeId: string | null;
  awayId: string | null;
  players: MatchFantasyPlayer[];
}

// One match in a player's fantasy history — powers the tap-through player sheet. Shows
// what they did, who owned them then, any boost, and what that owner actually banked.
export interface PlayerMatchLine {
  round: RoundCode;
  matchId: string;
  opponent: TeamRef | null;
  teamScore: number | null;
  oppScore: number | null;
  won: boolean | null;
  breakdown: { label: string; pts: number }[];
  raw: number; // the player's fantasy points that match
  ownerName: string | null; // who owned them at kickoff (null = free agent then)
  boost: number; // multiplier applied for that owner (1 / 2 / 3)
  attributed: number; // raw × boost credited to that owner
}

export interface PlayerCard {
  playerId: string;
  playerName: string;
  position: Position;
  team: TeamRef;
  total: number; // full knockout production (all matches, ownership aside)
  ownerName: string | null; // current owner
  mine: boolean;
  banked: number; // what the current owner has actually banked (since they acquired him)
  matches: PlayerMatchLine[];
}

// A row in the global player leaderboard: total production + what the owner banked.
export interface PlayerStanding {
  playerId: string;
  playerName: string;
  position: Position;
  team: TeamRef;
  total: number;
  ownerName: string | null; // current owner (null = undrafted)
  mine: boolean;
  banked: number; // points the current owner has banked from them
}

// One completed transfer (drop + add) — the league's transfer history feed.
export interface TransferLogEntry {
  id: number;
  memberId: string;
  memberName: string;
  outPlayerId: string;
  outPlayerName: string;
  inPlayerId: string;
  inPlayerName: string;
  position: Position;
  outPts: number | null; // dropped player's banked points at drop
  inBaseline: number | null; // added player's accumulated points at pickup
  createdAt: number;
}

// One row per knockout round for the captain picker.
export interface CaptainRound {
  round: RoundCode;
  label: string;
  locked: boolean; // the round has kicked off — captain is fixed
  captainPlayerId: string | null; // the requesting member's captain for this round
}

// One-time power-up chips. Each is played once for the whole tournament, on a round of
// your choosing, and locks in when that round kicks off. It multiplies that round's
// points — it does NOT change the scoring rules, so it stays easy to grasp.
export type ChipId = "TRIPLE_CAPTAIN" | "ALL_IN";
export const CHIPS: { id: ChipId; name: string; emoji: string; blurb: string }[] = [
  {
    id: "TRIPLE_CAPTAIN",
    name: "Triple Captain",
    emoji: "🔥",
    blurb: "Your captain scores ×3 (instead of ×2) for one round.",
  },
  // All-In was removed: doubling the whole squad rewards "play it the earliest round"
  // (your squad only shrinks as teams are knocked out), so it was a no-brainer, not a
  // decision. Triple Captain is the keeper. (ALL_IN stays in ChipId + the scoring branch
  // so any legacy row still resolves harmlessly; it's just no longer offered.)
];

// One row per chip for the requesting member (only populated once the draft is done).
export interface ChipState {
  chip: ChipId;
  round: RoundCode | null; // round it's scheduled/played on (null = not yet played)
  committed: boolean; // that round has kicked off — it's locked in, can't be moved
}

// Allowed per-pick clock durations (seconds; 0 = off). Commissioner-set per league.
export const PICK_CLOCKS = [0, 60, 600, 3600] as const;

// ---- Leaderboards ----

export interface FantasyPlayerLine {
  playerId: string;
  playerName: string;
  position: Position;
  country: string;
  teamId: string;
  points: number;
  goals: number;
  assists: number;
  apps: number;
  eliminated: boolean;
  dropped: boolean; // transferred out — points are banked, no longer on the squad
  captainBonus: number; // extra points this player earned from being captain (0 if never)
  chipBonus: number; // extra points from chips applied to this player (Triple Captain / All-In; 0 if none)
  breakdown: { label: string; pts: number }[]; // itemized "what they did → points"
}

export interface DraftStanding {
  memberId: string;
  memberName: string;
  points: number;
  players: FantasyPlayerLine[];
}

// Per-round head-to-head: every manager is compared against every other on the points
// they scored each completed knockout round; W/D/L tallied across all of them.
export interface H2HStanding {
  memberId: string;
  memberName: string;
  wins: number;
  draws: number;
  losses: number;
  points: number; // 3 × wins + draws
  roundsPlayed: number;
}

export interface BracketStanding {
  memberId: string;
  memberName: string;
  correct: number;
  points: number;
  maxPossible: number;
  championPick: string | null; // team name they picked to win it all
}

// Normalized market win-probabilities per match (home/away sum to 1), derived
// from the closing moneyline. Used to weight scoring by how big an upset was.
export type OddsMap = Record<string, { pHome: number; pAway: number }>;

// ---- Matchday Predictions ----

export type PropType = "side" | "ou" | "yesno" | "score";

export interface PropOption {
  value: string;
  label: string;
  points?: number; // potential payout for this side (upset-weighted winner only; shown at pick time)
}

export interface PredictionPropView {
  key: string;
  label: string;
  type: PropType;
  points: number;
  upset?: boolean;
  options?: PropOption[]; // for score type the client renders inputs instead
  myValue?: string;
  actual?: string; // graded result label, once the match is final
  correct?: boolean; // whether your pick was right
  reveal?: { memberName: string; value: string; correct?: boolean }[]; // visible once locked
}

export interface PredictionSlateView {
  eventId: string;
  open: boolean; // still pickable (match hasn't kicked off)
  locked: boolean;
  graded: boolean; // match final
  props: PredictionPropView[];
  myScore: number;
  perMember?: { memberName: string; points: number }[]; // mini leaderboard once locked
}

export interface PredictionStanding {
  memberId: string;
  memberName: string;
  points: number;
  correct: number;
  matches: number;
  // Per-match breakdown (why a manager with fewer matches can still be high — a single
  // upset-weighted winner pays a lot). Sorted high→low by points.
  breakdown: { eventId: string; label: string; points: number; correct: number; props: number }[];
}

// ---- Activity feed ----

export const REACTIONS = ["👍", "😂", "🔥", "💀", "⚽", "🐐"] as const;

export interface ActivityItem {
  id: number;
  kind: string;
  emoji: string;
  text: string;
  createdAt: number;
  reactions: Record<string, number>; // emoji -> count
  myReactions: string[]; // which emoji the requesting member used
}

export interface ApiError {
  error: string;
}
