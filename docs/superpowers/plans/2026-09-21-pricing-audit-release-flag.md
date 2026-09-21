# Pricing Audit Release Flag Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fail-closed frontend release flag that keeps the entire pricing-audit account section hidden and avoids the eligibility request until the unfinished audit route is launch-ready.

**Architecture:** Reuse the site's central `GC` configuration object and pass one explicit boolean into the existing pricing-audit adapter. The adapter owns the fail-closed boundary: it resets the UI first and returns before network access unless the value is exactly `true`. Static integration assertions lock the configuration default and account-page wiring in place.

**Tech Stack:** Browser JavaScript, CommonJS-compatible adapter, Node.js built-in test runner and assertions.

---

## File Structure

- Modify `js/pricing-audit.js`: enforce the release gate before invoking the eligibility function.
- Modify `tests/js/pricing-audit.test.cjs`: specify disabled behavior, keep enabled behavior explicit, and verify account/config wiring.
- Modify `js/config.js`: define the production-default-off release flag.
- Modify `js/pages/account.js`: pass the central flag into the adapter.
- Modify `docs/operations/pricing-audit-deployment.md`: record the activation gate and deployment behavior.

### Task 1: Make the adapter fail closed behind an explicit flag

**Files:**
- Modify: `tests/js/pricing-audit.test.cjs`
- Modify: `js/pricing-audit.js:50-58`

- [ ] **Step 1: Write the failing disabled-state test and make existing enabled cases explicit**

Add this test after `supabaseResponse`:

```javascript
test('the release flag must be exactly true before eligibility is requested', async () => {
  const { loadAndRender } = require('../../js/pricing-audit.js');

  for (const enabled of [false, undefined, 'true']) {
    const calls = [];
    const elements = auditElements();
    elements.section.style.display = 'block';
    elements.cta.style.display = '';
    elements.gated.style.display = 'block';
    elements.gated.textContent = 'stale';
    elements.last.textContent = 'stale';
    elements.next.textContent = 'stale';

    await loadAndRender({
      enabled,
      supabase: supabaseResponse({
        data: {
          state: 'eligible',
          is_welcome_audit: true,
          next_eligible_date: null,
          last_completed_at: null
        },
        error: null
      }, calls),
      elements,
      formatDate
    });

    assert.deepEqual(calls, []);
    assert.equal(elements.section.style.display, 'none');
    assert.equal(elements.cta.style.display, 'none');
    assert.equal(elements.gated.style.display, 'none');
    assert.equal(elements.gated.textContent, '');
    assert.equal(elements.last.textContent, '—');
    assert.equal(elements.next.textContent, '—');
  }
});
```

In every existing `loadAndRender` call in this test file, add `enabled: true`. For example:

```javascript
await loadAndRender({ enabled: true, supabase, elements, formatDate });
```

