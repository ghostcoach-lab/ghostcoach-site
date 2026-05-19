# GhostCoach Site Inventory & SEO Strategy Handover

**Generated:** 2026-05-19 (v2 — adds functional pages section)
**For:** External SEO specialist — additional landing page strategy
**Site:** https://getghostcoach.com
**Current production state:** v14 + /how-it-works/ added to sitemap

---

## 1. Executive summary

| Metric | Count |
|---|---|
| Total HTML pages on disk | 87 |
| Pages in `sitemap.xml` (indexable) | 40 |
| Orphan pages (on disk, not indexed) | 37 |
| 301-redirected (consolidated duplicates) | 5 |
| Functional pages excluded from sitemap | 5 |

**Cluster breakdown:**

| Cluster | Total | Live | Orphan | Redirected |
|---|---|---|---|---|
| /vibe/ | 8 | 8 | 0 | 0 |
| /guides/ | 55 | 13 | 37 | 5 |
| /ai-business-coach/ | 8 | 8 | 0 | 0 |
| /ai-self-coaching/ | 5 | 5 | 0 | 0 |
| top-level content | 5 | 5 | — | — |
| top-level functional | 6 | 1 | — | — |


---

## 2. Site structure and conventions

**Tech stack** — Pure static HTML/CSS/Vanilla JS on Netlify, no framework or build pipeline. Every new page must work as a single `.html` file with inline styles or a single `<style>` block per file.

**URL convention** — Directory-based clean URLs only. Every page lives at `/folder/index.html` and is served at `https://getghostcoach.com/folder/`. Never use `.html` extensions in published URLs.

**Required brand elements on every new page:**
- Google Fonts CDN link for **Playfair Display** (headings) + **DM Sans** (body)
- CSS variables for brand colours:
  - `--ink: #0F1117` (dark background)
  - `--ink-soft: #1A1D27` (secondary dark)
  - `--amber: #C8861E` (primary accent / CTAs)
  - `--amber-lt: #E8A832` (italic accents)
  - `--cream: #F7F5F0` (light background)
  - `--teal: #0B7A60` (success states)
  - `--muted: #8B8A98` (secondary text)
- Canonical `<link rel="canonical">` tag with the page's own absolute URL
- Identical nav and footer (inline-styled, copyable from any existing page)
- Base64 SVG favicon
- Mobile breakpoint `@media (max-width: 680px)`

**Required SEO elements:**
- `<title>` ≤60 characters before the ` | GhostCoach` suffix
- `<meta name="description">` ≤155 characters
- At least 4 contextual internal links in body
- Related-links box at bottom with 4 cluster siblings
- Primary CTA pointing to `#pricing` on the homepage (i.e. `/#pricing`)

**Trial / pricing facts (must be accurate on every new page):**
- 14-day free trial (NEVER 7-day)
- Builder $79/mo or $632/yr
- Operator $149/mo or $1,192/yr
- Lifetime $499 one-time, 50 spots, "founding member price", Operator-for-life
- Lifetime carries a 30-day money-back guarantee
- The coach character is named **Marcus** (never "Alex" or anything else)

---

## 3. Live pages — full inventory

These are the 40 pages currently indexed in `sitemap.xml`. **Do NOT create new pages that duplicate these topics.** Cross-link new pages to the relevant live ones via the related-links box.

### 3.1 Top-level content pages

| Path | Title | Desc len | Issues |
|---|---|---|---|
| `/` | GhostCoach — The Business System for Solo Product Builders | 134 | ok |
| `/about/` | About GhostCoach — Why We Built It | 130 | ok |
| `/contact/` | Contact GhostCoach — Get in Touch | 74 | ok |
| `/privacy/` | Privacy Policy — GhostCoach | 145 | ok |
| `/terms/` | Terms of Use — GhostCoach | 128 | ok |

### 3.2 `/vibe/` cluster (8 live)

