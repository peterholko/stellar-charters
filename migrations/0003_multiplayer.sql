-- Multiplayer: one shared game with a lobby and per-seat human membership.

ALTER TABLE games ADD COLUMN host_user_id TEXT;

-- Human seat membership (which corporation each player controls in a game).
CREATE TABLE IF NOT EXISTS game_players (
  game_id      TEXT NOT NULL,
  corp_id      TEXT NOT NULL,   -- 'corp-0', 'corp-1', ...
  user_id      TEXT NOT NULL,
  display_name TEXT NOT NULL,
  joined_ts    INTEGER NOT NULL,
  PRIMARY KEY (game_id, corp_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_gp_user ON game_players(game_id, user_id);

-- Retire the old per-user games so the shared model starts from a clean slate.
UPDATE games SET status = 'ended' WHERE status = 'active';
