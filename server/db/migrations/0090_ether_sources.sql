-- Ask Ether sources: what Ether looked at for each answer, as JSON (state photo, tool steps, referenced items).
-- Null for questions, for answers from before this migration and for runs that never started.
ALTER TABLE ether_messages ADD COLUMN sources TEXT;
