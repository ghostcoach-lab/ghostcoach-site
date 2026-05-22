-- ════════════════════════════════════════════════════════════════════════
-- GhostCoach v27 — `user_memory` column for curated session memory
-- ════════════════════════════════════════════════════════════════════════
-- Run this in Supabase SQL Editor.
--
-- This implements the "curated memory" pattern so Marcus remembers users
-- across sessions WITHOUT dumping raw transcripts into context (which blows
-- up token costs).
--
-- A concise rolling summary (~500-1000 tokens) of who the user is, what
-- they're working on, what's worked, and what they're avoiding.
--
-- n8n S3 (session-end) responsibilities:
--   1. Generate the 3-bullet session summary (existing)
--   2. ALSO update user_memory — distil the latest session into the rolling
--      memory, keeping it bounded:
--        UPDATE profiles SET user_memory = $new_memory WHERE user_id = $1;
--
-- At the start of each new session, Marcus's system context =
--   MARCUS_PROMPT + business profile + user_memory + last 1-2 session summaries
-- ════════════════════════════════════════════════════════════════════════

ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS user_memory TEXT;

-- Verify column added:
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'profiles' AND column_name = 'user_memory';
