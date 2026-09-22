# S3 Session-ID Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prepare, validate, publish, and regression-test an S3 workflow repair that completes the frontend's existing session row and prevents duplicate processing and recap sends.

**Architecture:** A pure local JavaScript transformer builds a candidate from the published S3 version and refuses unexpected workflow shapes. It changes the initial INSERT into an atomic owner-scoped claim PATCH, validates both persistence boundaries, and adds a stable Resend idempotency key. Deployment is a separate guarded stage: preserve the unrelated draft, publish only the reviewed repair, then rebase and restore the draft without publishing it.

**Tech Stack:** Node.js `node:test`, n8n 2.39 workflow JSON, Supabase PostgREST, Resend HTTP API.

---

### Task 1: Add structural regression tests

**Files:**
- Create: `tests/n8n/s3-session-end-repair.test.mjs`
- Create: `tests/n8n/fixtures/s3-published-minimal.json`

- [ ] **Step 1: Create a sanitized minimal fixture**

Include the published node IDs, names, connections, and the relevant parameters for:
`Parse Session Payload`, `INSERT session (transcript first)`, `Extract Session ID`,
`UPDATE session (summary + score)`, `UPDATE profiles.goal_progress`, `Build Recap Email`,
and `Send Recap via Resend`. Replace credential IDs, JWTs, API keys, URLs containing
secrets, and email HTML with inert fixture values. Include an unrelated `Build Recap Email`
node so preservation can be asserted.

- [ ] **Step 2: Write failing tests for the repair contract**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { repairS3Workflow, validateS3Repair } from '../../scripts/n8n/s3-session-end-repair.mjs';

const fixtureUrl = new URL('./fixtures/s3-published-minimal.json', import.meta.url);
const loadFixture = async () => JSON.parse(await readFile(fixtureUrl, 'utf8'));

test('claims the existing owned normal session and keeps the original ID', async () => {
  const source = await loadFixture();
  const repaired = repairS3Workflow(source);
  const claim = repaired.nodes.find((node) => node.name === 'CLAIM existing session transcript');
  const extract = repaired.nodes.find((node) => node.name === 'Validate Claimed Session');
  assert.equal(claim.parameters.method, 'PATCH');
  assert.match(claim.parameters.url, /id=eq\./);
  assert.match(claim.parameters.url, /user_id=eq\./);
  assert.match(claim.parameters.url, /is_pricing_audit=is\.false/);
  assert.match(claim.parameters.url, /processing_status=eq\.pending/);
  assert.match(claim.parameters.url, /transcript=(?:is\.null|eq\.)/);
  assert.deepEqual(Object.keys(JSON.parse(claim.parameters.jsonBodyFixture)), ['transcript']);
  assert.match(extract.parameters.jsCode, /session\.id !== parsed\.session_id/);
});

test('guards completion by ID and owner before profile and email side effects', async () => {
  const repaired = repairS3Workflow(await loadFixture());
  const update = repaired.nodes.find((node) => node.name === 'UPDATE session (summary + score)');
  const validate = repaired.nodes.find((node) => node.name === 'Validate Completed Session');
  assert.match(update.parameters.url, /id=eq\./);
  assert.match(update.parameters.url, /user_id=eq\./);
  assert.equal(validate.type, 'n8n-nodes-base.code');
  assert.deepEqual(repaired.connections['UPDATE session (summary + score)'].main[0][0].node, 'Validate Completed Session');
  assert.deepEqual(repaired.connections['Validate Completed Session'].main[0][0].node, 'UPDATE profiles.goal_progress');
});

test('adds stable Resend idempotency and preserves unrelated nodes', async () => {
  const source = await loadFixture();
  const repaired = repairS3Workflow(source);
  const before = source.nodes.find((node) => node.name === 'Build Recap Email');
  const after = repaired.nodes.find((node) => node.name === 'Build Recap Email');
  const resend = repaired.nodes.find((node) => node.name === 'Send Recap via Resend');
  assert.deepEqual(after, before);
  assert.ok(resend.parameters.headerParameters.parameters.some((header) =>
    header.name === 'Idempotency-Key' && header.value.includes('session_id')));
});

test('fails closed on an unexpected workflow shape', async () => {
  const source = await loadFixture();
  source.nodes = source.nodes.filter((node) => node.name !== 'Extract Session ID');
  assert.throws(() => repairS3Workflow(source), /expected exactly one Extract Session ID/);
});

