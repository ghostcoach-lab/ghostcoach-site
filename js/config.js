// GhostCoach — Central configuration
// Include this file FIRST on every page, before any other GC script.

const GC = {
  SUPABASE_URL:    'https://irmkcmcgfstdieujrrlg.supabase.co',
  SUPABASE_ANON:   'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlybWtjbWNnZnN0ZGlldWpycmxnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg0MDk4MTgsImV4cCI6MjA5Mzk4NTgxOH0.PYqgyRbsh9HYIJmMoG6iRqnz8dzg8Jl3rcjhCXi6_lg',

  // n8n webhook base — no trailing slash
  N8N_BASE: 'https://ghostcoach.app.n8n.cloud/webhook',

  // Shared secret for n8n webhooks (same value as GC_WEBHOOK_SECRET in n8n variables)
  // This is intentionally in the client: it only authorises automation triggers, never data reads.
  WEBHOOK_SECRET: 'ed6d4055f3d4b272f23bde925dfa67fe5cecee238c75627a8c4634f59685596b',

  // Feature flag — goal progress bar.
  // FALSE until the honest-scoring rubric is confirmed live + tested in the S3
  // session-end pipeline. The page promises "the score only moves when your
  // business does" — do not show the bar to users until that score is real.
  // To go live: verify scoring in S3, then set this to true. No re-deploy needed
  // for the markup; the bar is already on /chat/ and /account/ but stays hidden
  // while this is false.
  GOAL_BAR_ENABLED: false,

  // Stripe publishable key — safe for frontend
  STRIPE_KEY: 'pk_test_51TTgErCwJBxjKaPH3yZRNzRYJBUTLOpTFNwn2IyA6jTwjji8aCr9kqER9dmoHSfCCMvnozznJeFxx1YNyANbgEnf00C3rGkj8j',

  // Stripe price IDs (fill in after creating prices in Stripe dashboard)
  STRIPE_PRICE_BUILDER:  'price_1TXNfhCwJBxjKaPH83K906vP',   // e.g. price_xxx
  STRIPE_PRICE_OPERATOR: 'price_1Tnb9dCwJBxjKaPHEvMu7HKp',

  // Webhook paths
  WEBHOOK: {
    ONBOARDING:   '/gc-s2-onboarding',
    SESSION_END:  '/gc-s3-session-end',
    CONTACT:      '/gc-s7-contact',
    NEWSLETTER:   '/gc-s8-signup'
  }
};
