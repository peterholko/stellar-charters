-- Phase 1 (auth slice): player accounts + sessions.
-- Supports both local (username/password) and Discord OAuth accounts.
-- Passwords are PBKDF2-SHA256 (iterations:salt:hash); pw_hash is null for OAuth-only users.

CREATE TABLE IF NOT EXISTS users (
  id           TEXT PRIMARY KEY,        -- random id
  username     TEXT NOT NULL UNIQUE,    -- lower-cased handle, unique across all accounts
  display_name TEXT NOT NULL,           -- original casing for display
  pw_hash      TEXT,                    -- "iterations:saltB64:hashB64"; null for OAuth-only
  discord_id   TEXT UNIQUE,             -- Discord user id; null for local accounts
  avatar       TEXT,                    -- avatar URL (Discord) or null
  created_ts   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,          -- sha-256 of the opaque cookie token
  user_id    TEXT NOT NULL,
  created_ts INTEGER NOT NULL,
  expires_ts INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_ts);