test('candidate validator rejects INSERT and missing ownership guards', async () => {
  const source = await loadFixture();
  const problems = validateS3Repair(source);
  assert.ok(problems.some((problem) => problem.includes('POST/INSERT')));
  assert.ok(problems.some((problem) => problem.includes('owner')));
});
```

- [ ] **Step 3: Run the test and verify the red state**

Run: `node --test tests/n8n/s3-session-end-repair.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `scripts/n8n/s3-session-end-repair.mjs`.

- [ ] **Step 4: Commit the test fixture and red tests**

```powershell
git add tests/n8n/s3-session-end-repair.test.mjs tests/n8n/fixtures/s3-published-minimal.json
git commit -m "test: specify S3 session ID repair"
```

### Task 2: Implement the pure workflow transformer

**Files:**
- Create: `scripts/n8n/s3-session-end-repair.mjs`
- Test: `tests/n8n/s3-session-end-repair.test.mjs`

- [ ] **Step 1: Implement strict node lookup and defensive cloning**

```js
const REQUIRED = [
  'Parse Session Payload',
  'INSERT session (transcript first)',
  'Extract Session ID',
  'UPDATE session (summary + score)',
  'UPDATE profiles.goal_progress',
  'Send Recap via Resend',
];

const clone = (value) => structuredClone(value);

function onlyNode(workflow, name) {
  const matches = workflow.nodes.filter((node) => node.name === name);
  if (matches.length !== 1) throw new Error(`expected exactly one ${name}; found ${matches.length}`);
  return matches[0];
}
```

- [ ] **Step 2: Implement payload validation and the atomic claim**

Set `Parse Session Payload.parameters.jsCode` to return `session_id`, `user_id`,
`transcript`, and `is_pricing_audit` only after matching both IDs against a UUID regex,
requiring a nonblank transcript, and requiring `is_pricing_audit !== true`.

Rename the INSERT node to `CLAIM existing session transcript`; set `method: 'PATCH'`,
`alwaysOutputData: true`, header `Prefer: return=representation`, and use this URL expression:

```js
={{ `${$vars.SUPABASE_URL}/rest/v1/sessions?id=eq.${encodeURIComponent($json.session_id)}&user_id=eq.${encodeURIComponent($json.user_id)}&is_pricing_audit=is.false&processing_status=eq.pending&or=(transcript.is.null,transcript.eq.)&select=id,user_id,is_pricing_audit,processing_status,transcript` }}
```

Use this body expression in the real workflow:

```js
={{ JSON.stringify({ transcript: $json.transcript }) }}
```

The sanitized fixture additionally carries `jsonBodyFixture: '{"transcript":"fixture"}'`
for secret-free structural assertions; remove that fixture-only property when transforming
a real workflow.

- [ ] **Step 3: Validate exactly one claimed row**

Rename `Extract Session ID` to `Validate Claimed Session` and set its Code node to:

```js
const response = $input.first().json;
const rows = Array.isArray(response) ? response : (response?.id ? [response] : []);
const parsed = $('Parse Session Payload').first().json;
if (rows.length !== 1) throw new Error(`S3: claim expected 1 row; received ${rows.length}`);
const session = rows[0];
if (session.id !== parsed.session_id || session.user_id !== parsed.user_id) {
  throw new Error('S3: claimed session identity mismatch');
}
if (session.is_pricing_audit === true) throw new Error('S3: audit session reached normal-session workflow');
return [{ json: { session_id: session.id, user_id: session.user_id, transcript: parsed.transcript, is_pricing_audit: false } }];
```

Update every node expression and connection that references `Extract Session ID` to use
`Validate Claimed Session`. The transformer must count replacements and throw unless the
expected references are found.

- [ ] **Step 4: Guard the final persistence boundary**

Add `Prefer: return=representation` to `UPDATE session (summary + score)` and add the
owner filter using the original parsed owner. Preserve its body fields. Insert a Code node
named `Validate Completed Session` with a fixed UUIDv4 ID, `typeVersion: 2`, and:

```js
const response = $input.first().json;
const rows = Array.isArray(response) ? response : (response?.id ? [response] : []);
const parsed = $('Parse Session Payload').first().json;
if (rows.length !== 1) throw new Error(`S3: completion expected 1 row; received ${rows.length}`);
if (rows[0].id !== parsed.session_id || rows[0].user_id !== parsed.user_id) {
  throw new Error('S3: completed session identity mismatch');
}
return [{ json: rows[0] }];
```

Rewire only this edge:

