-- APIs: one row per health check of an endpoint (or of the DB), kept 24 h.
CREATE TABLE apis_checks (
  id INTEGER PRIMARY KEY,
  endpoint TEXT NOT NULL,
  at_ms INTEGER NOT NULL,
  ok INTEGER NOT NULL,
  status INTEGER,
  latency_ms INTEGER NOT NULL,
  error TEXT
);

CREATE INDEX apis_checks_endpoint_at ON apis_checks (endpoint, at_ms DESC);
CREATE INDEX apis_checks_at ON apis_checks (at_ms);
