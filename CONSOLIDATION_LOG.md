# GhostCoach — Consolidation Log

Last updated: 2026-05-22

This file documents cross-cluster URL consolidation decisions.
For redirect implementation, see `/_redirects`.

---

## Active 301 redirects (5 pairs — shipped in v14)

| Source (orphan) | Destination (canonical) | Rationale |
|---|---|---|
| `/guides/vibe-coding-saas-pricing/` | `/vibe/saas-pricing/` | Pair 1 — identical titles |
| `/guides/how-to-get-customers-vibe-coded-app/` | `/vibe/get-customers/` | Pair 2 — near-identical titles, same intent |
| `/guides/how-to-monetize-vibe-coded-app/` | `/vibe/make-money/` | Pair 3 — same monetisation intent |
| `/guides/vibe-coding-micro-saas-business-model/` | `/vibe/make-money/` | Pair 5 — substance folded into canonical first |
| `/guides/ai-coach-vs-human-coach/` | `/ai-business-coach/vs-human-coach/` | Pair B — identical comparison topic |

## HELD pairs (need future action)

### Pair 4 — Post-launch growth (DEADLINE: 11 June 2026)
**State:** both pages live; orphan held pending differentiated rewrite

- `/vibe/after-vibe-coding-what-next/` ("What to Do After Vibe Coding — From App to Business") — **canonical**, in sitemap
- `/guides/how-to-grow-vibe-coded-saas/` ("How to Grow Your Vibe-Coded SaaS Beyond the Launch Plateau") — orphan, on disk

**Hypothesis:** these target genuinely different moments in the founder journey.
- /vibe/ = post-launch transition (just shipped, what now)
- /guides/ = plateau content (have customers, growth has stalled)

**Action by 11 June 2026:** rewrite /guides/ orphan with sharp distinction from /vibe/.
If rewritten by then, keep both. Update internal links to point at rewritten /guides/.
If NOT rewritten by then, 301 orphan → /vibe/after-vibe-coding-what-next/.

**Current state:** broken-URL retarget `how-to-grow-vibe-coded-saas.html` points to
`/vibe/after-vibe-coding-what-next/`. Will flip back to /guides/ version if rewrite ships.

## TIER 3 held pairs (raw material for future content)

These orphans share topical overlap with live /vibe/ canonicals but plausibly
distinct angles. Held as raw material for the briefing pages — the orphan content
may be folded into a future /guides/how-to-validate-saas-idea/ or similar new
page rather than being 301'd away.

Pricing cluster:
- `/vibe/saas-pricing/` ↔ `/guides/how-to-price-saas-product/` (both LIVE)
- `/vibe/saas-pricing/` ↔ `/guides/solopreneur-saas-pricing-strategy/` (orphan)
- `/vibe/saas-pricing/` ↔ `/guides/saas-pricing-strategy-first-product/` (orphan)

Customer acquisition cluster:
- `/vibe/get-customers/` ↔ `/guides/how-to-get-first-customers-saas/` (orphan)
- `/vibe/get-customers/` ↔ `/guides/first-10-paying-customers-saas/` (orphan)
- `/vibe/get-customers/` ↔ `/guides/saas-acquisition-system/` (both LIVE)

AI business coaching:
- `/ai-business-coach/for-solopreneurs/` ↔ `/guides/ai-business-coaching/` (orphan)
- `/ai-business-coach/for-entrepreneurs/` ↔ `/guides/ai-business-coach-for-founders/` (orphan, Pair A)

**Action:** decide each one's fate as the briefing pages get written, informed
by which orphans become raw material vs. which are kept separate.

## v15 prep notes

When drafting v15 (orphan-to-sitemap activation), the candidate set is:
44 orphans MINUS 5 301'd in v14 MINUS any held in TIER 3 as raw material.

Before v15 ships, spot-check 3 candidates against the factual gate:
- Alex (wrong — should be Marcus)
- $39, $49 (wrong — actual prices are $79/$149/$499)
- 100 lifetime (wrong — should be 50)
- "quarterly business review" (wrong — should be "pricing audit")
- "founding member" (must be present where Lifetime is mentioned)

If any spot-check trips, expand the grep across the full v15 candidate set.


## v16 deploy (2026-05-16)