```text
UPDATE session (summary + score) -> Validate Completed Session -> UPDATE profiles.goal_progress
```

- [ ] **Step 5: Add Resend idempotency and candidate validation**

Append this header to `Send Recap via Resend` unless it already exists:

```js
{ "name": "Idempotency-Key", "value": "={{ `ghostcoach/session-recap/${$('Parse Session Payload').first().json.session_id}` }}" }
```

Export `validateS3Repair(workflow)` returning problems for: POST claim, missing ID/owner/
normal/pending/empty-transcript filters, non-transcript claim body, missing row validators,
wrong completion edge, missing completion ownership guard, missing idempotency key, or any
residual `Extract Session ID` connection/reference. `repairS3Workflow` must call it and
throw if any problem remains.

- [ ] **Step 6: Run the focused tests**

Run: `node --test tests/n8n/s3-session-end-repair.test.mjs`

Expected: 5 tests pass, 0 fail.

- [ ] **Step 7: Commit the transformer**

```powershell
git add scripts/n8n/s3-session-end-repair.mjs tests/n8n/s3-session-end-repair.test.mjs
git commit -m "fix: prepare owner-scoped S3 session repair"
```

### Task 3: Prepare and inspect the real candidate locally

**Files:**
- Modify: `scripts/n8n/s3-session-end-repair.mjs`
- Create outside repository: `C:/Users/user/AppData/Local/GhostCoach/private-backups/s3-repair-candidate-20260922.json`

- [ ] **Step 1: Add a prepare-only CLI**

When invoked with `--prepare <input> <output>`, read the private backup, select
`workflow.activeVersion` (or the root object when already a version), call
`repairS3Workflow`, and write the candidate with restrictive normal user permissions.
Refuse an output path inside the Git repository. Print only version IDs, node names changed,
and validation counts; never print node parameters, credentials, URLs, or payloads.

- [ ] **Step 2: Add a fixture test for prepare-only behavior**

Use a temporary directory under `node:os.tmpdir()` and assert the command writes a valid
candidate while stdout contains no strings matching JWT (`eyJ...`) or Resend-key (`re_...`)
patterns.

- [ ] **Step 3: Run the full local n8n test folder**

Run: `node --test tests/n8n/*.test.mjs`

Expected: all tests pass, 0 fail.

- [ ] **Step 4: Generate the private candidate**

```powershell
node scripts/n8n/s3-session-end-repair.mjs --prepare `
  'C:/Users/user/AppData/Local/GhostCoach/private-backups/s3-before-repair-20260922.json' `
  'C:/Users/user/AppData/Local/GhostCoach/private-backups/s3-repair-candidate-20260922.json'
```

Expected: validation count 0; changed-node allowlist contains only payload parsing, claim,
claim validation, completion update/validation, references to the renamed validation node,
and Resend headers. `Build Recap Email` must be byte-for-byte equal to the published version.

- [ ] **Step 5: Run repository regression tests**

```powershell
node --test tests/js/pricing-audit.test.cjs tests/n8n/*.test.mjs
deno test --allow-env supabase/functions/pricing-audit-eligibility/handler.ts tests/functions/pricing-audit-eligibility.test.ts
```

Expected: all tests pass. If Deno is unavailable, record that exact limitation and run the
existing project's documented function-test command instead; do not report an unrun suite.

- [ ] **Step 6: Commit the prepare-only CLI and tests**

```powershell
git add scripts/n8n/s3-session-end-repair.mjs tests/n8n/s3-session-end-repair.test.mjs
git commit -m "test: validate private S3 repair candidate"
```

### Task 4: Review the candidate before production mutation

**Files:**
- Modify: `docs/operations/pricing-audit-deployment.md`
- Read only: the private source backup and private candidate

- [ ] **Step 1: Re-fetch S3 and perform a stale-version check**

Using `N8N_API_KEY` only as an environment variable, GET workflow
`2YRHQrgmf93sWSdt`. Stop if activeVersionId differs from
`7add89c0-5ae8-4d68-b669-ba3ad8a25338` or saved version differs from the reviewed draft
unless the newer versions are fetched, backed up, diffed, and the plan updated.

- [ ] **Step 2: Review a redacted structural diff**

Compare node IDs/names/types, connections, settings, and parameter hashes. Permit only the
allowlisted repair changes. Verify credentials, workflow settings, webhook path, AI prompts,
recap body, sender, recipient mapping, profile update, and all pricing-audit fields are
unchanged. Do not print secret-bearing values.

- [ ] **Step 3: Document rollback and recovery commands**

