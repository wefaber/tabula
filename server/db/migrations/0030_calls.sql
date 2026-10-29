-- Calls: the last API requests seen in the front's nginx access log (query strings already masked).
CREATE TABLE calls_log (
  id INTEGER PRIMARY KEY,
  at_ms INTEGER NOT NULL,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  status INTEGER NOT NULL,
  bytes INTEGER NOT NULL
);

CREATE INDEX calls_log_at ON calls_log (at_ms DESC);
