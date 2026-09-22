# S3 repair publication review — 2026-09-23

Status: implemented and locally verified on branch `fix/s3-session-repair`.
Production publication and live regression QA are pending. Milestone 1 remains 8/10.

## Reviewable changes

- Validate UUID-shaped session/owner IDs and a nonblank transcript; accept normal sessions only.
- Replace the insert with a conditional PATCH of the existing owned, normal, pending
  session whose transcript is empty or null. Store only the transcript.
- Verify every returned row at both write boundaries. Empty/multiple/mismatched rows
  throw before later processing. n8n split-item and array response shapes are covered.
- Keep the original ID through scoring, summary, profile update, and recap.
- Scope final persistence by original ID, owner, normal type and pending status.
  Preserve creation time, retry count, and audit metadata.
- Add a stable per-session Resend idempotency header.
- Add one completion-validation node (19 published nodes become 20).

Changed existing nodes: Parse Session Payload, INSERT session (renamed to CLAIM existing
session transcript), Extract Session ID (renamed to Validate Claimed Session), UPDATE
session (summary + score), and Send Recap via Resend. Fetch Profile, Build Anthropic
Requests and Fetch Previous Session change only references to the renamed validator.
New node: Validate Completed Session.

AI prompts, scoring rules, credentials, profile update, webhook authentication/path,
recap content, recipient/sender mapping, and settings are preserved. The two changed
Supabase URLs now rely on the existing credential's API-key and Authorization headers;
their old embedded API-key query parameter is omitted.

## Evidence

38 tests passed: 8 repair unit/behavior tests, 4 real local PostgreSQL/PostgREST tests,
11 existing frontend tests, and 15 existing function tests.

The database integration used PostgreSQL 17 and PostgREST 16.2 in disposable local
containers. Eight concurrent requests produced exactly one successful claim and seven
empty responses rejected by the workflow validator. It also verified repeated requests,
wrong owner, unknown ID, audit/completed/already-claimed rows, null transcript, protected
metadata preservation, and retained transcript after a simulated downstream failure.

Commands:

```powershell
node --test tests/js/pricing-audit.test.cjs tests/n8n/s3-session-end-repair.test.mjs
npx --yes deno test --allow-env tests/functions/pricing-audit-eligibility.test.ts
node --test tests/n8n/s3-session-end.runtime.mjs
```

For the runtime test, start disposable containers on network `gc-s3-repair-20260923`:
PostgreSQL named `gc-s3-db-20260923`, database/user postgres, fixture password
`s3-local-only`; load `tests/n8n/s3-local-baseline.sql`. Run
`public.ecr.aws/supabase/postgrest:v16.2` with DB URI
`postgres://postgres:s3-local-only@gc-s3-db-20260923:5432/postgres`,
`PGRST_DB_ANON_ROLE=postgres`, `PGRST_DB_SCHEMAS=public`, and publish port
`127.0.0.1:55331:3000`. These credentials apply only to disposable local fixtures.
Stop both test containers and remove that test network after testing.

Code nodes were executed locally with n8n-shaped inputs; expressions were evaluated and
used for real local HTTP PATCH requests. This is not a complete n8n execution or live
provider test. The n8n MCP validator is unavailable; publication must be followed by one
controlled normal-session regression through n8n.

## Fresh source and private artifacts

n8n GET verified published version `7add89c0-5ae8-4d68-b669-ba3ad8a25338`
and saved draft `c730a7c8-2824-49f9-bcc8-f10cc2f6b6a2`.
Both still match the reviewed source. No separate session-retry workflow or S3 caller
was found among the 12 accessible workflow definitions. Reviewed frontend chat.js
creates the row and supplies both IDs.

Private files (contain existing credentials; never commit or paste):

- `C:/Users/user/AppData/Local/GhostCoach/private-backups/s3-before-repair-20260923.json`
- `C:/Users/user/AppData/Local/GhostCoach/private-backups/s3-repair-candidate-20260923.json`

Candidate generation selects only `activeVersion`. A separate test proves unpublished
recap changes are excluded. The default preparation command emits only a redacted report:

```powershell
node scripts/n8n/s3-session-end-repair.mjs --report C:/Users/user/AppData/Local/GhostCoach/private-backups/s3-before-repair-20260923.json
```

`--emit-private-json` is for private in-memory capture only. It must never be sent to
normal terminal output, Git, or a public artifact. This preparation used apply_patch to
save the captured candidate at the private path above.

## Publication, rollback and recovery

1. Re-fetch and compare both versions and the candidate before any production mutation.
2. Preserve the unrelated draft and save/publish only the reviewed repair candidate.
3. Re-fetch the active version and compare nodes/connections/settings to the candidate.
4. Reapply only the unrelated recap draft changes over the repaired version; save as an
   unpublished draft. Verify the active version remains the repair.
5. Run one approved controlled normal-session test without trials, cards, or billing.
   Verify the original ID completes, count increases once, recap delivery, and exact cleanup.
6. If regression fails, preserve execution evidence, inspect side effects, and publish
   the backed-up prior active version through n8n version history. Re-fetch to confirm.
   Workflow rollback does not undo database writes or accepted emails.

A claimed failure retains its transcript. Do not reset that transcript or blindly retry
the whole execution. Determine the last successful node and the provider message ID.
If Resend accepted the message, inspect its delivery status before any resend. Its
idempotency retention is 24 hours; an expired key does not protect a later manual resend.
Inspect persisted score/profile effects before restarting processing.

Owner filtering does not replace authenticated caller identity. The existing public
frontend webhook secret is unchanged; this repair makes no new authentication claim.

References:
[Supabase credential headers](https://github.com/n8n-io/n8n/blob/master/packages/nodes-base/credentials/SupabaseApi.credentials.ts),
[n8n error response behavior](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.respondtowebhook),
[Resend key retention](https://resend.com/changelog/idempotency-keys).