Add an S3 section to the operations runbook recording: version IDs, private backup path,
candidate path, publish verification, rollback to the prior published version through n8n
version history, and the rule to inspect execution plus Resend status before replaying a
claimed failure.

- [ ] **Step 4: Stop for explicit publication approval**

Report local test results and the exact redacted change allowlist. Do not save or publish
the candidate in n8n until the user explicitly approves that production mutation.

### Task 5: Publish only the reviewed repair

**Files:**
- Production mutation: n8n workflow `2YRHQrgmf93sWSdt`
- Private backup: `C:/Users/user/AppData/Local/GhostCoach/private-backups/s3-before-repair-20260922.json`

- [ ] **Step 1: Preserve the unrelated draft as a separate private artifact**

Verify the saved draft's `Build Recap Email` change and metadata are present in the backup.
Record a hash of the draft nodes/connections. Do not publish the saved draft.

- [ ] **Step 2: Save the candidate as a new workflow version**

Use the n8n API/UI supported by version 2.39.6. Re-read the saved version immediately and
compare its redacted structure to the candidate. Stop if n8n normalizes anything beyond
known metadata or if validation reports an error.

- [ ] **Step 3: Publish the candidate version**

Use n8n's explicit Publish action, then GET the workflow and verify `activeVersionId` equals
the reviewed repair version. Do not infer publication from a successful save.

- [ ] **Step 4: Restore the unrelated changes as an unpublished rebased draft**

Apply only the backed-up recap-template changes over the repaired version, save, and do not
publish. Verify activeVersionId still points to the repair and the saved draft contains both
the repair and the intended recap draft changes.

- [ ] **Step 5: Verify production without sending a recap**

Re-fetch the active version and run `validateS3Repair`. Confirm the production webhook path
is registered. Do not execute the webhook during this structural verification.

### Task 6: Run controlled regression QA and close step 9

**Files:**
- Modify: `S3-QA-RESULTS-20260922.md`
- Modify: `MILESTONE-1-CHECKLIST.md`
- Create outside repository: private execution evidence with secrets and transcript removed

- [ ] **Step 1: Capture exact pre-test invariants**

Record total session/audit/subscription counts and hashes of all non-QA rows. Confirm both QA
accounts have no trial dates, Stripe IDs, subscription rows, or cards. Temporarily grant only
the minimum application entitlement needed for the normal-session path.

- [ ] **Step 2: Execute one normal coaching session**

Create one pending session through the authenticated frontend contract, collect a short QA
conversation, and submit exactly one S3 webhook request with its ID. Do not start a trial,
invoke Stripe, or use the pricing-audit route.

- [ ] **Step 3: Verify the same-ID contract and side effects**

Assert the original ID becomes complete, no second session appears, the completion-page
query retrieves its summary/action, profile score changes once, audit fields remain null,
and S3 has exactly one successful execution. Retrieve Resend status by returned message ID
and ask the user to confirm inbox or spam placement.

- [ ] **Step 4: Verify retry suppression without sending again**

Re-submit the identical webhook only if the published failure branch is confirmed to stop
before Resend. Verify it claims zero rows, produces no AI/profile/email side effects, and
does not return a false `{\"ok\":true}`. If that behavior cannot be proven without risking
a second email, stop and use execution-level dry evidence instead.

- [ ] **Step 5: Perform guarded cleanup**

Delete only the exact QA session row created for this test, restore the QA profile score and
entitlement, sign out the QA auth session, and verify pre-test counts/hashes. Keep the two
user-owned confirmed accounts.

- [ ] **Step 6: Update milestone evidence**

Record execution ID, session ID, Resend status, inbox result, cleanup verification, and any
limitations. Mark step 9 complete only when every same-ID/no-duplicate/no-billing invariant
passes. Leave step 10 open for final closeout.

- [ ] **Step 7: Commit repository evidence and runbook updates**

```powershell
git add docs/operations/pricing-audit-deployment.md S3-QA-RESULTS-20260922.md MILESTONE-1-CHECKLIST.md
git commit -m "docs: record S3 regression acceptance"
```

## Self-review result

- Spec coverage: payload validation, owner-scoped claim, duplicate prevention, final-write
  validation, Resend idempotency, failure recovery, draft preservation, controlled QA, and
  milestone status each map to an explicit task.
- Placeholder scan: no unspecified implementation placeholders remain.
- Type consistency: workflow/node names, version IDs, file paths, and validation function
  names are consistent across tasks.