| Path | Title | Title len | Desc len | Issues |
|---|---|---|---|---|
| `/vibe/after-vibe-coding-what-next/` | What to Do After Vibe Coding — From App to Business | 51 | 149 | ok |
| `/vibe/get-customers/` | How to Get Customers for Your Vibe-Coded App | 44 | 154 | ok |
| `/vibe/` | GhostCoach — AI Business Coaching for Vibe Coders | 49 | 126 | ok |
| `/vibe/make-money/` | How to Make Money From Your Vibe-Coded App | 42 | 153 | ok |
| `/vibe/non-technical-founders/` | Vibe Coding for Non-Technical Founders — The Business Layer | 59 | 148 | ok |
| `/vibe/saas/` | Vibe-Coded SaaS — From MVP to Real Business | 43 | 136 | ok |
| `/vibe/saas-pricing/` | How to Price Your Vibe-Coded SaaS — A Specific Guide | 52 | 155 | ok |
| `/vibe/vibe-coded-app-broken/` | My Vibe-Coded App Is Broken — Ask This Before You Fix It | 56 | 153 | ok |

### 3.3 `/ai-business-coach/` cluster (8 live)

| Path | Title | Title len | Desc len | Issues |
|---|---|---|---|---|
| `/ai-business-coach/comparison/` | AI Business Coach Comparison: 4 Tools Compared | 46 | 144 | ok |
| `/ai-business-coach/features/` | AI Business Coach Features: What Actually Matters | 49 | 134 | ok |
| `/ai-business-coach/for-entrepreneurs/` | Best AI Business Coach for Entrepreneurs in 2026 | 48 | 143 | ok |
| `/ai-business-coach/for-solopreneurs/` | Best AI Business Coach for Solopreneurs in 2026 | 47 | 136 | ok |
| `/ai-business-coach/limitations/` | AI Business Coach Limitations — What It Cannot Do | 49 | 123 | ok |
| `/ai-business-coach/pricing/` | AI Business Coach Pricing: Free, Paid & Best Value | 50 | 137 | ok |
| `/ai-business-coach/reviews/` | AI Business Coach Reviews: What Users Actually Experience | 57 | 142 | ok |
| `/ai-business-coach/vs-human-coach/` | AI Business Coach vs Human Coach: Which Wins? | 45 | 144 | ok |

### 3.4 `/ai-self-coaching/` cluster (5 live)

| Path | Title | Title len | Desc len | Issues |
|---|---|---|---|---|
| `/ai-self-coaching/claude/` | Using Claude as a Business Coach: Prompts & Setup | 49 | 141 | ok |
| `/ai-self-coaching/frameworks/` | AI Self-Coaching Frameworks That Actually Work | 46 | 129 | ok |
| `/ai-self-coaching/free-coaching/` | Free Business Coaching — What You Can Get Without Paying | 56 | 141 | ok |
| `/ai-self-coaching/prompts/` | AI Business Coaching Prompts: 50+ for Founders | 46 | 130 | ok |
| `/ai-self-coaching/strategy-and-goals/` | Using AI for Business Strategy & Goal Setting | 45 | 134 | ok |

### 3.5 `/guides/` cluster (13 live)

