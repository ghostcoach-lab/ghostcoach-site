# GhostCoach — Consolidation Log

Last updated: 2026-05-16

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
