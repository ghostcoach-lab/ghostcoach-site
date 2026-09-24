# S6 candidate: delete pricing audits before sessions

Status: candidate only. Publishing S6 is a separate step that needs approval (#15).

## The change

In S6 (Plan Change / Account Deletion), `GDPR — Prep Supabase Delete` feeds three deletes that
run side by side: profiles, sessions and subscriptions. A completed audit protects its session
(ADR 0001), so for a customer with an audit the `DELETE sessions` step is refused and account
deletion stops partway.

The candidate adds one node, `DELETE pricing_audits`, between the prep step and `DELETE sessions`:

```
GDPR — Prep Supabase Delete → DELETE pricing_audits → DELETE sessions → Prep Auth Delete
```

- It is a copy of `DELETE sessions` with only the table changed. It uses the same user ID
  expression (`user_id=eq.` + the prep step's `user_id`), credential, options and error handling
  (no `onError`, `continueOnFail` or retry settings, so any failure stops the workflow).
- It sets `alwaysOutputData`. When the customer has no audits, the delete still hands one item on
  and `DELETE sessions` still runs.
- S6 uses `executionOrder: v1`, which runs the prep step's branches one at a time, top of the
  canvas first. The new node sits between the profiles and subscriptions deletes on the canvas,
  so the branches keep their order: profiles, then audits and sessions, then subscriptions.
- No other node, connection or setting changes. The profiles and subscriptions deletes, the auth
  user delete and the compliance log are untouched.

## Producing and reviewing the candidate

The transformer is `scripts/n8n/s6-account-deletion-audits.mjs`. It is pure and offline, and
never calls n8n or any other service.

1. **Export the live workflow (read-only).** Fetch S6 with the n8n public API:
   `GET /api/v1/workflows/<S6 id>?excludePinnedData=true` with the `X-N8N-API-KEY` header. Find
   the ID with `GET /api/v1/workflows`. Save the response only to
   `%LOCALAPPDATA%\GhostCoach\private-backups\`. It contains live credentials and keys and never
   goes into git or chat. The response carries both the published version (`activeVersion`) and
   any unpublished draft. The transformer uses only the published version.
2. **Print the safe report:**

   ```powershell
   node scripts/n8n/s6-account-deletion-audits.mjs --report <private snapshot>
   ```

   Expect `addedNodes: ["DELETE pricing_audits"]`, `changedConnections` for the prep step and the
   new node only, empty `removedNodes`, `changedNodes` and `otherChanges`, and no
   `validationProblems`. A failed run prints only a generic message; inspect the input privately.
   The transformer refuses a snapshot that no longer has the expected shape (for example a
   changed sessions delete, extra connections into it, or an existing audit delete).
3. **Write the candidate privately:**

   ```powershell
   node scripts/n8n/s6-account-deletion-audits.mjs --emit-private-json <private snapshot> > <private-backups>\s6-audit-delete-candidate-<date>.json
   ```

   Never print this output; it includes the live credentials and keys from the input.
4. **Review.** Compare candidate and snapshot `activeVersion` key-order-insensitively: the only
   differences are the new node and the two connection entries in the report.

Tests: `node --test tests/n8n/s6-account-deletion-audits.test.mjs`. The fixture
`tests/n8n/fixtures/s6-published.json` is a sanitized copy of the published workflow: credentials,
keys, node and webhook IDs, email content and unrelated code are replaced with placeholders.