| Path | Title | Title len | Desc len | Issues |
|---|---|---|---|---|
| `/guides/business-coach-cost-solopreneur/` | Business Coach Cost for Solopreneurs — Real Numbers | 51 | 140 | ok |
| `/guides/ghostcoach-vs-mentorcruise/` | GhostCoach vs MentorCruise — Honest Comparison | 46 | 141 | ok |
| `/guides/how-to-price-saas-product/` | How to Price a SaaS Product — The Solo Founder's Guide | 54 | 152 | ok |
| `/guides/how-to-reduce-saas-churn/` | How to Reduce SaaS Churn — A Diagnostic Guide for Solo Founders | 63 | 145 | title:63 |
| `/guides/how-to-validate-saas-idea/` | How to Validate a SaaS Idea — A Guide for Solo Founders | 55 | 146 | ok |
| `/guides/mrr-plateau-how-to-grow-saas/` | MRR Plateau: Why Your SaaS Growth Stopped (And How to Fix It) | 61 | 147 | title:61 |
| `/guides/retention-vs-acquisition-saas/` | Retention vs Acquisition for SaaS — A Diagnostic | 48 | 148 | ok |
| `/guides/saas-acquisition-system/` | The SaaS Acquisition System — How to Get Consistent Customers Wit | 78 | 154 | title:78 |
| `/guides/saas-business-automation/` | SaaS Business Automation — The Order That Actually Matters | 58 | 151 | ok |
| `/guides/saas-coach/` | SaaS Coach — Coaching for Subscription Software Founders | 56 | 145 | ok |
| `/guides/saas-customer-interviews/` | SaaS Customer Interviews — Questions That Produce Signal | 56 | 141 | ok |
| `/guides/scale-saas-without-hiring/` | How to Scale a SaaS Without Hiring — Solo Founder Playbook | 58 | 141 | ok |
| `/guides/what-is-ai-business-coaching/` | What Is AI Business Coaching? A Founder's Guide | 47 | 141 | ok |

### 3.6 Functional pages in sitemap (1)

| Path | Title | Title len | Desc len | Notes |
|---|---|---|---|---|
| `/how-it-works/` | How GhostCoach Works — The Ghost OS Framework | 45 | 118 | How It Works |


---

## 4. Orphan pages — on disk but NOT indexed

These 37 pages exist as `.html` files in the repo but are deliberately excluded from `sitemap.xml`. They're a content reserve — raw material for future expansion. They're accessible at their URLs but Google has been instructed not to index them via sitemap exclusion (no `noindex` meta).

**Status legend:**
- **TIER 3 raw material** — topical overlap with live canonicals; held as content for future briefing pages
- **HOLD — Pair 4** — awaiting differentiated rewrite deadline 11 June 2026
- **Pending v15 audit** — will be activated after factual-gate spot-check (see §6.4)

### 4.1 `/guides/` orphans