For multiline calls, add `enabled: true` as the first property.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
node --test --test-name-pattern="release flag must be exactly true" tests/js/pricing-audit.test.cjs
```

Expected: FAIL because the current adapter ignores `enabled`, invokes the eligibility function, and reveals the eligible section.

- [ ] **Step 3: Add the minimal adapter gate**

Change the adapter signature and place the gate immediately after the existing reset:

```javascript
async function loadAndRender({ enabled, supabase, elements, formatDate }) {
  reset(elements);
  if (enabled !== true) return;

  try {
```

Leave all existing eligibility validation and rendering behavior unchanged.

- [ ] **Step 4: Run the complete adapter test file and verify GREEN**

Run:

```powershell
node --test tests/js/pricing-audit.test.cjs
```

Expected: 10 tests pass, 0 fail.

- [ ] **Step 5: Commit the adapter behavior**

```powershell
git add -- js/pricing-audit.js tests/js/pricing-audit.test.cjs
git commit -m "Gate pricing audit UI behind release flag"
```

### Task 2: Wire the production-default-off flag through the account page

**Files:**
- Modify: `tests/js/pricing-audit.test.cjs`
- Modify: `js/config.js:15-23`
- Modify: `js/pages/account.js:481-490`

- [ ] **Step 1: Write a failing integration-wiring test**

Add these imports at the top of `tests/js/pricing-audit.test.cjs`:

```javascript
const fs = require('node:fs');
const path = require('node:path');
```

Add this test after the disabled-state test:

```javascript
test('the account page wires a production-default-off pricing audit flag', () => {
  const configSource = fs.readFileSync(
    path.join(__dirname, '../../js/config.js'),
    'utf8'
  );
  const accountSource = fs.readFileSync(
    path.join(__dirname, '../../js/pages/account.js'),
    'utf8'
  );

  assert.match(configSource, /PRICING_AUDIT_ENABLED:\s*false/);
  assert.match(accountSource, /enabled:\s*GC\.PRICING_AUDIT_ENABLED/);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
node --test --test-name-pattern="production-default-off" tests/js/pricing-audit.test.cjs
```

Expected: FAIL because `GC.PRICING_AUDIT_ENABLED` does not yet exist and the account page does not pass it.

- [ ] **Step 3: Define the central release flag**

Add this block immediately after `GOAL_BAR_ENABLED` in `js/config.js`:

```javascript
  // Feature flag — quarterly pricing audit.
  // Keep false until /account/audit/ and its final session/verdict payload
  // contract pass integration testing and receive frontend release approval.
  PRICING_AUDIT_ENABLED: false,
```

- [ ] **Step 4: Pass the flag into the adapter**

Update the adapter call in `js/pages/account.js`:

```javascript
await GCPricingAudit.loadAndRender({
  enabled: GC.PRICING_AUDIT_ENABLED,
  supabase: gcSupabase,
  formatDate: fmtDate,
  elements: {
```

- [ ] **Step 5: Run the complete frontend test file and verify GREEN**

Run:

```powershell
node --test tests/js/pricing-audit.test.cjs
```

Expected: 11 tests pass, 0 fail.

- [ ] **Step 6: Commit the configuration and wiring**

```powershell
git add -- js/config.js js/pages/account.js tests/js/pricing-audit.test.cjs
git commit -m "Wire pricing audit release flag"
```

### Task 3: Record deployment and activation behavior

**Files:**
- Modify: `docs/operations/pricing-audit-deployment.md`

- [ ] **Step 1: Replace the opening release-readiness paragraph**

Replace the first paragraph after the title with:

```markdown
The account-page adapter is live through Netlify and is protected by
`GC.PRICING_AUDIT_ENABLED`, which defaults to `false`. While disabled, the entire pricing-audit
section remains hidden and the browser does not invoke the eligibility Edge Function. Do not
enable the flag until `/account/audit/` and its final verdict/session contract pass integration
testing and receive frontend release approval.
```

- [ ] **Step 2: Clarify the separate activation approval**

Replace this approval bullet:

```markdown
- Confirm the `/account/audit/` activation plan separately; backend deployment does not resolve that route.
```

with:

```markdown
- Keep `GC.PRICING_AUDIT_ENABLED = false` during backend deployment. Enabling it is a separate
  reviewed frontend release after `/account/audit/` and the final payload contract are verified.
```

- [ ] **Step 3: Add the disabled-state deployment check**

After the Edge Function deployment step, insert:

```markdown
6. Confirm production still has `GC.PRICING_AUDIT_ENABLED = false` and the account page does not
   display the pricing-audit section.
```

Renumber the existing verification steps that follow from 6–8 to 7–9.

- [ ] **Step 4: Verify documentation formatting and the frontend regression suite**

Run:

```powershell
git diff --check
node --test tests/js/pricing-audit.test.cjs
```

Expected: `git diff --check` emits no errors; 11 tests pass, 0 fail.

- [ ] **Step 5: Commit the deployment documentation**

```powershell
git add -- docs/operations/pricing-audit-deployment.md
git commit -m "Document pricing audit activation gate"
```

### Task 4: Final verification

**Files:**
- Verify only; no planned modifications.

- [ ] **Step 1: Run the focused frontend suite from a clean working tree**

```powershell
node --test tests/js/pricing-audit.test.cjs
```

Expected: 11 tests pass, 0 fail.

- [ ] **Step 2: Inspect the complete branch diff**

```powershell
git diff --check origin/main...HEAD
git diff --stat origin/main...HEAD
git status --short
```

Expected: no whitespace errors; the diff contains only the design, plan, adapter, configuration,
account wiring, tests, and deployment documentation; the working tree is clean.

- [ ] **Step 3: Confirm the safety properties in the diff**

Run:

```powershell
git grep -n "PRICING_AUDIT_ENABLED" HEAD -- js/config.js js/pages/account.js docs/operations/pricing-audit-deployment.md
git show HEAD:js/pricing-audit.js | Select-String -Pattern "enabled !== true" -Context 2,2
```

Expected: the config default is `false`, the account page passes the flag, deployment notes retain
the separate activation gate, and the adapter returns before the eligibility invocation.

No production deployment, Supabase migration, Edge Function deployment, or n8n mutation is part
of this implementation plan.
