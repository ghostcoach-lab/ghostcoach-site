-- ════════════════════════════════════════════════════════════════════════
-- GhostCoach v22 — contact form rate-limit table
-- ════════════════════════════════════════════════════════════════════════
-- Run this in Supabase before n8n S7 (contact form) is built.
--
-- Purpose: Server-side rate-limit enforcement for /contact/ submissions.
-- The webarchitect's spec calls for:
--   - Max 3 submissions per IP per hour
--   - Max 1 submission per email per hour
--   - Max 50 submissions per IP per 24 hours
--
-- n8n S7 INSERTs a counter row on each accepted submission, then queries
-- this table to decide if the next one passes. A 24h cleanup cron deletes
-- rows older than the longest window.
-- ════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS contact_rate_limit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ip TEXT NOT NULL,
  email TEXT,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for fast counter queries
CREATE INDEX IF NOT EXISTS contact_rate_limit_ip_time_idx
  ON contact_rate_limit (ip, submitted_at DESC);

CREATE INDEX IF NOT EXISTS contact_rate_limit_email_time_idx
  ON contact_rate_limit (email, submitted_at DESC)
  WHERE email IS NOT NULL;

-- RLS: service role only (n8n writes via service key; never accessed from browser)
ALTER TABLE contact_rate_limit ENABLE ROW LEVEL SECURITY;

-- (No policies defined — service-role key bypasses RLS, so only n8n can
--  read/write this table. The anon key has no access.)

-- ════════════════════════════════════════════════════════════════════════
-- Optional: 24h cleanup function. Schedule via pg_cron or n8n cron.
-- ════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION cleanup_contact_rate_limit()
RETURNS void AS $$
BEGIN
  DELETE FROM contact_rate_limit
  WHERE submitted_at < now() - INTERVAL '24 hours';
END;
$$ LANGUAGE plpgsql;

-- Verify table created:
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'contact_rate_limit'
ORDER BY ordinal_position;
