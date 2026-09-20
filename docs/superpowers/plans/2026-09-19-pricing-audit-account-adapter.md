# Pricing Audit Account Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect the account page to the authenticated pricing-audit eligibility Edge Function and render all responses fail-closed.

**Architecture:** Add one build-free browser module that exposes the confirmed `GCPricingAudit.loadAndRender` seam and accepts the Supabase client, DOM elements, and date formatter as dependencies. Keep eligibility logic on the server; `account.js` only wires real dependencies, while Node tests exercise the module's public behavior with fakes.

**Tech Stack:** Vanilla browser JavaScript, Supabase JS `functions.invoke`, Node.js built-in test runner, TypeScript/Deno Edge Function

---

## File Structure

- Create `js/pricing-audit.js`: authenticated invocation, response validation, state reset, and rendering.
- Create `tests/js/pricing-audit.test.cjs`: public-seam behavior tests using fake elements and an injected Supabase client.
- Modify `account/index.html`: load the pricing-audit module before the account-page script.
- Modify `js/pages/account.js`: replace the eligibility stub and cached-plan gate with dependency wiring.
- Modify `supabase/functions/pricing-audit-eligibility/handler.ts`: constrain domain values and name the entitlement decision.
- Modify `D:/PersonalFiles/GhostCoach/MILESTONE-1-CHECKLIST.md`: distinguish handler coverage from pending runtime JWT/RLS verification.

### Task 1: Eligible Account Rendering

**Files:**
- Create: `tests/js/pricing-audit.test.cjs`
- Create: `js/pricing-audit.js`

- [ ] **Step 1: Write the failing eligible-state test**

Create the test helper and first behavior test:

```js
const assert = require('node:assert/strict');
const test = require('node:test');

function element(display = '') {
  return { style: { display }, textContent: '' };
}

function auditElements() {
  return {
    section: element('none'),
    last: element(),
    next: element(),
    cta: element(),
    gated: element('none')
  };
}

test('eligible response reveals the audit CTA after an authenticated function invocation', async () => {
  const { loadAndRender } = require('../../js/pricing-audit.js');
  const calls = [];
  const elements = auditElements();
  const supabase = {
    functions: {
      async invoke(name, options) {
        calls.push({ name, options });
        return {
          data: {
            state: 'eligible',
            is_welcome_audit: true,
            next_eligible_date: null,
            last_completed_at: null
          },
          error: null
        };
      }
    }
  };

  await loadAndRender({ supabase, elements, formatDate: value => `date:${value}` });

  assert.deepEqual(calls, [{
    name: 'pricing-audit-eligibility',
    options: { method: 'POST' }
  }]);
  assert.equal(elements.section.style.display, 'block');
  assert.equal(elements.cta.style.display, '');
  assert.equal(elements.gated.style.display, 'none');
  assert.equal(elements.last.textContent, '—');
  assert.equal(elements.next.textContent, 'Available now');
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test tests/js/pricing-audit.test.cjs`

Expected: FAIL because `js/pricing-audit.js` does not exist.

- [ ] **Step 3: Implement the minimal browser module**

Create `js/pricing-audit.js` with a browser global and CommonJS export so the same public API runs in the page and Node:

```js
// GhostCoach — Quarterly pricing-audit eligibility adapter.
(function exposePricingAudit(root, factory) {
  const api = factory();
  root.GCPricingAudit = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
}(typeof globalThis === 'object' ? globalThis : this, function createPricingAudit() {
  function reset(elements) {
    elements.section.style.display = 'none';
    elements.cta.style.display = 'none';
    elements.gated.style.display = 'none';
    elements.gated.textContent = '';
    elements.last.textContent = '—';
    elements.next.textContent = '—';
  }

  async function loadAndRender({ supabase, elements, formatDate }) {
    reset(elements);

    const { data, error } = await supabase.functions.invoke(
      'pricing-audit-eligibility',
      { method: 'POST' }
    );
    if (error) throw error;

    if (data.state === 'eligible') {
      elements.section.style.display = 'block';
      elements.cta.style.display = '';
      elements.last.textContent = data.last_completed_at
        ? formatDate(data.last_completed_at)
        : '—';
      elements.next.textContent = 'Available now';
    }
  }

  return { loadAndRender };
}));
```

- [ ] **Step 4: Run the test and verify GREEN**

Run: `node --test tests/js/pricing-audit.test.cjs`

Expected: 1 test passes.

- [ ] **Step 5: Commit the tracer bullet**

```powershell
git add -- js/pricing-audit.js tests/js/pricing-audit.test.cjs
git commit -m "Add pricing audit eligibility adapter"
```

