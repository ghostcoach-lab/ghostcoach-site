-- ════════════════════════════════════════════════════════════════════════
-- GhostCoach v18 — schema migration for /onboarding/ wizard
-- ════════════════════════════════════════════════════════════════════════
-- Run this in your Supabase SQL Editor BEFORE the /onboarding/ page goes live.
-- 
-- Two new columns added to the `profiles` table to capture the two new
-- onboarding questions that don't exist in the original schema:
--
--   replaces            — "What does your product replace for the person
--                          buying it?" (positioning / value-prop context)
--
--   additional_context  — "Is there anything else Marcus should know about
--                          your situation before your first session?"
--                          (optional free-form context)
-- ════════════════════════════════════════════════════════════════════════

ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS replaces TEXT;

ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS additional_context TEXT;

-- Verify the new columns exist:
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'profiles'
  AND column_name IN ('replaces', 'additional_context');
