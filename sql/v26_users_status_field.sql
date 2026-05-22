-- ════════════════════════════════════════════════════════════════════════
-- GhostCoach v26 — `users.status` field for /activating/ page
-- ════════════════════════════════════════════════════════════════════════
-- Run this in Supabase SQL Editor before /activating/ goes live.
--
-- The /activating/ page polls users.status every 3 seconds. Default is
-- 'pending'. n8n S5 updates this field to 'trialing', 'active', etc.
-- when the Stripe subscription event arrives.
--
-- /activating/ redirects to /chat/ as soon as status is anything OTHER
-- than 'pending'.
--
-- n8n S5 must do at end of subscription-created handler:
--   UPDATE users SET status = 'trialing' WHERE id = $1;
-- ════════════════════════════════════════════════════════════════════════

ALTER TABLE users
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending';

UPDATE users SET status = 'pending' WHERE status IS NULL;

CREATE INDEX IF NOT EXISTS users_status_idx ON users (status)
  WHERE status != 'pending';

SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'users' AND column_name = 'status';
