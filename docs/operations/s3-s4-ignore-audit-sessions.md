# S4 and S3 candidates: ignore audit sessions

Status: candidates only. Publishing S4 and S3 is a separate step that needs approval (#15).

## The change

Each candidate adds `is_pricing_audit=is.false` to exactly one `sessions` lookup and changes
nothing else. The column is `not null` with default `false`, so every existing row is kept and the
filter has no effect until an audit exists.

| Workflow | Node | Effect |
| --- | --- | --- |
| S4 Monday digest | `Fetch 3 Recent Sessions1` | The 3 most recent sessions are coaching sessions only, so an audit can't take a slot and show as "No summary". |
| S3 session end | `Fetch Previous Session` | The previous session used for goal-progress scoring is the last coaching session, never an audit. |

The filter goes in just before `&select=`. The owner filter, the other filters, the columns, the
order, the limit, the credential and the `apikey` are unchanged. The optional filter for abandoned
`pending` sessions is not part of this change.

The S3 transformer also checks the input and the candidate against the session-end repair from #4
(`validateS3Repair`). It refuses an S3 that doesn't have the repair, and fails if the candidate
loses it.

## Producing and reviewing the candidates

The transformer is `scripts/n8n/session-lookups-ignore-audits.mjs`. It is pure and offline, and
never calls n8n or any other service.

1. **Export the live workflows (read-only).** For each workflow, fetch it with the n8n public API:
   `GET /api/v1/workflows/<id>?excludePinnedData=true` with the `X-N8N-API-KEY` header. Find the
   IDs with `GET /api/v1/workflows`. Save the responses only to
   `%LOCALAPPDATA%\GhostCoach\private-backups\`. They contain live credentials and keys and never go
   into git or chat. Each response carries the published version (`activeVersion`) and any
   unpublished draft. The transformer uses only the published version.
2. **Print the safe report for each workflow:**

   ```powershell
   node scripts/n8n/session-lookups-ignore-audits.mjs --report s4 <private S4 snapshot>
   node scripts/n8n/session-lookups-ignore-audits.mjs --report s3 <private S3 snapshot>
   ```

   Expect `changedNodes` to hold only the lookup node, with empty `addedNodes`, `removedNodes`,
   `changedConnections` and `otherChanges`, and no `validationProblems`. A failed run prints only a
   generic message; inspect the input privately. The transformer refuses a snapshot whose lookup
   query, method or credential has changed, or that already has the filter.
3. **Write each candidate privately:**

   ```powershell
   node scripts/n8n/session-lookups-ignore-audits.mjs --emit-private-json s4 <private S4 snapshot> > <private-backups>\s4-ignore-audits-candidate-<date>.json
   ```

   Never print this output; it includes the live credentials and keys from the input.
4. **Review.** Compare each candidate with its snapshot's `activeVersion` key-order-insensitively.
   The only difference is the lookup URL, with the filter in front of `&select=`.

When publishing S3, keep the unrelated unpublished draft edits: start from the published version,
publish the candidate, then re-save the draft edits on top as a draft.

Tests: `node --test tests/n8n/session-lookups-ignore-audits.test.mjs`.
- **S4 fixture:** `tests/n8n/fixtures/s4-published.json` is a sanitized copy of the published
  workflow. Credentials, keys, node IDs, email content and code are replaced with placeholders.
- **S3 test input:** the published S3 is rebuilt in the tests by applying the #4 repair to the
  existing S3 fixture. Its lookup URL and connections match the live workflow.
