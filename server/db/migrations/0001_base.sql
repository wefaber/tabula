-- Base: people, how they get in, and what they did.
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  login TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'member')),
  active INTEGER NOT NULL DEFAULT 1
);

-- Access tokens: only the sha256 is stored. The plain token is shown once, when it is created.
CREATE TABLE tokens (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users (id),
  label TEXT NOT NULL,
  hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT
);

-- Browser sessions opened with a token. Only the sha256 of the cookie value is stored.
CREATE TABLE sessions (
  hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users (id),
  token_id INTEGER REFERENCES tokens (id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

-- Every action that changes something (power, DB writes, tokens, Ether approvals).
CREATE TABLE audit (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL,
  user_login TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT '{}',
  ok INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX audit_at ON audit (at DESC);
