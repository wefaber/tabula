-- Shared answers: a read-only link to one finished answer. The run itself (stream, approvals) is never shared.
CREATE TABLE ether_shares (
  token TEXT PRIMARY KEY,
  message_id INTEGER NOT NULL REFERENCES ether_messages (id) ON DELETE CASCADE,
  created_by INTEGER NOT NULL REFERENCES users (id),
  created_at TEXT NOT NULL,
  revoked_at TEXT
);
