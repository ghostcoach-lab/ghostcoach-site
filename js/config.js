// GhostCoach — Central configuration
// Include this file FIRST on every page, before any other GC script.

const GC = {
  SUPABASE_URL:    'https://irmkcmcgfstdieujrrlg.supabase.co',
  SUPABASE_ANON:   'sb_publishable_52IwMKzLA69enbkwK6mCRg_eKpb--5n',

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

  // Feature flag — quarterly pricing audit.
  // Keep false until /account/audit/ and its final session/verdict payload
  // contract pass integration testing and receive frontend release approval.
  PRICING_AUDIT_ENABLED: true,

  // Stripe publishable key — safe for frontend
  STRIPE_KEY: 'pk_live_51TVXLDB9jjODOg4lRu9v53PWpwuziCFILIeMk0fjVmWKtIh5GdS6Iosrp2f75JtlJ71uJlmYLaXkPBpQluNe3dai00ibEptsp7',

  // Stripe price IDs (LIVE mode)
  STRIPE_PRICE_BUILDER:  'price_1URY0KB9jjODOg4lYde3nM8M',   // live Builder $79/mo
  STRIPE_PRICE_OPERATOR: 'price_1URY0KB9jjODOg4lxCy2x3GL',   // live Operator

  // Webhook paths
  WEBHOOK: {
    ONBOARDING:   '/gc-s2-onboarding',
    SESSION_END:  '/gc-s3-session-end',
    CONTACT:      '/gc-s7-contact',
    NEWSLETTER:   '/gc-s8-signup'
  }
};