### Task 2: Gated and Not-Entitled States

**Files:**
- Modify: `tests/js/pricing-audit.test.cjs`
- Modify: `js/pricing-audit.js`

- [ ] **Step 1: Add a reusable Supabase fake and failing state tests**

Refactor the first test to use this helper, then append the two tests:

```js
function supabaseResponse(result, calls = []) {
  return {
    calls,
    client: {
      functions: {
        async invoke(name, options) {
          calls.push({ name, options });
          return result;
        }
      }
    }
  };
}

test('gated response shows the server-provided next date and no CTA', async () => {
  const { loadAndRender } = require('../../js/pricing-audit.js');
  const elements = auditElements();
  const { client } = supabaseResponse({
    data: {
      state: 'gated',
      is_welcome_audit: false,
      next_eligible_date: '2026-10-10',
      last_completed_at: '2026-07-12T09:00:00.000Z'
    },
    error: null
  });

  await loadAndRender({ supabase: client, elements, formatDate: value => `date:${value}` });

  assert.equal(elements.section.style.display, 'block');
  assert.equal(elements.cta.style.display, 'none');
  assert.equal(elements.gated.style.display, 'block');
  assert.equal(elements.gated.textContent,
    'Your next pricing audit will be available on date:2026-10-10.');
  assert.equal(elements.last.textContent, 'date:2026-07-12T09:00:00.000Z');
  assert.equal(elements.next.textContent, 'date:2026-10-10');
});

test('not-entitled response keeps the whole audit section hidden', async () => {
  const { loadAndRender } = require('../../js/pricing-audit.js');
  const elements = auditElements();
  const { client } = supabaseResponse({
    data: {
      state: 'not_entitled',
      is_welcome_audit: false,
      next_eligible_date: null,
      last_completed_at: '2026-07-12T09:00:00.000Z'
    },
    error: null
  });

  await loadAndRender({ supabase: client, elements, formatDate: value => `date:${value}` });

  assert.equal(elements.section.style.display, 'none');
  assert.equal(elements.cta.style.display, 'none');
  assert.equal(elements.gated.style.display, 'none');
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `node --test tests/js/pricing-audit.test.cjs`

Expected: the gated-state test fails because gated rendering is absent; the eligible tracer bullet still passes.

- [ ] **Step 3: Add minimal gated rendering**

Add after the eligible branch and return from each recognized branch:

```js
    if (data.state === 'eligible') {
      elements.section.style.display = 'block';
      elements.cta.style.display = '';
      elements.last.textContent = data.last_completed_at
        ? formatDate(data.last_completed_at)
        : '—';
      elements.next.textContent = 'Available now';
      return;
    }

    if (data.state === 'gated') {
      elements.section.style.display = 'block';
      elements.gated.style.display = 'block';
      elements.last.textContent = data.last_completed_at
        ? formatDate(data.last_completed_at)
        : '—';
      elements.next.textContent = formatDate(data.next_eligible_date);
      elements.gated.textContent = 'Your next pricing audit will be available on '
        + formatDate(data.next_eligible_date) + '.';
    }
```

`not_entitled` needs no additional rendering because `reset` is already fail-closed.

- [ ] **Step 4: Run the tests and verify GREEN**

Run: `node --test tests/js/pricing-audit.test.cjs`

Expected: 3 tests pass.

- [ ] **Step 5: Commit state rendering**

```powershell
git add -- js/pricing-audit.js tests/js/pricing-audit.test.cjs
git commit -m "Render pricing audit eligibility states"
```

### Task 3: Loading, Error, and Contract Validation

**Files:**
- Modify: `tests/js/pricing-audit.test.cjs`
- Modify: `js/pricing-audit.js`

- [ ] **Step 1: Write failing fail-closed tests**

Append tests for in-flight loading, invocation errors, and malformed success data:

```js
test('the audit section stays hidden while eligibility is loading', async () => {
  const { loadAndRender } = require('../../js/pricing-audit.js');
  const elements = auditElements();
  elements.section.style.display = 'block';
  elements.cta.style.display = '';
  let resolveInvoke;
  const invoked = new Promise(resolve => { resolveInvoke = resolve; });
  const supabase = { functions: { invoke: () => invoked } };

  const rendering = loadAndRender({ supabase, elements, formatDate: String });

  assert.equal(elements.section.style.display, 'none');
  assert.equal(elements.cta.style.display, 'none');
  resolveInvoke({
    data: {
      state: 'not_entitled',
      is_welcome_audit: false,
      next_eligible_date: null,
      last_completed_at: null
    },
    error: null
  });
  await rendering;
});