Three briefing-priority pages from §6.3 / §7.3 of inventory shipped:
- `/guides/how-to-validate-saas-idea/` (priority #2 — founder's stated next page)
- `/guides/saas-customer-interviews/` (priority #6)
- `/guides/saas-business-automation/` (priority #5)

Sitemap: 31 → 34 URLs.

Mechanical fixes (same as v15 — specialist did not use canonical nav/footer):
- Nav: class-based → canonical inline-styled with "Back to home"
- Footer: minimal → unified 5-column
- Favicon: placeholder → canonical base64 SVG
- Body CSS: line-height 1.65 → 1.7, removed explicit 17px font-size

Cross-links from live pages added:
- /ai-business-coach/for-solopreneurs/ → /guides/how-to-validate-saas-idea/
- /ai-business-coach/features/          → /guides/saas-business-automation/
- /vibe/get-customers/                  → /guides/saas-customer-interviews/

TIER 3 raw material was NOT folded into the new pages (specialist wrote from scratch).
Held orphans remain as reserve. Worth flagging to specialist for next batch.


## v17 deploy (2026-05-16)

Sprint 4 + Sprint 5 combined deploy (6 pages).

Sprint 4 — /guides/ cluster expansion:
- `/guides/retention-vs-acquisition-saas/` (briefing priority #1)
- `/guides/scale-saas-without-hiring/` (briefing priority #3)
- `/guides/business-coach-cost-solopreneur/` (specialist new topic)

Sprint 5 — Cross-cluster expansion:
- `/ai-self-coaching/free-coaching/` (TOFU expansion, under-served cluster)
- `/vibe/saas/` (pillar page completing /vibe/ URL structure)
- `/ai-business-coach/limitations/` (trust/objection page)

Sitemap: 34 → 40 URLs.

Specialist progress notes:
- Finally followed §2 brand requirements (canonical nav, unified footer)
  on this batch — biggest improvement since handover.
- Sprint 4 positioning explicitly avoids Pair 4 hold overlap (resource
  allocation diagnostic + solo operational systems, NOT post-launch journey
  or growth strategy).
- Regression: dropped mobile breakpoint on all 6 (had it in v16). Mechanical
  fix applied during integration.

Briefing roadmap status: 5 of 6 priority pages now shipped.
Only `/guides/saas-customer-support-solo/` remains unbuilt.

Two scale-saas-without-hiring + vibe-saas had broken forward-links to that
unbuilt page on first upload. Specialist retargeted before deploy.

Cross-links from 6 live pages added (3 different related-box patterns
encountered: .related-links, .related-grid, .related-list, plus an inline-
styled custom pattern on /vibe/ hub).


## v18 deploy (2026-05-17)

NEW FUNCTIONAL PAGE: /onboarding/index.html

Two-step onboarding wizard that fires after credit card validation
(between /dashboard/ and /chat/). Replaces the original Tally form approach
with an in-product modal-style page.

Architecture:
- 2 steps, 9 questions total (matches Tally form parts):
  - Step 1: Your product (product, stage, business_model, tools)
  - Step 2: Your situation (replaces, bottleneck, tried, goal_90_day, additional_context)
- Supabase auth gate with Phase 1 sessionStorage fallback
- On submit: UPSERT to profiles table + POST to n8n S2 webhook (placeholder URL)
- Partial state persistence (resume on refresh)
- Redirects to /chat/?onboarded=true on success
- noindex meta, NOT in sitemap (functional page)

Factual gate violation fixed during build:
- Tally form Q5 in Part 2 said "anything else Alex should know" 
  → corrected to "Marcus" per spec (PDF "Changes in this version" line:
  "Marcus throughout (was Alex)")

Schema changes required:
- ALTER TABLE profiles ADD COLUMN replaces TEXT;
- ALTER TABLE profiles ADD COLUMN additional_context TEXT;
- See /sql/v18_onboarding_schema.sql in the deploy

Backend integration status (pending other roadmap items):
- Supabase config: placeholder constants — set when Supabase Auth ships
- n8n S2 webhook URL: 'DISABLED-pending-n8n-replacement' — set when n8n built

Stack alignment notes:
- PDF (Customer Flow v5) describes the OLD stack (Memberstack, Make.com,
  Airtable, 7-day trial). Built against current spec (Supabase, n8n,
  14-day trial).

Not modified in this deploy:
- /dashboard/ — should redirect to /onboarding/ after successful card
  validation when Stripe integration ships. Flagged as a follow-up.
- /chat/ — already has a 2-step onboarding overlay per current spec;
  may want to deprecate that in favor of the new /onboarding/ page once
  /dashboard/ wires up the redirect. Flagged as a follow-up.


## v19 deploy (2026-05-17)

Single hotfix: 301 redirect for malformed URL pattern.

User reported `https://getghostcoach.com/guides/ai-business-coach/pricing/` 
returning 404. URL combines `/guides/` and `/ai-business-coach/` cluster 
paths — likely typed manually or surfaced via GSC crawl report.

No internal HTML file contained this broken link (grep confirmed), so it 
came from an external source (typed URL, social share, indexed historical 
URL, or autocomplete confusion).

Fix: 301 redirect added to `_redirects`:
```
/guides/ai-business-coach/pricing/   /ai-business-coach/pricing/   301!
```

Active 301 rules: 5 → 6. New "Malformed-URL recovery" section added to 
_redirects for future similar fixes.

No other changes in this deploy.


## v20 deploy (2026-05-17)

Single change: /onboarding/index.html nav simplified.

The canonical nav was replaced with a minimal funnel-safe variant:
- Brand wordmark on the left (still links to home as a discreet escape)
- NO "Back to home" link on the right
- Standard SaaS onboarding pattern (Stripe Checkout, Linear, Notion)

Rationale: user just paid for a trial. Inviting them to leave mid-onboarding
is anti-pattern. Minimal nav reduces drop-off without trapping anyone — the
wordmark logo still navigates home for the rare user who needs it.

Other funnel pages (/signup/, /dashboard/, /chat/ onboarding overlay) still
use the standard "← Back to home" pattern. Flagged for future review — same
UX logic applies across the whole paid-funnel sequence.

No other changes in this deploy.


## v21 deploy (2026-05-18)

Six change sets bundled together.

### 1. /vibe/ button + footer fixes (8 pages)
Two CSS bugs visible on /vibe/ spoke pages:
- "Talk to Marcus free" button invisible (text color matched background)
  → Root cause: .article a { color: var(--amber) } had specificity (0,1,1),
    .cta-btn { color: var(--ink) } had only (0,1,0), so the link rule won
    and made the button text amber on amber background
  → Fix: added `a.cta-btn { color: var(--ink) !important; }` to override
- Footer brand text center-aligned (orphan CSS rule from old footer styling)
  → Fix: removed `text-align: center` from `footer { ... }` rule
- Applied to all 8 /vibe/ pages (5 affected + 3 preventive for consistency)

### 2. Broken /free-ai-business-coaching.html URL (2 pages)
- Two internal links used relative `href="free-ai-business-coaching.html"`
  which resolved to non-existent paths under /ai-business-coach/{slug}/
- Fixed by replacing with absolute `href="/ai-self-coaching/free-coaching/"`
  (the v17 page is the closest topical match)
- Files touched: /ai-business-coach/for-solopreneurs/ and /ai-business-coach/pricing/
- The v19 301 redirect for /guides/ai-business-coach/pricing/ remains
  in place (different URL, still valuable for GSC-discovered URLs)

### 3. Footer logo → home (85 pages)
- Ghost+Coach wordmark in the unified footer was not clickable
- Wrapped in `<a href="https://getghostcoach.com/" style="text-decoration:none;display:inline-block;">`
- Targeted ONLY the footer wordmark (20px), not the nav wordmark (18px)
- Applied to all 85 pages with the unified footer

### 4. Terms / Privacy in new tab (85 pages, 178 link occurrences)
- Bulk-added `target="_blank" rel="noopener noreferrer"` to every <a> tag
  pointing at /terms/ or /privacy/ paths
- Approximately 89 links per type, 178 total updates

### 5. /contact/ page rebuild
- Removed duplicate "Why log in first?" info-card (was duplicating the
  login-gate copy below)
- Added "Signup or login issues" to Common topics list (now first item)
- Added "Signup / login issues" and "Other" to form category dropdown
- Replaced login-gate copy: "Log in to submit this form" → "Log in if you
  have an account" with new helper text about auto-attaching account details
- Removed `disabled` attributes from all 4 form fields — form is now
  accessible WITHOUT login (login is optional/informational, not required)
- Replaced Memberstack JS auth check with Supabase pattern (with Phase 1
  fallback so the form works pre-Supabase-integration)
- Replaced Make.com webhook URL with `DISABLED-pending-n8n-replacement`
  placeholder (per spec: Make.com is replaced by n8n)
- Added Supabase JS SDK to <head>
- Repointed login button from /login/ to /signup/ (canonical entry point)

### 6. /signup/ help block
- Inserted below the form, above the footer
- Subtle card design: 540px max-width, cream background, info icon
- Title in Playfair Display, body in DM Sans, amber accent link
- Links to /contact/ for users who get stuck signing up
- Design approved by founder before implementation

State: 85 pages → 85 pages (no new pages). Sitemap unchanged (40 URLs).


## v22 deploy (2026-05-18)

Contact page hardened with anti-bot client-side defences (delivered by
the webarchitect). All v21 changes preserved.

### Client-side defences on /contact/index.html

1. **Honeypot** — `<input name="website">` inside an aria-hidden,
   off-screen wrapper. Real users never see or interact with it.
   Bots that auto-fill URL/website fields trip it. handleSubmit shows
   success and silently aborts the POST.

2. **Time-trap** — hidden `f-load-ts` input stamped with `Date.now()`
   on page load. handleSubmit rejects (silently) if elapsed time
   < MIN_FILL_MS (3000). Real users always take longer.

3. **maxlength caps** on every field:
   - name: 80
   - email: 254
   - subject: 120
   - message: 5000

4. **Defensive .slice()** in handleSubmit using the same caps — belt-
   and-braces in case maxlength was bypassed.

5. **CONTACT_WEBHOOK as const** at top of script. Currently set to
   `DISABLED-pending-n8n-replacement`. When n8n S7 is built, ONE LINE
   change makes the form functional. While DISABLED, handleSubmit
   shows success without firing fetch — fully testable today.

### Server-side spec (n8n S7) — not yet built

Documented in `/backend-specs/S7-contact-form-spec.md`. Critical points:
- Server-side honeypot + time-trap re-check (client is bypassable)
- Email-header-injection defence: strip `\r\n` from email + subject
  BEFORE any Beehiiv call. Without this, the form can be turned into
  an open relay.
- Length caps server-side too (don't trust client)
- Rate limit: 3/hr per IP, 1/hr per email, 50/24h per IP
- Silent rejection pattern (HTTP 200 even on rejection) — denies bots
  signal about thresholds

### New files

- `/sql/v22_contact_rate_limit_table.sql` — Supabase table for rate-
  limit counters. Run before n8n S7 ships.
- `/backend-specs/S7-contact-form-spec.md` — full server-side spec.

### When n8n S7 is built

1. Run the SQL migration (creates contact_rate_limit table)
2. Build S7 per the spec document
3. Update `CONTACT_WEBHOOK` const in /contact/index.html to the n8n URL
4. Ship — form is live with full defences

No other changes in v22. Sitemap unchanged (40 URLs). Pages on disk: 86.


## v23 deploy (2026-05-19)

Backend JS integration — Phase A site-wide + Phase B page-specific.

### Phase A — Site-wide additions

- **/js/ folder created** at the deploy root with 4 base files + 6 page files:
  - `/js/config.js` — central config (Supabase URL, anon key, Stripe key, webhook secret, n8n base + paths)
  - `/js/supabase-client.js` — Supabase client singleton
  - `/js/auth.js` — `GCAuth` helper (signUp, signIn, magic link, requireAuth, etc.)
  - `/js/webhooks.js` — `GCWebhook` helper (submitOnboarding, endSession, submitContact, newsletterSignup)
  - `/js/pages/signup.js` — email/password signup
  - `/js/pages/login.js` — login form
  - `/js/pages/onboarding.js` — (file included, but NOT used in /onboarding/ — we kept the existing wizard's inline JS instead, just changed the submit path to call GCWebhook.submitOnboarding)
  - `/js/pages/chat.js` — (file included, deferred — needs Supabase Edge Function before /chat/ can be rewired)
  - `/js/pages/contact.js` — CUSTOMIZED to preserve v22 anti-bot defences (honeypot, time-trap, length caps) AND use GCWebhook.submitContact
  - `/js/pages/newsletter.js` — newsletter signup via GCWebhook

- **Supabase CDN script** added to <head> of all 86 pages
  - 84 pages got it via the standard </head> anchor
  - 2 pages skipped (/contact/, /onboarding/ already had it from v18/v22)
  - 2 pages required fallback insertion before <body> (homepage and /vibe/index.html
    had malformed HTML missing </head>; fixed inline)

- **Base scripts** added before </body> on all 86 pages:
  ```
  <script src="/js/config.js"></script>
  <script src="/js/supabase-client.js"></script>
  <script src="/js/auth.js"></script>
  <script src="/js/webhooks.js"></script>
  <script src="/js/pages/newsletter.js"></script>
  ```

- **/login/ page CREATED** — new page mirroring /signup/ chrome but minimal
  form (email/password only). Uses /js/pages/login.js. Includes link back
  to /signup/ for new users.

- **Newsletter form** in the global footer got proper IDs:
  - Form gets `id="gc-newsletter-form"` and `data-source="footer_signup"`
  - Email input gets `id="gc-newsletter-email"`
  - Submit button gets `id="gc-newsletter-btn"`
  - Success div gets `id="gc-newsletter-msg"`
  - Inline `onsubmit` removed (handler now in newsletter.js)
  - Applied to 85 pages (footer-bearing pages)

### Phase B — Page-specific integrations

- **/signup/**:
  - firstname field REMOVED (name collected on /dashboard/ per founder's decision)
  - Email + password section wrapped in `<form id="gc-signup-form">`
  - Inputs got gc-* IDs + name attributes
  - Inline `handleSubmit` + `showErr` + sessionStorage save logic REMOVED
    (replaced by /js/pages/signup.js which uses Supabase auth.signUp)
  - OAuth buttons (Google/Facebook) left in place visually but currently
    non-functional — Supabase OAuth needs separate configuration

- **/contact/** (KEEPS v22 security):
  - IDs renamed to gc-* prefix for fields the JS addresses by ID
  - `name="..."` attributes added to fields (the new contact.js uses FormData)
  - gc-error and gc-success elements added
  - Inline `handleSubmit` + CONTACT_WEBHOOK const REMOVED
  - /js/pages/contact.js is a CUSTOMIZED version preserving all v22 defences:
    - Honeypot check at top of submit handler
    - Time-trap (MIN_FILL_MS = 3000)
    - Defensive .slice() length caps
    - Silent rejection pattern
    Then on pass: `GCWebhook.submitContact()` fires
  - Result: bot defences + n8n integration both present

- **/onboarding/**:
  - Existing 2-step wizard preserved (UI, multi-select chips, progress bar)
  - Phase 1 SUPABASE_URL placeholder removed
  - Auth gate switched to `GCAuth.requireAuth('/login/')`
  - Submit path switched to `GCWebhook.submitOnboarding(userId, profile)`
  - Post-onboarding redirect changed: `/chat/?onboarded=true` → `/dashboard/`
    (matches webarchitect's flow where /dashboard/ collects name/phone/country)
  - firstname/lastname/phone/country deliberately OMITTED from the submit
    payload (they live on /dashboard/ per the founder's decision)
  - /js/pages/onboarding.js NOT included on this page (existing wizard JS
    is more sophisticated than the webarchitect's version)

### Deferred to a later deploy (Phase C)

- /chat/ rewrite to use Supabase Edge Function `marcus-chat` instead of
  the Phase 1 client-side API key. Requires the Edge Function to be
  deployed first.
- /dashboard/ purpose redefinition. Currently has profile + Stripe card UI.
  In the new flow it remains the collector for firstname/lastname/phone/
  country AND becomes the payment step. No changes in this deploy.

### Config still pending (founder action required)

1. `config.js` has REAL values for: Supabase URL/anon, Stripe pk, webhook
   secret, Stripe price IDs. Verify these are correct.
2. Supabase Edge Function `marcus-chat` must be deployed:
   `supabase functions deploy marcus-chat --project-ref irmkcmcgfstdieujrrlg`
3. Supabase secrets:
   `supabase secrets set ANTHROPIC_API_KEY=sk-ant-... --project-ref irmkcmcgfstdieujrrlg`
   `supabase secrets set SUPABASE_SERVICE_ROLE_KEY=eyJ... --project-ref irmkcmcgfstdieujrrlg`
4. Run pending SQL migrations:
   - `/sql/v18_onboarding_schema.sql` (replaces + additional_context columns)
   - `/sql/v22_contact_rate_limit_table.sql` (rate-limit counter table)
5. Build n8n scenarios S2 (onboarding), S7 (contact form), S8 (newsletter).
   S3 (session end) blocked on /chat/ rewrite.

### State after v23

- Pages on disk: 87 (was 86 — +1 for new /login/)
- Sitemap URLs: 40 (unchanged — /login/ is noindex like /onboarding/)
- Orphans: 37
- 301 redirects: 6
- JS files in deploy: 10 (+ /js/ folder structure)
- Webhook secrets in client: YES (intentional per webarchitect — only authorizes
  triggers, never data reads; service role key never in client)


## v24 deploy (2026-05-20)

JS supabase-client refactor + onboarding scope fix.

### Files changed (4 total)

1. `/js/supabase-client.js` — exposes `window.gcSupabase` instead of a 
   local `const supabase`. Avoids confusion with the CDN's `window.supabase` 
   (which is the namespace object containing `.createClient`).

2. `/js/auth.js` — all references to `supabase.auth.*` renamed to 
   `gcSupabase.auth.*` to match the new client name.

3. `/js/pages/chat.js` — all references to `supabase.from()`, 
   `supabase.channel()` renamed to `gcSupabase.*` to match.

4. `/onboarding/index.html` — REQUIRED collateral fix. The v23 onboarding 
   inline JS declared `let gcSupabase = null;` at top of script, which 
   created a script-lexical-environment binding that shadowed 
   `window.gcSupabase` across the whole realm. With the new supabase-client.js
   exposing `window.gcSupabase`, this shadowing would have caused 
   `GCAuth.requireAuth()` to crash on first call (null reference).
   
   Fix: removed the `let gcSupabase = null;` declaration AND removed the 
   redundant `gcSupabase = window.supabase.createClient(...)` line in 
   `init()`. All `gcSupabase` references in the onboarding inline JS now 
   resolve to the global `window.gcSupabase` singleton.

### Why the rename matters

The Supabase CDN script exposes `window.supabase` — a namespace object that 
contains `.createClient`, `.createBrowserClient`, etc. Naming a client 
instance `supabase` (as v23 did) created confusion:
- `window.supabase.createClient(...)` — the CDN
- `supabase.auth.signUp(...)` — our client instance

With separate names (`window.supabase` = CDN, `window.gcSupabase` = our 
client), the distinction is clear and there's no risk of accidentally 
referencing the CDN namespace when you meant the client.

No other site changes in v24. Sitemap unchanged. Pages on disk: 87.


## v25 deploy (2026-05-20)

New /processing/ page — post-onboarding bridge before /chat/.

### What was built

1. **NEW PAGE: /processing/index.html** (14.7 KB)
   - Minimal funnel-safe nav (brand wordmark only, like /onboarding/)
   - Centered card design with cream/white surface, brand-aligned
   - H1: "Marcus is preparing your profile." (Playfair Display 34px, 
     "Marcus" in italic amber)
   - Three pulsing amber dots (CSS animation, 1.4s cycle, 0.2s cascade)
   - Three body paragraphs (DM Sans 15px, founder-direct tone)
   - Reassuring aside ("You can wait here or close the tab")
   - noindex meta, NOT in sitemap (functional page)
   - Responsive at 680px breakpoint

2. **NEW SCRIPT: /js/pages/processing.js** (1.9 KB)
   - GCAuth.requireAuth("/login/") — auth gate
   - On load: immediate readiness check (returning users go straight to /chat/)
   - Supabase real-time subscription on profiles UPDATE events for this user
   - Polling fallback every 30s (defends against missed real-time events)
   - Redirects to /chat/ when marcus_ready_at field is set

3. **NEW SQL MIGRATION: /sql/v25_marcus_ready_field.sql**
   - Adds `marcus_ready_at TIMESTAMPTZ` column to profiles
   - Adds partial index for fast "ready users" queries
   - n8n S2 must set this field at the end of its processing flow

4. **MODIFIED: /onboarding/index.html**
   - Final redirect after submit: /dashboard/ → /processing/
   - User flow now: signup → email confirm → onboarding → processing → chat

### New user flow (post-v25)

```
/signup/             email + password account creation
       ↓ (Supabase sends confirmation email)
[email click]
       ↓ (lands on /onboarding/ per auth.js emailRedirectTo)
/onboarding/         2-step wizard (product/stage/business model/tools/
                     bottleneck/tried/goal/replaces/additional context)
       ↓ (submit calls GCWebhook.submitOnboarding → n8n S2)
/processing/         NEW — shows pulsing dots + status message
                     waits for marcus_ready_at to be set on the profile row
       ↓ (real-time event when n8n S2 finishes)
/chat/               first coaching session with Marcus
```

### What n8n S2 must do (when built)

At the end of S2's flow, after INSERT/UPDATE of the profile row:
```sql
UPDATE profiles SET marcus_ready_at = now() WHERE user_id = $1;
```
This triggers the Supabase real-time event that /processing/ subscribes to,
causing the page to redirect to /chat/.

### Founder action required

1. Run `/sql/v25_marcus_ready_field.sql` in Supabase SQL Editor
2. When building n8n S2, add the marcus_ready_at UPDATE as the final step

### State after v25

- Pages on disk: 88 (was 87 — +1 for /processing/)
- Sitemap URLs: 40 (unchanged — /processing/ is noindex)
- Orphans: 37
- 301 redirects: 6
- SQL migrations pending: v18 (replaces+additional_context), v22 (rate_limit), 
  v25 (marcus_ready_at)
- Functional pages: 6 (signup, login, onboarding, processing ←NEW, chat, dashboard)


## v26 deploy (2026-05-21)

Full Option B flow built — adds /card/ + /activating/ as brand-styled pages
that integrate the webarchitect's functional patterns with the v25 design system.

### Complete user flow (post-v26)

```
/signup/              email + password
     -> email confirm  (Supabase sends + auth.js redirects to /onboarding/)
/onboarding/          business wizard (existing)
     -> POST to n8n S2 via GCWebhook.submitOnboarding
/processing/          "Marcus is preparing your profile"
                      (v25 brand design, pulsing dots)
                      Subscribes Supabase real-time on profiles.marcus_ready_at
                      Polling fallback every 30s
     -> redirect to /card/
/card/                "Start your 14-day free trial"
                      (NEW v26, brand-styled card capture)
                      Stripe Elements card field
                      POSTs to n8n S5 to create subscription
     -> redirect to /activating/
/activating/          "Activating your trial..."
                      (NEW v26, sister page to /processing/)
                      Polls users.status every 3s
                      Help fallback link after 30s
     -> redirect to /chat/
/chat/                Marcus session (existing Phase 1)
```

### New files in v26

1. `/card/index.html` (16.4 KB) — Stripe Elements card capture page.
   Brand-styled: cream bg, white card surface, Playfair "Start your 14-day
   free trial" headline with italic amber "free trial", DM Sans body, amber
   submit button, teal-tinted trial note, lock-icon security note,
   help fallback link to /contact/.

2. `/js/pages/card.js` (2.9 KB) — Stripe Elements integration:
   - GCAuth.requireAuth("/login/") auth gate
   - Reads ?plan= URL param (builder/operator/lifetime)
   - Plan badge + price line dynamically populated from PLAN_INFO map
   - Stripe Elements card field with brand-matched styling
     (DM Sans font, amber focus border, red invalid border)
   - On submit: createPaymentMethod, POST to /gc-s5-subscribe with
     payment_method_id, plan, stripe_price_id, user_id
   - Includes WEBHOOK_SECRET in x-gc-secret header
   - Success: redirect to /activating/

3. `/activating/index.html` (14.8 KB) — Trial activation wait page.
   Sister design to /processing/: same chrome, same card layout, same
   pulsing amber dots. Different content:
   - H1: "Activating your trial..." with italic amber "trial"
   - Body: "We are setting up your subscription with Stripe and unlocking
     your first session with Marcus. This usually takes just a few seconds."
   - Help fallback (hidden by default): "Taking longer than expected?
     Let us know -> /contact/" — surfaces after 30 seconds

4. `/js/pages/activating.js` (1.2 KB) — Status polling:
   - GCAuth.requireAuth("/login/") gate
   - Polls users.status every 3 seconds
   - Redirects to /chat/ when status changes from "pending" to anything else
   - Surfaces help fallback element after 10 polls (30 seconds)

5. `/sql/v26_users_status_field.sql` (1.1 KB) — schema migration:
   - Adds `status TEXT DEFAULT 'pending'` to users table
   - Backfills existing rows
   - Adds partial index on non-pending statuses (for analytics queries)

### Files modified in v26

1. `/js/pages/processing.js` — redirect target changed from /chat/ to /card/.
   All other logic (marcus_ready_at + Supabase real-time + 30s polling
   fallback) preserved from v25.

2. `/processing/index.html` and `/js/pages/processing.js` — these had been
   accidentally overwritten by the webarchitect's dark-themed
   "Activating your trial" version at some point in the previous turn.
   Restored to v25 brand-styled "Marcus is preparing your profile" version
   with corrected redirect target (/card/ instead of /chat/).

3. `/onboarding/index.html` — final redirect restored to /processing/
   (had reverted to /chat/?onboarded=true at some point).

### Backend dependencies (founder action required)

1. Run SQL migrations in Supabase SQL Editor:
   - `/sql/v18_onboarding_schema.sql` (replaces + additional_context)
   - `/sql/v22_contact_rate_limit_table.sql` (rate-limit table)
   - `/sql/v25_marcus_ready_field.sql` (profiles.marcus_ready_at)
   - `/sql/v26_users_status_field.sql` (users.status)

2. Build n8n S2 (onboarding webhook). At the end of S2 processing:
   `UPDATE profiles SET marcus_ready_at = now() WHERE user_id = $1;`
   This unblocks /processing/ -> /card/

3. Build n8n S5 (Stripe subscription create). After Stripe creates the
   subscription successfully:
   `UPDATE users SET status = 'trialing' WHERE id = $1;`
   This unblocks /activating/ -> /chat/

4. Verify config.js has correct Stripe price IDs:
   - STRIPE_PRICE_BUILDER (currently set)
   - STRIPE_PRICE_OPERATOR (currently set)
   - STRIPE_PRICE_LIFETIME (verify or add — used by /card/?plan=lifetime)

### State after v26

- Pages on disk: 90 (was 88 — +2 for /card/ and /activating/)
- Sitemap URLs: 40 (unchanged — both new pages are noindex)
- Orphans: 37
- 301 redirects: 6
- JS files in deploy: 13 (4 base + 9 page-specific)
- SQL migrations pending: 4 (v18, v22, v25, v26)
- Functional pages: 8 (signup, login, onboarding, processing, card, activating, chat, dashboard)


## v27 deploy (2026-05-22)

Multi-part: dashboard Lifetime, nav Log in links, meta changes, new /account/
page, user_memory schema.

### Phase 1 — Dashboard Lifetime
- Added Lifetime as 3rd plan option in the switcher ($499 once)
- selectPlan() rewritten: toggles all 3 options, hides the trial note when
  Lifetime is selected (one-time payment, no trial), relabels the CTA button
  to "Get lifetime access →", updates the plan label
- Removed the old lifetime special-case that locked/replaced the plan-row

### Phase 2 — Nav "Log in" links
- Homepage: "Log in" text link (.nav-link) added before "Start free trial →"
- Inner pages (about, contact, how-it-works): "← Back to home" wrapped in a
  flex container with a "Log in" text link before it (inline-styled to match
  the dark nav, no class dependencies)

### Phase 3 — Meta changes
- Homepage <title>: "AI Business Coach for Solo SaaS Founders | GhostCoach"
- Homepage description: "AI business coaching for solopreneurs building SaaS.
  One specific recommendation per session — not a menu of options. 14-day free trial."
- /vibe/ <title>: "AI Business Coach for Vibe Coders | GhostCoach"

### Phase 4 — NEW /account/ page (28.5 KB) + account.js (11 KB)
Single scrollable page, 7 sections, brand-styled (cream, white cards,
Playfair headers). Account-specific nav (brand + Back to sessions + Log out).
noindex, not in sitemap.

Sections:
1. Personal info — firstname, lastname, phone, country (editable);
   email read-only with "Need to change your email? Contact support." note.
   Saves to profiles via upsert.
2. Business profile — 8 editable onboarding fields (product, stage,
   business_model, tools, bottleneck, tried, replaces, additional_context).
   Saves to profiles via upsert.
3. 90-day goal — goal_90_day textarea + progress bar (goal_progress) + reset
   button (sets progress to 0, fresh goal_start_date).
4. Session history — reads sessions table, renders list (session number, date,
   3-bullet summary, action committed, goal progress score) + an inline SVG
   line chart of goal_progress_score over time (drawn with vanilla JS, no
   chart library — respects the no-npm constraint).
5. Plan & billing — current plan pill + status, upgrade/downgrade/cancel
   buttons (POST to n8n S6 /gc-s6-plan), payment method line. Lifetime plan
   hides all billing actions (permanent, no recurring billing).
6. Email preferences — newsletter toggle (POST to n8n S8 signup/unsubscribe),
   transactional emails shown as locked-on (disabled toggle).
7. Danger zone — delete account (double-confirm, POST to n8n S6 type:delete,
   then GCAuth.signOut).

account.js loads profiles + users + sessions + subscriptions + newsletter in
parallel (Promise.all), populates every field, wires all save handlers.

### Phase 5 — SQL migration /sql/v27_user_memory_field.sql
Adds `user_memory TEXT` to profiles for the curated-memory pattern. n8n S3
(session-end) must, in addition to the 3-bullet summary, distil each session
into this rolling ~500-1000 token memory. New-session context becomes:
MARCUS_PROMPT + business profile + user_memory + last 1-2 session summaries.
(This avoids dumping raw transcripts into context.)

### Backend dependencies (founder action)
- Run /sql/v27_user_memory_field.sql in Supabase
- n8n S3: update user_memory at session end (curated memory)
- n8n S6 (/gc-s6-plan): handle upgrade/downgrade/cancel/delete from /account/
- n8n S8 (/gc-s8-signup, /gc-s8-unsubscribe): newsletter toggle from /account/

### State after v27
- Pages on disk: 91 (was 90 — +1 for /account/)
- Sitemap URLs: 40 (unchanged — /account/ is noindex)
- JS files: 14 (4 base + 10 page-specific, now includes account.js)
- SQL migrations pending: 5 (v18, v22, v25, v26, v27)
- Functional pages: 9 (signup, login, onboarding, processing, card,
  activating, chat, dashboard, account)


## v28 deploy (2026-05-22)

Two tweaks.

### Tweak 1 — /activating/ copy = /processing/ copy
The two wait pages serve a similar role, so /activating/ now uses the same
copy as /processing/:
- Headline: "Marcus is preparing your profile."
- Same three body paragraphs (Ghost OS profile / email when ready / wait or close tab)
Kept on /activating/: its own meta (title "Activating your trial", canonical
/activating/), the activating.js script (polls users.status → /chat/), and the
#gc-help-fallback link that surfaces after 30s. Only the visible copy changed.

### Tweak 2 — Dashboard custom card field → Stripe Elements
The dashboard previously collected raw card number / expiry / CVV in custom JS
(fmtCard, detectCardType, fmtExp, validateAll) — which means card data touched
our code. Replaced with Stripe Elements, matching /card/ and satisfying the
PCI rule (card data never touches GhostCoach code).

Changes:
- Added Stripe.js (<script src="https://js.stripe.com/v3/">) to dashboard head
- Replaced card number + expiry + CVV inputs with a single Stripe Elements
  mount (#gc-card-element) + error display (#gc-card-error)
- Kept the "Name on card" field (passed as billing_details.name)
- Removed fmtCard / detectCardType / fmtExp / validateAll / showFieldErr
- Removed dead CSS (.card-num-wrap, .card-type-badge)
- Added Stripe Elements init + brand-matched styling (amber focus border)
- CTA button enables when the card is complete AND name is filled
- Rewrote handleStart(): createPaymentMethod -> POST to n8n S5
  (/gc-s5-subscribe) with payment_method_id + plan + stripe_price_id ->
  redirect to /activating/ (was a direct sessionStorage save + /chat/ redirect)

The dashboard's Stripe flow now mirrors /card/ exactly. Both card-entry paths
converge on /activating/.

### Note for founder
The dashboard and /card/ are now two card-entry points doing the same thing
(Stripe Elements -> n8n S5 -> /activating/). In the Option B funnel only /card/
is used. The dashboard remains as the original "Step 2 of 3" page. Worth
deciding later whether the dashboard becomes purely post-trial management
(it overlaps with /account/ now) or stays as an alternate signup entry.

### State after v28
- Pages on disk: 91 (unchanged)
- Sitemap URLs: 40 (unchanged)
- No new pages; edits to /activating/ and /dashboard/ only


## v29 deploy (2026-05-22)

Dashboard card cleanup, single card entry, /account/ confirmations + billing portal.

### Dashboard
- Removed the credit-card brand logos (VISA/Mastercard/AMEX/UnionPay SVGs)
  and the "via Stripe" label
- Removed the "Name on card" field (users may pay with someone else's card);
  validateCard() now only requires the Stripe Elements card to be complete;
  handleStart billing_details sends email only (no name)
- Removed dead CSS (.card-logos / .card-logo / .logo-label)

### Single card entry point
Per founder decision, the dashboard is now the ONLY card-entry point.
- /processing/ redirect changed: /card/ → /dashboard/
- _redirects: /card/ → /dashboard/ (301!) so the old /card/ URL funnels in
- NOTE: a polished Card_index.html was uploaded in the same message; it was
  NOT used because the explicit instruction was "dashboard = the one entry."
  /card/ now 301s to /dashboard/. Reversible if the founder meant the opposite.

New funnel:
  /signup/ → email confirm → /onboarding/ → /processing/ → /dashboard/ → /activating/ → /chat/

### /account/ — Manage billing & invoices
Added a "Manage billing & invoices" button to Plan & billing. It POSTs to
n8n /gc-s6-portal (which must create a Stripe billing-portal session and
return { url }), then redirects to the Stripe-hosted Customer Portal where
the user can update company name, billing address, VAT/tax ID, download
invoices, update card, and manage plan.

### /account/ — confirmations (per the supplied screenshot)
- Edit personal / business → inline "Saved ✓" + toast
- Edit 90-day goal → "Goal updated ✓" toast
- Toggle email preference → flips instantly + "Updated ✓" toast; Beehiiv sync
  is fire-and-forget (non-blocking, doesn't revert on failure)
- Upgrade (Builder→Operator) → optimistic: pill flips to Operator immediately +
  banner "You're now on Operator — weekly digest and pricing audit unlocked."
- Downgrade (Operator→Builder) → banner "Your plan changes to Builder on [date].
  You keep Operator access until then." + persistent scheduled-change notice
- Lifetime upgrade → celebratory banner "You're a founding member — Operator
  features, for life." Handles cap-full failure (HTTP 409) →
  "All 50 founding-member spots are taken."
- Cancel → "Your subscription ends [date]. Access continues until then." +
  win-back ("Keep my subscription" → resume)
- Delete → type-DELETE-to-proceed modal (button disabled until input === DELETE)
  → on success a full-screen "Your account has been deleted." → signs out

[date] values come from subscription.current_period_end (already loaded).

### Backend dependencies (founder action)
- n8n /gc-s6-plan must handle: upgrade, downgrade, lifetime (return 409 when
  the 50-spot cap is reached), cancel, resume, delete
- n8n /gc-s6-portal must create a Stripe billingPortal session and return
  { url } (uses Stripe secret key — n8n only)

### State after v29
- Pages on disk: 91 (unchanged; /card/ now 301s to /dashboard/)
- Sitemap URLs: 40 (unchanged)
- 301 redirects: 7 (added /card/ → /dashboard/)
- Edits: dashboard, processing.js, _redirects, account/index.html, account.js
