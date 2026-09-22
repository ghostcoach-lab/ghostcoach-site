CREATE TABLE public.sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  transcript text DEFAULT '',
  processing_status text NOT NULL DEFAULT 'pending',
  is_pricing_audit boolean DEFAULT false,
  audit_intake jsonb,
  summary text,
  goal_progress_score integer DEFAULT 0,
  action_committed text,
  retry_count integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);
