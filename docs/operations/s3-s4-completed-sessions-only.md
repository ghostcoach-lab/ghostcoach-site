# S4 and S3 candidates: completed coaching sessions only

Status: candidates only. Publishing S4 and S3 is a separate step that needs approval (#15).

## The change

Each candidate adds two filters to exactly one `sessions` lookup and changes nothing else:

- `is_pricing_audit=is.false` skips audit sessions. The column is `not null` with default
  `false`, so this filter has no effect until an audit exists.
- `processing_status=eq.complete` skips chats that were opened and never finished. The chat page
  creates a `pending` row on page load, and S3 sets `complete` when a session ends. This filter
  takes effect at once: abandoned `pending` rows stop showing in the digest and in goal-progress
  scoring. Added at the client's request (paid addition).

| Workflow | Node | Effect |
| --- | --- | --- |
| S4 Monday digest | `Fetch 3 Recent Sessions1` | The 3 most recent sessions are finished coaching sessions only, so an audit or an abandoned chat can't take a slot and show as "No summary". |
| S3 session end | `Fetch Previous Session` | The previous session used for goal-progress scoring is the last finished coaching session, never an audit or an abandoned chat. |

The filters go in just before `&select=`. The owner filter, the other filters, the columns, the
order, the limit, the credential and the `apikey` are unchanged.

Publish one candidate per workflow, with both filters at once. The transformer refuses a lookup
that already has either filter, so it can't add the second filter to a workflow that was
published with only the first.

The S3 transformer also checks the input and the candidate against the session-end repair from #4
(`validateS3Repair`). It refuses an S3 that doesn't have the repair, and fails if the candidate
loses it.

## Producing and reviewing the candidates

The transformer is `scripts/n8n/session-lookups-completed-only.mjs`. It is pure and offline, and
never calls n8n or any other service.

1. **Export the live workflows (read-only).** For each workflow, fetch it with the n8n public API:
   `GET /api/v1/workflows/<id>?excludePinnedData=true` with the `X-N8N-API-KEY` header. Find the
   IDs with `GET /api/v1/workflows`. Save the responses only to
   `%LOCALAPPDATA%\GhostCoach\private-backups\`. They contain live credentials and keys and never go
   into git or chat. Each response carries the published version (`activeVersion`) and any
   unpublished draft. The transformer uses only the published version.
2. **Print the safe report for each workflow:**

   ```powershell
   node scripts/n8n/session-lookups-completed-only.mjs --report s4 <private S4 snapshot>
   node scripts/n8n/session-lookups-completed-only.mjs --report s3 <private S3 snapshot>
   ```

   Expect `changedNodes` to hold only the lookup node, with empty `addedNodes`, `removedNodes`,
   `changedConnections` and `otherChanges`, and no `validationProblems`. A failed run prints only a
   generic message; inspect the input privately. The transformer refuses a snapshot whose lookup
   query, method or credential has changed, or that already has either filter.
3. **Write each candidate privately:**

   ```powershell
   node scripts/n8n/session-lookups-completed-only.mjs --emit-private-json s4 <private S4 snapshot> > <private-backups>\s4-completed-only-candidate-<date>.json
   ```

   Never print this output; it includes the live credentials and keys from the input.
4. **Review.** Compare each candidate with its snapshot's `activeVersion` key-order-insensitively.
   The only difference is the lookup URL, with the two filters in front of `&select=`.

When publishing S3, keep the unrelated unpublished draft edits: start from the published version,
publish the candidate, then re-save the draft edits on top as a draft.

Tests: `node --test tests/n8n/session-lookups-completed-only.test.mjs`.
- **S4 fixture:** `tests/n8n/fixtures/s4-published.json` is a sanitized copy of the published
  workflow. Credentials, keys, node IDs, email content and code are replaced with placeholders.
- **S3 test input:** the published S3 is rebuilt in the tests by applying the #4 repair to the
  existing S3 fixture. Its lookup URL and connections match the live workflow.