| Path | Title | Status |
|---|---|---|
| `/guides/ai-business-coach-for-founders/` | AI Business Coach for Founders — What It Is and Whether It W | TIER 3 raw material |
| `/guides/ai-business-coaching/` | AI Business Coaching — How It Works and Whether It's Worth I | TIER 3 raw material |
| `/guides/annual-vs-monthly-saas-pricing/` | Annual vs Monthly SaaS Pricing — Which Wins for Solo Founder | Pending v15 audit |
| `/guides/bootstrapped-saas-founder-coaching/` | Bootstrapped SaaS Founder Coaching — What It Is and Where to | Pending v15 audit |
| `/guides/feature-request-management/` | How to Handle Feature Requests as a Solo SaaS Founder — Sayi | Pending v15 audit |
| `/guides/first-10-paying-customers-saas/` | First 10 Paying Customers for SaaS — How to Get Them Without | TIER 3 raw material |
| `/guides/freemium-vs-paid-saas/` | Freemium vs Paid SaaS — Which Model Is Right for Your Produc | Pending v15 audit |
| `/guides/how-much-to-charge-micro-saas/` | How Much to Charge for a Micro SaaS — Pricing a Small Produc | Pending v15 audit |
| `/guides/how-to-communicate-with-users-email/` | How to Write Emails to SaaS Users — Templates for Every Situ | Pending v15 audit |
| `/guides/how-to-get-first-customers-saas/` | How to Get First Customers for SaaS — A Practical Guide for  | TIER 3 raw material |
| `/guides/how-to-grow-vibe-coded-saas/` | How to Grow Your Vibe-Coded SaaS Beyond the Launch Plateau | **HOLD — Pair 4 deadline 11 June 2026** |
| `/guides/how-to-launch-micro-saas/` | How to Launch a Micro SaaS — A Step-by-Step Guide for Solo F | Pending v15 audit |
| `/guides/how-to-market-app-no-audience/` | How to Market an App With No Audience — A Guide for First-Ti | Pending v15 audit |
| `/guides/how-to-price-subscription-app/` | How to Price a Subscription App — A Practical Guide for Solo | Pending v15 audit |
| `/guides/how-to-price-vibe-coded-app/` | How to Price a Vibe Coded App — Specific Guidance for Solo F | Pending v15 audit |
| `/guides/how-to-reduce-churn-subscription-app/` | How to Reduce Churn in a Subscription App — A Practical Guid | Pending v15 audit |
| `/guides/how-to-sell-micro-saas/` | How to Sell Your Micro SaaS — Valuation, Marketplaces, and W | Pending v15 audit |
| `/guides/how-to-track-mrr-indie-saas/` | How to Track MRR for Indie SaaS — Simple Tools and What to M | Pending v15 audit |
| `/guides/indie-hacker-saas-business-advice/` | Indie Hacker SaaS Business Advice — What Actually Moves the  | Pending v15 audit |
| `/guides/lifetime-deal-guide/` | Lifetime Deal vs Subscription SaaS — Should You Do One? A Co | Pending v15 audit |
| `/guides/merchant-of-record-vs-stripe/` | Merchant of Record vs Stripe — Which Should Indie SaaS Found | Pending v15 audit |
| `/guides/paddle-vs-stripe-indie/` | Paddle vs Stripe for Indie Developers — Which Is Right for Y | Pending v15 audit |
| `/guides/product-hunt-launch-tips/` | Product Hunt Launch Tips for Indie SaaS — What Actually Work | Pending v15 audit |
| `/guides/protecting-saas-idea/` | How to Protect Your SaaS Idea — Patents, IP, and What Actual | Pending v15 audit |
| `/guides/saas-moat-differentiation/` | How to Build a Moat for Your SaaS — Differentiation When Any | Pending v15 audit |
| `/guides/saas-outage-guide/` | What to Do When Your SaaS Goes Down — A Crisis Guide for Sol | Pending v15 audit |
| `/guides/saas-pricing-strategy-first-product/` | SaaS Pricing Strategy for Your First Product — What Actually | TIER 3 raw material |
| `/guides/saas-pricing-tiers-indie/` | SaaS Pricing Tiers for Indie Founders — How to Structure The | Pending v15 audit |
| `/guides/saas-revenue-metrics-beginners/` | SaaS Revenue Metrics for Beginners — MRR, Churn, LTV & More  | Pending v15 audit |
| `/guides/saas-trial-to-paid-conversion/` | Why Your SaaS Trial-to-Paid Conversion Is Low (And 3 Fixes) | Pending v15 audit |
| `/guides/solopreneur-saas-pricing-strategy/` | Solopreneur SaaS Pricing Strategy — What Actually Works | TIER 3 raw material |
| `/guides/status-page-uptime-monitoring/` | Status Page and Uptime Monitoring for Small SaaS — A Setup G | Pending v15 audit |
| `/guides/stripe-chargebacks-disputes/` | Stripe Chargebacks and Disputes — What to Do and How to Win | Pending v15 audit |
| `/guides/stripe-setup-guide/` | How to Add Stripe to Your App — Setup Guide for Non-Develope | Pending v15 audit |
| `/guides/vibe-coding-sell-subscription-app/` | Vibe Coding: How to Sell a Subscription App You Built | Pending v15 audit |
| `/guides/what-is-churn-rate-saas/` | What Is Churn Rate in SaaS? A Plain-English Guide for Solo F | Pending v15 audit |
| `/guides/where-to-post-saas-app/` | Where to Post Your SaaS App — The Channels That Actually Dri | Pending v15 audit |


---

## 5. Functional pages excluded from sitemap

