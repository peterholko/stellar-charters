-- Multiplayer needs orders keyed per seat (game_id, turn, corp_id). The old single-player
-- game_orders (keyed by game_id, turn) is obsolete now that all prior games are retired.

DROP TABLE IF EXISTS game_orders;

CREATE TABLE game_orders (
  game_id     TEXT NOT NULL,
  turn        INTEGER NOT NULL,
  corp_id     TEXT NOT NULL,
  orders_json TEXT NOT NULL,
  PRIMARY KEY (game_id, turn, corp_id)
);
