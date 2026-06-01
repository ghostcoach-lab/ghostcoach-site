# GhostCoach — Site Inventory

_Generated: 25 May 2026 · Reflects deploy v31 (includes the chat rewrite + /session-complete/ page)_

## Published site (the `ghostcoach_deploy_v44/` folder)
- HTML pages: 92
- Pages set to noindex (funnel/app/legal): 8
- Sitemap URLs: 40
- Redirects (_redirects): 7
- Base JS files: auth.js, config.js, supabase-client.js, webhooks.js
- Page JS files: account.js, activating.js, card.js, chat.js, contact.js, login.js, newsletter.js, onboarding.js, processing.js, session-complete.js, signup.js

### App / funnel pages
- /account/
- /activating/
- /card/
- /chat/
- /dashboard/
- /login/
- /onboarding/
- /processing/
- /session-complete/
- /signup/

## Internal files (in the zip's `_internal/` folder — NOT published)
- Edge Function: supabase/functions/marcus-chat/index.ts  (holds our Anthropic key + MARCUS_PROMPT)
- SQL migrations: v18_onboarding_schema.sql, v22_contact_rate_limit_table.sql, v25_marcus_ready_field.sql, v26_users_status_field.sql, v27_user_memory_field.sql, v30_sessions_processing_status.sql
- Backend specs: S7-contact-form-spec.md
- CONSOLIDATION_LOG.md  (full change history, v2–v31)

## Backend status (not built yet)
- Supabase Edge Function: written, NOT deployed
- n8n scenarios: 0 of 8 built (S3 session-end is the next priority)
- SQL migrations to run: v18, v22, v25, v26, v27, v30
- Email: Resend (DNS verification in progress)

## Latest funnel
signup -> confirm -> onboarding -> processing -> dashboard -> activating ->
chat -> session-complete -> account
