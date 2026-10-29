-- Ask Ether: one thread per conversation, per user. `slug` is the `<thread>` of the Hermes session id
-- (gdp-<login>-<thread>), so Ether keeps the context of a thread across questions.
CREATE TABLE ether_threads (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users (id),
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, slug)
);

CREATE INDEX ether_threads_user ON ether_threads (user_id, updated_at DESC);

-- Text only: what the person asked and what Ether answered (never the system snapshot, never a key).
-- `status` is `pending` while the run is live; a reboot closes dangling ones as `failed`.
CREATE TABLE ether_messages (
  id INTEGER PRIMARY KEY,
  thread_id INTEGER NOT NULL REFERENCES ether_threads (id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'ether')),
  body TEXT NOT NULL,
  run_id TEXT,
  status TEXT NOT NULL DEFAULT 'done' CHECK (status IN ('pending', 'done', 'failed', 'cancelled')),
  created_at TEXT NOT NULL
);

CREATE INDEX ether_messages_thread ON ether_messages (thread_id, id);