These pages exist and are accessible at their URLs, but they're deliberately excluded from `sitemap.xml`. They are NOT SEO targets — listing them here so the specialist knows they exist (e.g. as link targets from new content) but doesn't accidentally treat them as content opportunities.

| Path | Purpose | Why excluded | Can SEO content link here? |
|---|---|---|---|
| `/signup/` | Account creation funnel | Conversion-only — no organic traffic value | Yes (CTA destination) |
| `/login/` | Unknown | Unknown | Unknown |
| `/dashboard/` | User profile + payment management | Auth-required — user-specific content | No |
| `/onboarding/` | Unknown | Unknown | Unknown |
| `/chat/` | The Marcus coaching session UI | Auth/transactional — not informational | No |


**FAQ note:** there is no standalone `/faq/` page. The site's FAQ content lives as an anchor section on the homepage (linked from the footer as `/#faq`). If you ever want a dedicated FAQ landing page (for long-tail FAQ-keyword SEO), that's a separate page-creation task.

---

## 6. Active 301 redirects (do NOT recreate these as new pages)

These URLs have been consolidated into canonical destinations. Any topic touching these areas should link to the canonical, not propose a new page on the same intent.

| Old URL (301 source) | Canonical destination | Reason |
|---|---|---|
| `/guides/vibe-coding-saas-pricing/` | `/vibe/saas-pricing/` | Pair 1 |
| `/guides/how-to-get-customers-vibe-coded-app/` | `/vibe/get-customers/` | Pair 2 |
| `/guides/how-to-monetize-vibe-coded-app/` | `/vibe/make-money/` | Pair 3 |
| `/guides/vibe-coding-micro-saas-business-model/` | `/vibe/make-money/` | Pair 5 |
| `/guides/ai-coach-vs-human-coach/` | `/ai-business-coach/vs-human-coach/` | Pair B |
| `/guides/ai-business-coach/pricing/` | `/ai-business-coach/pricing/` | Malformed-URL recovery |


---

## 7. Strategic decisions in flight (specialist should be aware)

### 7.1 Pair 4 deadline — 11 June 2026

`/guides/how-to-grow-vibe-coded-saas/` is on hold pending a differentiated rewrite vs `/vibe/after-vibe-coding-what-next/`. The hypothesis is these target genuinely different moments:
- `/vibe/after-vibe-coding-what-next/` = post-launch transition content (just shipped, what now)
- `/guides/how-to-grow-vibe-coded-saas/` = plateau content (have customers, growth has stalled)

If the rewrite ships with a sharp angle by 11 June 2026, both stay. If not, the orphan gets 301'd to `/vibe/after-vibe-coding-what-next/`.

**Specialist note:** if you propose new pages in the "post-launch / growth" topical area, coordinate with the founder so we don't accidentally create a third overlapping page.

### 7.2 TIER 3 held pairs

