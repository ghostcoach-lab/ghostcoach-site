# S4 candidate: next pricing audit line in the Monday digest

Status: superseded by the separate S13 availability email (#32). This S4 candidate was never
published and must not be published. The remaining content is retained as the record of #26.

## Prerequisites

- S4 is published with the #9 filters (#19, #15). The transformer refuses any other S4.
- The Milestone 2 migration is in production (#16). It creates
  `pricing_audit_decide_eligibility`, which the candidate calls. It is `service_role` only. The new
  node uses the Supabase credential S4's other queries use, which reads every `users` row, so it
  should be the service role. The QA run below confirms it.

## The change

The Monday digest tells each customer when their next Pricing audit opens:

| Rule result | Line |
| --- | --- |
| `eligible` (Welcome audit not used, or the Cooldown is over) | "Your pricing audit is available now.", linked to `/account/audit/` |
| `gated`, `next_eligible_date` is the run's UTC date | "Your next pricing audit opens today." |
| `gated`, the next UTC date | "Your next pricing audit opens tomorrow." |
| `gated`, later | "Your next pricing audit opens in N days." |
| `not_entitled`, a failed call, or an unexpected response (including a `next_eligible_date` before the run's date) | No line; the digest still goes out |

- **One moment per run.** `p_now` and "today" come from the schedule trigger's `timestamp`
  (Monday 07:00 Amsterdam time, which is 05:00 UTC in summer and 06:00 UTC in winter). At that hour
  the Amsterdam date and the UTC date are the same. Days count in UTC dates, like the date on the
  account page.
- **"Opens today".** The Cooldown ends at the time of day of the last Completion, so on its last
  day the audit is usually still closed at 07:00.
- **Fixed text.** The line is never passed to the AI prompt. The wording is a proposal that the
  client may change.

Three changes to S4, and nothing else:

1. `Query Operator Users` also selects `plan, status, trial_end, welcome_audit_used,
   last_audit_completed_at`. The filters, the audience (active Operators) and the `apikey` are
   unchanged.
2. New node `Decide Audit Eligibility`, right after `Build Digest Email`. It POSTs the loop user's
   fields and the trigger time to `rpc/pricing_audit_decide_eligibility`. It continues on failure
   and always outputs an item, so a failed call never stops the digest.
3. New node `Add Next Audit Line`, after that and before `Send Digest via Resend`. It takes the
   email from `Build Digest Email` by name and inserts the line block into `email_payload.html`,
   just before the "Marcus — GhostCoach" sign-off. With no line, or no sign-off to anchor on, the
   email goes out unchanged.

Both new nodes come after `Build Digest Email`, so every existing node keeps the input it has today.

`Build Digest Email`, the digest prompt, its parsing, the `digests` record and every other node,
connection and setting stay byte-identical. The line is added in a new node, so the published code
never has to be matched or copied.

## Producing and reviewing the candidate

The transformer is `scripts/n8n/s4-next-audit-line.mjs`. It is pure and offline. Regenerate the
candidate from a fresh export on launch day, never from an older one.

1. **Export S4 (read-only)** as in `s3-s4-completed-sessions-only.md`, to
   `%LOCALAPPDATA%\GhostCoach\private-backups\`. The export contains live credentials and never
   goes into git or chat.
2. **Print the safe report:**

   ```powershell
   node scripts/n8n/s4-next-audit-line.mjs --report <private S4 snapshot>
   ```

   Check the report:
   - `addedNodes` is `Decide Audit Eligibility` and `Add Next Audit Line`.
   - `changedNodes` is `Query Operator Users`.
   - `changedConnections` is `Build Digest Email` and the two new nodes.
   - `otherChanges` and `validationProblems` are empty.

   The transformer refuses a snapshot:
   - without the #9 filters;
   - with a changed users query, trigger or digest chain;
   - that already has the new nodes.

   A failed run prints only a generic message.
3. **Write the candidate privately:**

   ```powershell
   node scripts/n8n/s4-next-audit-line.mjs --emit-private-json <private S4 snapshot> > <private-backups>\s4-next-audit-line-candidate-<date>.json
   ```

   Never print this output.
4. **Review.** Compare the candidate with the snapshot's `activeVersion`, ignoring key order.
   Only the three changes above differ.

## QA before launch (separate approval)

Running S4 by hand emails every active Operator, so the live check uses a temporary copy:

1. Create an **inactive** copy of the candidate whose users query also filters on one QA
   account's `id`. Give it a name that marks it as temporary.
2. Run it once by hand. Check the QA account's email for the line, and check that
   `Decide Audit Eligibility` returned a rule row. A 401 or 403 there means the credential is not
   the service role: stop, delete the copy, and do not publish.
3. Delete the copy, and confirm it is gone. Restore the QA account's state if it was changed for
   the test.

## Publishing (launch day, separate approval)

Use the n8n public API. Record the published `versionId` first, as the rollback target.

1. Re-fetch S4 and stop if the published or draft version changed since the export.
2. `PUT /api/v1/workflows/<id>?publishIfActive=false` with the candidate. This saves a draft; the
   published version is unchanged.
3. `POST /api/v1/workflows/<id>/publish` with the new draft's `versionId`.
4. Re-fetch, and compare the published version with the candidate, ignoring key order.
5. After the first scheduled Monday run, read that execution (read-only). For each customer,
   `Decide Audit Eligibility` returned a row or an error, and each email was sent.

**Rollback:** publish the recorded `versionId` from version history, or `PUT` the private export
and publish it. Then re-fetch and compare with the export.

## Tests

- `node --test tests/n8n/s4-next-audit-line.test.mjs` covers:
  - the four lines, and every case that gives no line;
  - the RPC arguments;
  - the node code, run in a sandbox;
  - the diff;
  - the refusals.
- `node --experimental-strip-types --test tests/functions/s4-next-audit-line-shared-rule.test.ts` covers:
  - the exact line for each shared eligibility case (`tests/fixtures/pricing-audit-eligibility-cases.json`, also
    pinned to the SQL rule);
  - the 07:00 Amsterdam day boundaries in summer and winter.
- The tests use the sanitized fixture `tests/n8n/fixtures/s4-published.json` with the #9 filters
  applied.
