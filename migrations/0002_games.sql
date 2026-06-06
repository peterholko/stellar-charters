-- Phase 1: server-authoritative game persistence.
-- Event-sourced: a game is its seed + the log of the human's orders per turn. The
-- authoritative state is reconstructed by replaying the deterministic engine.

CREATE TABLE IF NOT EXISTS games (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  seed        INTEGER NOT NULL,
  scenario    TEXT NOT NULL,        -- scenario id (only 'inner-ring-8p' for now)
  players     INTEGER NOT NULL,
  human_corp  TEXT NOT NULL,        -- 'corp-0'
  turn        INTEGER NOT NULL,     -- turns resolved so far (0 = auction pending)
  phase       TEXT NOT NULL,        -- 'auction' | 'play' | 'over'
  status      TEXT NOT NULL,        -- 'active' | 'ended'
  created_ts  INTEGER NOT NULL,
  updated_ts  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS game_orders (
  game_id     TEXT NOT NULL,
  turn        INTEGER NOT NULL,     -- the turn these orders apply to (1 = auction bid)
  orders_json TEXT NOT NULL,        -- BidOrder (turn 1) or Order[] (turn > 1)
  PRIMARY KEY (game_id, turn)
);

CREATE INDEX IF NOT EXISTS idx_games_user ON games(user_id, status, updated_ts);
