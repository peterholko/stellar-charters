-- Charter types (review Section 5 — asymmetric identity at setup): a seat's one-time pick,
-- and the turn its effects begin (event-sourced replay applies it from that turn, not turn 0).
ALTER TABLE game_players ADD COLUMN charter TEXT;
ALTER TABLE game_players ADD COLUMN charter_turn INTEGER;
