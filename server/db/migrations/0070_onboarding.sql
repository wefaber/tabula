-- First-use tour: one row per user once they finish or close it. No row means it has not been seen yet.
CREATE TABLE user_onboarding (
  user_id INTEGER PRIMARY KEY REFERENCES users (id),
  completed_at TEXT NOT NULL
);