test('an invocation error keeps the section hidden without rejecting', async () => {
  const { loadAndRender } = require('../../js/pricing-audit.js');
  const elements = auditElements();
  const { client } = supabaseResponse({ data: null, error: new Error('offline') });

  await loadAndRender({ supabase: client, elements, formatDate: String });

  assert.equal(elements.section.style.display, 'none');
  assert.equal(elements.cta.style.display, 'none');
});

test('a malformed eligibility response keeps the section hidden', async () => {
  const { loadAndRender } = require('../../js/pricing-audit.js');
  const elements = auditElements();
  const { client } = supabaseResponse({
    data: {
      state: 'gated',
      is_welcome_audit: false,
      next_eligible_date: null,
      last_completed_at: null
    },
    error: null
  });

  await loadAndRender({ supabase: client, elements, formatDate: String });

  assert.equal(elements.section.style.display, 'none');
  assert.equal(elements.gated.style.display, 'none');
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `node --test tests/js/pricing-audit.test.cjs`

Expected: the invocation-error test rejects and the malformed gated response is rendered.

- [ ] **Step 3: Validate the contract and contain failures**

Add these helpers and replace the invocation body of `loadAndRender`:

```js
  function isOptionalString(value) {
    return value === null || typeof value === 'string';
  }

  function isEligibility(value) {
    if (!value || typeof value !== 'object') return false;
    if (!['eligible', 'gated', 'not_entitled'].includes(value.state)) return false;
    if (typeof value.is_welcome_audit !== 'boolean') return false;
    if (!isOptionalString(value.next_eligible_date)) return false;
    if (!isOptionalString(value.last_completed_at)) return false;
    if (value.state === 'gated' && !value.next_eligible_date) return false;
    return true;
  }

  async function loadAndRender({ supabase, elements, formatDate }) {
    reset(elements);

    try {
      const { data, error } = await supabase.functions.invoke(
        'pricing-audit-eligibility',
        { method: 'POST' }
      );
      if (error || !isEligibility(data)) return;

      if (data.state === 'eligible') {
        elements.section.style.display = 'block';
        elements.cta.style.display = '';
        elements.last.textContent = data.last_completed_at
          ? formatDate(data.last_completed_at)
          : '—';
        elements.next.textContent = 'Available now';
        return;
      }

      if (data.state === 'gated') {
        elements.section.style.display = 'block';
        elements.gated.style.display = 'block';
        elements.last.textContent = data.last_completed_at
          ? formatDate(data.last_completed_at)
          : '—';
        elements.next.textContent = formatDate(data.next_eligible_date);
        elements.gated.textContent = 'Your next pricing audit will be available on '
          + formatDate(data.next_eligible_date) + '.';
      }
    } catch (error) {
      console.warn('Pricing audit eligibility unavailable:', error?.message || error);
    }
  }
```

Do not rethrow; an unavailable eligibility read must remain hidden.

- [ ] **Step 4: Run the tests and verify GREEN**

Run: `node --test tests/js/pricing-audit.test.cjs`

Expected: 6 tests pass.

- [ ] **Step 5: Commit fail-closed handling**

```powershell
git add -- js/pricing-audit.js tests/js/pricing-audit.test.cjs
git commit -m "Fail closed on pricing audit read errors"
```

### Task 4: Account Page Wiring

**Files:**
- Modify: `account/index.html:480-486`
- Modify: `js/pages/account.js:474-546`

- [ ] **Step 1: Load the adapter before the account script**

Insert the adapter script immediately before `account.js`:

```html
  <script src="/js/pages/newsletter.js"></script>
  <script src="/js/pricing-audit.js"></script>
  <script src="/js/pages/account.js"></script>
```

- [ ] **Step 2: Replace the stub and local entitlement gate with wiring**

Replace the quarterly pricing-audit block in `account.js` with:

```js
  // ── 5b. Quarterly pricing audit ─────────────────────────────────────────────
  // The backend is authoritative for entitlement and cooldown timing. The
  // adapter keeps this section hidden until it receives a valid visible state.
  async function renderPricingAudit() {
    const section = document.getElementById('gc-audit-section');
    if (!section) return;

    await GCPricingAudit.loadAndRender({
      supabase: gcSupabase,
      formatDate: fmtDate,
      elements: {
        section,
        last: document.getElementById('gc-audit-last'),
        next: document.getElementById('gc-audit-next'),
        cta: document.getElementById('gc-audit-cta'),
        gated: document.getElementById('gc-audit-gated')
      }
    });
  }
  renderPricingAudit();
```

Update the two post-purchase calls from `renderPricingAudit('operator')` and `renderPricingAudit('lifetime')` to `renderPricingAudit()`. The server response, rather than a browser override, decides whether to reveal the section.

- [ ] **Step 3: Run syntax and adapter tests**

Run:

```powershell
node --check js/pricing-audit.js
node --check js/pages/account.js
node --test tests/js/pricing-audit.test.cjs
```

Expected: both syntax checks exit 0 and all 6 tests pass.

- [ ] **Step 4: Commit account integration**

```powershell
git add -- account/index.html js/pages/account.js
git commit -m "Wire account page to pricing audit eligibility"
```

### Task 5: Backend Type Cleanup

**Files:**
- Modify: `supabase/functions/pricing-audit-eligibility/handler.ts:1-75`
- Test: `tests/functions/pricing-audit-eligibility.test.ts`

- [ ] **Step 1: Establish the green characterization baseline**

Run: `node --experimental-strip-types --test tests/functions/pricing-audit-eligibility.test.ts`

Expected: all 15 tests pass before the refactor.

- [ ] **Step 2: Constrain domain values and name entitlement**

Replace the unrestricted plan/status fields and repeated expression with:

```ts
export type Plan = "builder" | "operator" | "lifetime";
export type UserStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "pending"
  | "deleted";

export interface EligibilityRecord {
  plan: Plan;
  status: UserStatus;
  trial_end: string | null;
  welcome_audit_used: boolean;
  last_audit_completed_at: string | null;
}
```

After computing `hasActiveOperatorTrial`, add:

```ts
      const isEntitled = hasActivePlan || hasActiveOperatorTrial;
```

Use `isEntitled` in the welcome, not-entitled, inconsistent-state, and returning-customer branches.

- [ ] **Step 3: Verify behavior and Deno types remain unchanged**

Run:

```powershell
node --experimental-strip-types --test tests/functions/pricing-audit-eligibility.test.ts
npx -y deno check supabase/functions/pricing-audit-eligibility/handler.ts
npx -y deno check supabase/functions/pricing-audit-eligibility/index.ts
```

Expected: 15 tests pass and both Deno checks exit 0.

- [ ] **Step 4: Commit the cleanup**

```powershell
git add -- supabase/functions/pricing-audit-eligibility/handler.ts
git commit -m "Clarify pricing audit entitlement types"
```

### Task 6: Checklist Accuracy and Full Verification

**Files:**
- Modify: `D:/PersonalFiles/GhostCoach/MILESTONE-1-CHECKLIST.md`

- [ ] **Step 1: Record the frontend contract and honest security status**

Mark frontend state handling complete:

```markdown
- [x] Specify frontend handling of descriptive states, not-entitled, loading, and request failures.
```

Replace the broad authentication verification item with two explicit items:

```markdown
- [x] Verify welcome, trial, Lifetime, cooldown, downgrade/resubscribe, unauthenticated,
  and cross-user behavior at the request-handler seam.
- [ ] Verify gateway JWT enforcement and caller-scoped RLS against an isolated Supabase runtime.
```

- [ ] **Step 2: Run the complete local regression suite**

Run:

```powershell
node --test tests/js/pricing-audit.test.cjs
node --experimental-strip-types --test tests/functions/pricing-audit-eligibility.test.ts
npx -y deno check supabase/functions/pricing-audit-eligibility/handler.ts
npx -y deno check supabase/functions/pricing-audit-eligibility/index.ts
& ./tests/migrations/run-quarterly-pricing-audit-foundation.ps1
git diff --check
git status --short --branch
```

Expected: 6 frontend tests pass, 15 Edge Function tests pass, both Deno checks exit 0, migration contract checks exit 0, no whitespace errors are reported, and the branch remains local and ahead of `origin/main`.

- [ ] **Step 3: Review the final diff against the approved spec**

Run:

```powershell
git diff 9be3f8f..HEAD -- account/index.html js/pages/account.js js/pricing-audit.js tests/js/pricing-audit.test.cjs supabase/functions/pricing-audit-eligibility/handler.ts
```

Confirm that no browser-side entitlement or 90-day calculation exists, no user ID is sent to the function, and all failure paths leave the section hidden.

- [ ] **Step 4: Leave deployment gates untouched**

Do not deploy the Edge Function, apply the migration, alter production Supabase state, push Git commits, or modify n8n workflows. Report the pending isolated JWT/RLS integration test as the remaining security gate.
