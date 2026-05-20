# GhostCoach — Consolidation Log

Last updated: 2026-05-20

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
