-- ════════════════════════════════════════════════════════════════════════
-- GhostCoach v30 — sessions.processing_status
-- ════════════════════════════════════════════════════════════════════════
-- Run in Supabase SQL Editor.
--
-- chat.js creates a session row at the start of each chat:
--   INSERT INTO sessions (user_id, processing_status) VALUES (..., 'pending');
-- and n8n S3 (session-end) flips it to 'done' once the recap + memory are
-- written. This column tracks that lifecycle.
-- ════════════════════════════════════════════════════════════════════════

ALTER TABLE sessions
ADD COLUMN IF NOT EXISTS processing_status TEXT DEFAULT 'pending';

-- Verify:
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'sessions' AND column_name = 'processing_status';
