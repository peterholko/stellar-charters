-- Instant planning-window actions (ruleset v9): hub-market buys executed at click time.
-- Each row is one call, replayed in (turn, seq) order BETWEEN the prior turn's resolution and
-- the resolution of `turn` — so the event-sourced game re-derives them deterministically.
CREATE TABLE IF NOT EXISTS game_instants (
  game_id TEXT NOT NULL,
  turn INTEGER NOT NULL,    -- the upcoming turn this action precedes (its planning window)
  seq INTEGER NOT NULL,     -- submission order within the window
  corp_id TEXT NOT NULL,
  action_json TEXT NOT NULL,
  PRIMARY KEY (game_id, turn, seq)
);
