-- Hattrick — World Cup Draft & Bracket
-- D1 (SQLite) schema. Apply with:
--   npm run db:local     (local dev)
--   npm run db:remote    (deployed)

CREATE TABLE IF NOT EXISTS leagues (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  code            TEXT NOT NULL UNIQUE,
  draft_status    TEXT NOT NULL DEFAULT 'pending',   -- pending | active | done
  draft_started_at INTEGER,
  bracket_locked  INTEGER NOT NULL DEFAULT 0,         -- 0/1: once locked, no more bracket edits
  scoring         TEXT,                               -- JSON: optional scoring overrides
  formation       TEXT NOT NULL DEFAULT '4-4-2',      -- squad shape DEF-MID-FWD (1 GK implicit)
  pick_clock_seconds INTEGER NOT NULL DEFAULT 0,       -- per-pick draft clock; 0 = off (autopick when it expires)
  created_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS members (
  id              TEXT PRIMARY KEY,                   -- public id, safe to expose to the whole league
  token           TEXT NOT NULL UNIQUE,               -- secret bearer token (only the member themselves holds it)
  league_id       TEXT NOT NULL,
  name            TEXT NOT NULL,
  is_commissioner INTEGER NOT NULL DEFAULT 0,
  in_draft        INTEGER NOT NULL DEFAULT 0,          -- opted in to the snake draft? (bracket/predictions are open to all)
  auto_draft      INTEGER NOT NULL DEFAULT 0,          -- 1 = on autopick (missed a pick); stays on until they take control back
  draft_position  INTEGER,                            -- 1-based seat in the snake order (set at draft start)
  created_at      INTEGER NOT NULL,
  FOREIGN KEY (league_id) REFERENCES leagues(id)
);
CREATE INDEX IF NOT EXISTS idx_members_league ON members(league_id);

CREATE TABLE IF NOT EXISTS draft_picks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  league_id   TEXT NOT NULL,
  member_id   TEXT NOT NULL,
  team_id     TEXT NOT NULL,                          -- ESPN player id (column name kept for compat)
  team_name   TEXT NOT NULL,                          -- player name
  position    TEXT,                                   -- GK | DEF | MID | FWD
  country     TEXT,                                   -- national team name
  country_id  TEXT,                                   -- national team id (for the flag)
  baseline_pts INTEGER NOT NULL DEFAULT 0,            -- player's accumulated pts when added to this squad
  dropped     INTEGER NOT NULL DEFAULT 0,             -- 1 if transferred out
  drop_pts    INTEGER,                                -- player's accumulated pts at the moment dropped
  pick_number INTEGER NOT NULL,                       -- 1-based overall pick order
  created_at  INTEGER NOT NULL,
  -- No UNIQUE(team_id): a dropped player becomes a free agent again. Active-uniqueness
  -- (a player on at most one squad at a time) is enforced in the Worker.
  FOREIGN KEY (league_id) REFERENCES leagues(id)
);
CREATE INDEX IF NOT EXISTS idx_draft_league ON draft_picks(league_id);
-- The lock: a player can be on at most one ACTIVE squad per league (dropped rows are
-- excluded, so a dropped player is a free agent again). DB-enforced, so concurrent
-- draft picks / transfer claims for the same player can't both win.
CREATE UNIQUE INDEX IF NOT EXISTS idx_active_owner ON draft_picks(league_id, team_id) WHERE dropped = 0;

-- Transfer log: one row per completed transfer (drop + add). draft_picks is the ownership
-- ledger (who holds whom, with baselines); this is the human-readable event history that
-- powers the transfer feed, the board's "traded away" markers, and per-player churn counts.
CREATE TABLE IF NOT EXISTS transfers (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  league_id      TEXT NOT NULL,
  member_id      TEXT NOT NULL,
  out_player_id  TEXT NOT NULL,                       -- player dropped
  out_player_name TEXT NOT NULL,
  in_player_id   TEXT NOT NULL,                       -- player added
  in_player_name TEXT NOT NULL,
  position       TEXT NOT NULL,                       -- like-for-like slot (GK|DEF|MID|FWD)
  out_pts        INTEGER,                             -- dropped player's banked pts at drop
  in_baseline    INTEGER,                             -- added player's accumulated pts at pickup
  created_at     INTEGER NOT NULL,
  FOREIGN KEY (league_id) REFERENCES leagues(id)
);
CREATE INDEX IF NOT EXISTS idx_transfers_league ON transfers(league_id, created_at);