These cross-cluster topical neighbours were held (not 301'd) because the orphan content may become raw material for future briefing pages:

| Live canonical | Orphan held as raw material |
|---|---|
| `/vibe/saas-pricing/` | `/guides/solopreneur-saas-pricing-strategy/` |
| `/vibe/saas-pricing/` | `/guides/saas-pricing-strategy-first-product/` |
| `/vibe/get-customers/` | `/guides/how-to-get-first-customers-saas/` |
| `/vibe/get-customers/` | `/guides/first-10-paying-customers-saas/` |
| `/ai-business-coach/for-solopreneurs/` | `/guides/ai-business-coaching/` |
| `/ai-business-coach/for-entrepreneurs/` | `/guides/ai-business-coach-for-founders/` |

**Specialist note:** when proposing new pages, prefer folding insights from these orphans rather than creating from scratch. Each orphan represents an angle already drafted but not yet positioned.

### 7.3 Briefing priority gaps (DO NOT EXIST YET)

The original SEO briefing identified these 6 priority pages as gaps. None exist on disk:

1. `/guides/retention-vs-acquisition-saas/`
2. `/guides/how-to-validate-saas-idea/` ← founder's stated next page
3. `/guides/scale-saas-without-hiring/`
4. `/guides/saas-customer-support-solo/`
5. `/guides/saas-business-automation/`
6. `/guides/saas-customer-interviews/`

These are the highest-leverage content additions. Each is intentionally targeting a high-intent search query the live site doesn't currently cover.

### 7.4 v15 deploy — factual-gate spot-check

Before activating any orphan to sitemap in v15, three random pages from the candidate set get spot-checked for these stale facts:
- "Alex" (wrong — coach name is **Marcus**)
- "$39" / "$49" (wrong — prices are **$79 / $149 / $499**)
- "100 lifetime" (wrong — **50 spots**)
- "quarterly business review" (wrong — feature is **pricing audit**, quarterly cadence)
- "founding member" (must be present where Lifetime is mentioned)

If any spot-check trips, the grep gets expanded across the full v15 candidate set.

---

## 8. Recommended priority queue for additional landing pages

Based on gaps in the current topical map:

### Tier A — Briefing-named priority (write from scratch)

The 6 pages listed in §7.3. Each fills a known gap with no current overlap on the site. Each should be 1,500–2,500 words, follow the brand/style requirements in §2, include a related-box linking to relevant live siblings, and submit to sitemap on publish.

### Tier B — Topical expansions for under-served clusters

The current `/ai-self-coaching/` cluster has only 4 pages. Candidate expansions:
- "AI coaching prompts for [specific business stage]"
- "Building a self-coaching routine with AI"
- "How AI coaching compares to peer mentorship / mastermind groups"

The current `/ai-business-coach/` cluster has 7 pages. Candidate expansions:
- "AI business coach for [specific founder vertical]"
- "What an AI business coach can't do (limitations + complementary tools)"

### Tier C — Meta-level pages

Currently missing from the site:
- Case studies / customer outcome pages
- A glossary of business-coaching / SaaS terms (good for SEO long-tail capture)
- A blog index page (if a content marketing programme is planned)
- A dedicated `/faq/` landing page (currently FAQ content is only an anchor section on the homepage — extracting it to a standalone page would capture FAQ-keyword SEO)

---

## 9. Specialist working agreement

When proposing or producing new pages, please:

1. **Check this inventory first.** Confirm the proposed topic isn't already covered by a live page in §3 or a held orphan in §4.

2. **Use the URL conventions in §2.** Directory-based clean URLs, no `.html` extensions in published links.

3. **Match the brand requirements in §2.** Copy a recent live page (e.g. `/ai-self-coaching/prompts/`) as a starting template.

4. **Add new URLs to `sitemap.xml`** on the same deploy as the page itself. Include `<lastmod>` with today's date.

5. **Cross-link from at least one live page** to each new page so Google can crawl it via the topical graph, not just the sitemap.

6. **Don't propose pages on the 5 already-redirected topics** (see §6).

7. **Coordinate before creating any page in the "post-launch / growth" topical area** (Pair 4 hold — see §7.1).

8. **Facts to get right:** Marcus (not Alex), $79 / $149 / $499, 14-day trial, 50 lifetime spots, 30-day money-back guarantee.

9. **Functional pages (§5) are NOT SEO targets.** `/signup/` is a CTA destination only. `/dashboard/` and `/chat/` should never be linked from organic-content pages.

---

## 10. Reference files in the repo

- `sitemap.xml` — the canonical machine-readable sitemap (28 URLs)
- `_redirects` — Netlify 301 redirect rules (5 active, all force-flagged)
- `CONSOLIDATION_LOG.md` (repo root, not deployed) — internal decision history
- `robots.txt` — crawler instructions (currently permissive)

For technical questions about implementation, the founder can be reached directly. For content strategy questions, this document should answer most of them — if it doesn't, that's a gap to flag for the next revision.
