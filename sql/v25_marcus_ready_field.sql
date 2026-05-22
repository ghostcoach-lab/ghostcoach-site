-- ════════════════════════════════════════════════════════════════════════
-- GhostCoach v25 — `marcus_ready_at` field for /processing/ page
-- ════════════════════════════════════════════════════════════════════════
-- Run this in your Supabase SQL Editor before /processing/ goes live.
--
-- The /processing/ page sits between /onboarding/ and /chat/. While the
-- user waits, the page subscribes to Supabase real-time updates on the
-- user's profile row. When n8n S2 finishes processing and sets
-- `marcus_ready_at`, the page redirects to /chat/.
--
-- n8n S2 must do at the end of the onboarding flow:
--   UPDATE profiles SET marcus_ready_at = now() WHERE user_id = $1;
-- ════════════════════════════════════════════════════════════════════════

ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS marcus_ready_at TIMESTAMPTZ;

-- Optional but recommended: partial index for fast "ready user" queries
-- if you ever need to find ready users across the table (e.g. analytics).
CREATE INDEX IF NOT EXISTS profiles_marcus_ready_idx
  ON profiles (user_id)
  WHERE marcus_ready_at IS NOT NULL;

-- Verify column added:
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'profiles'
  AND column_name = 'marcus_ready_at';