CREATE TABLE IF NOT EXISTS bracket_picks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  league_id  TEXT NOT NULL,
  member_id  TEXT NOT NULL,
  slot_key   TEXT NOT NULL,                           -- e.g. R16-1, QF-2, SF-1, F-1, CHAMP
  team_id    TEXT NOT NULL,
  team_name  TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (league_id, member_id, slot_key),
  FOREIGN KEY (league_id) REFERENCES leagues(id)
);
CREATE INDEX IF NOT EXISTS idx_bracket_member ON bracket_picks(member_id);

-- Matchday Predictions: one row per (member, match, prop). Generic so the prop
-- set can grow without schema changes.
-- League activity feed. Game actions write rows inline; match-driven events (goals,
-- eliminations) are re-derived by the cron and inserted idempotently via dedupe_key.
CREATE TABLE IF NOT EXISTS activity (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  league_id  TEXT NOT NULL,
  kind       TEXT NOT NULL,                         -- draft | transfer | perf | elim | …
  emoji      TEXT NOT NULL DEFAULT '',
  text       TEXT NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE,                  -- deterministic, so re-derivation is a no-op
  created_at INTEGER NOT NULL,
  FOREIGN KEY (league_id) REFERENCES leagues(id)
);
CREATE INDEX IF NOT EXISTS idx_activity_league ON activity(league_id, id);

-- One of each emoji per member per item (toggleable).
CREATE TABLE IF NOT EXISTS activity_reactions (
  activity_id INTEGER NOT NULL,
  member_id   TEXT NOT NULL,
  emoji       TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  UNIQUE (activity_id, member_id, emoji)
);

-- One captain per manager per knockout round (their points that round count double).
CREATE TABLE IF NOT EXISTS captains (
  league_id  TEXT NOT NULL,
  member_id  TEXT NOT NULL,
  round      TEXT NOT NULL,                          -- R32 | R16 | QF | SF | F
  player_id  TEXT NOT NULL,                          -- the captained player (a current squad pick)
  updated_at INTEGER NOT NULL,
  UNIQUE (league_id, member_id, round),
  FOREIGN KEY (league_id) REFERENCES leagues(id)
);
CREATE INDEX IF NOT EXISTS idx_captains_member ON captains(member_id);

-- One-time power-up chips. Each chip can be played once for the whole tournament,
-- scheduled on a knockout round; it commits when that round kicks off (can't be moved
-- onto an already-started round, so it can't be played retroactively). It multiplies
-- that round's points — TRIPLE_CAPTAIN: captain ×3 (vs the normal ×2); ALL_IN: whole squad ×2.
CREATE TABLE IF NOT EXISTS chips (
  league_id  TEXT NOT NULL,
  member_id  TEXT NOT NULL,
  chip       TEXT NOT NULL,                          -- TRIPLE_CAPTAIN | ALL_IN
  round      TEXT NOT NULL,                          -- R32 | R16 | QF | SF | F
  updated_at INTEGER NOT NULL,
  UNIQUE (league_id, member_id, chip),               -- each chip usable once
  FOREIGN KEY (league_id) REFERENCES leagues(id)
);
CREATE INDEX IF NOT EXISTS idx_chips_member ON chips(member_id);

CREATE TABLE IF NOT EXISTS predictions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  league_id  TEXT NOT NULL,
  member_id  TEXT NOT NULL,
  event_id   TEXT NOT NULL,                       -- ESPN match id
  prop       TEXT NOT NULL,                       -- winner | score | goals_ou | btts | to_pens
  value      TEXT NOT NULL,                       -- the member's answer
  updated_at INTEGER NOT NULL,
  UNIQUE (league_id, member_id, event_id, prop),
  FOREIGN KEY (league_id) REFERENCES leagues(id)
);
CREATE INDEX IF NOT EXISTS idx_predictions_event ON predictions(league_id, event_id);

-- Simple key/value cache so the Worker (and the cron) can stash ESPN responses
-- and computed standings without needing a separate KV namespace.
CREATE TABLE IF NOT EXISTS cache (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
