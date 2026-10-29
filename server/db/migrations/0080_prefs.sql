-- Per-user panel preferences (language, theme, text scale, contrast). One row per user, written by `setPrefs`.
-- The browser keeps its own copy in localStorage so the first paint is right; the server copy wins on load.
CREATE TABLE user_prefs (
  user_id INTEGER PRIMARY KEY REFERENCES users (id),
  language TEXT NOT NULL DEFAULT 'es' CHECK (language IN ('es', 'en')),
  theme TEXT NOT NULL DEFAULT 'dark' CHECK (theme IN ('dark', 'light', 'system')),
  scale INTEGER NOT NULL DEFAULT 100 CHECK (scale IN (90, 100, 115, 130)),
  contrast TEXT NOT NULL DEFAULT 'normal' CHECK (contrast IN ('normal', 'high')),
  updated_at TEXT NOT NULL
);
