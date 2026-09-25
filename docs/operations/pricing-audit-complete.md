# pricing-audit-complete

The Edge Function that records a **Completion** (spec #5, tickets #11 and #12, ADR 0002). It is
JWT-verified (`verify_jwt = true`). It reads Marcus's Verdict and Baseline out of the finished
conversation and records the audit through the `complete_pricing_audit` RPC. It then asks S12
to send the recap email (#13, see [pricing-audit-recap.md](pricing-audit-recap.md)).

## Order of checks

1. JWT (the gateway, then the handler).
2. Payload: UUID, intake, a conversation ending with Marcus's Verdict, and the transcript cap.
3. Idempotency, through `pricing_audit_session_state` with the service role:
   - the caller already has an audit for this `session_id`: `200` with `status: "already_completed"`
     and the saved Verdict and next eligible date, with nothing written;
   - the ID belongs to another customer's session or to a coaching session: `session_conflict`.
4. Entitlement and Cooldown pre-check, with the shared eligibility decision, so a refused customer
   costs no AI call.
5. Extraction, retried once if the result is invalid. "No Verdict" is not retried, because the
   page offers completion before Marcus gives his Verdict, so an early attempt costs one call.
6. `complete_pricing_audit`, which repeats steps 3 and 4 under the customer's row lock. Its answer
   is authoritative: a replay or a concurrent duplicate gets `already_completed`, and a plan that
   lapsed mid-audit gets `plan_lapsed`. Only `completed` writes anything.
7. Only after `completed`: the recap. The function reads the customer's email and first name from
   their own `users` and `profiles` rows and posts them to S12. It sets `recap_sent_at` with the
   service role only when S12 answers 2xx. A failure or timeout is logged and the customer still
   gets `200 completed`.

## Request and response

`POST` with the user's JWT and body `{ session_id, audit_intake, messages: [{ role, content }] }`.
The format is the same as the audit chat, except that `messages` is the whole visible conversation:
Marcus's opener first, alternating turns, and Marcus's Verdict last. The customer's ID comes only
from the JWT. The server derives the Welcome audit flag, the Verdict and the Baseline, and ignores
any versions in the body.

Success:

```json
{
  "status": "completed",
  "audit_id": "…",
  "is_welcome_audit": true,
  "verdict": { "action": "raise", "number": "59 per month", "deadline": "2026-11-01", "reasoning": "…" },
  "next_eligible_date": "2026-12-23"
}
```

A replay returns the same shape with `"status": "already_completed"` and the saved values.

Every failure body is `{ "reason": "<code>" }`, plus `next_eligible_date` for `gated`; details go to
the function logs only.

| Reason | HTTP | When |
| --- | --- | --- |
| `invalid_request` | 400 | Malformed body, bad UUID, bad intake, or a conversation that doesn't end with Marcus (405 for a method other than POST) |
| `unauthorized` | 401 | No user in the verified JWT. The gateway normally rejects these first. |
| `plan_lapsed` | 403 | Not Entitled, at the pre-check or at the RPC's re-check |
| `gated` | 403 | Inside the Cooldown, at the pre-check or at the RPC's re-check; includes `next_eligible_date` |
| `session_conflict` | 409 | The session ID belongs to another customer's session or to a coaching session |
| `audit_too_long` | 413 | The transcript is over the cap |
| `extraction_incomplete` | 422 | No Verdict (after one attempt), or the Verdict or Baseline still fails a rule below after two attempts (including the RPC's own deadline re-check). Nothing is written. |
| `ai_unavailable` | 503 | An extraction call failed, timed out, was refused or returned no text. Not retried here. |
| `internal_error` | 500 | Invalid configuration, a failed read, or anything unexpected from the RPCs |

## Extraction

One call to `claude-opus-5-5` at effort `low`, set explicitly. The output is constrained to one JSON
object through `output_config.format`; there is no tool call. The extraction prompt is in
`extraction.ts`. It is not the audit prompt and holds nothing secret. The request gives the
completion date in UTC so the model can resolve relative deadlines. The result is then checked in
code:

- `action` is `raise`, `hold` or `restructure`;
- `number` is non-blank for `raise` and `restructure`, and `null` for `hold`;
- `deadline` is a real calendar date after the completion date and at most one year later
  (from 29 February, the limit is 28 February);
- `reasoning` is non-blank;
- the Baseline has exactly `value_anchor`, `friction_read`, `mix` and `churn_window`, each
  non-blank.

Values are trimmed before they are stored. The RPC re-checks the deadline window against its own
completion date, since the handler's clock and the database's can fall on different days around
midnight UTC.

## Recording

`complete_pricing_audit` (migration `20260924170000_pricing_audit_completion.sql`) runs in one
transaction:

1. It locks the customer's `users` row. A concurrent duplicate waits here.
2. It returns `already_completed` with the saved audit, or `session_conflict`, from
   `pricing_audit_session_state`.
3. It re-checks Entitlement and the Cooldown with `pricing_audit_decide_eligibility`, and returns
   `plan_lapsed` or `gated` (with the next eligible date).
4. It re-checks the deadline window against its own completion date.
5. It inserts the audit `sessions` row: `is_pricing_audit = true`, `processing_status = complete`,
   the transcript, the Audit intake and a null summary. The `session_number` comes from the
   existing numbering trigger.
6. It inserts the `pricing_audits` row with `completed_at = now()`. The Welcome audit flag is
   "Welcome audit not yet used".
7. It sets `last_audit_completed_at` and `welcome_audit_used = true`, and returns `completed`.

Steps 2 and 3 return before anything is written. If another customer's Completion or a coaching
session takes the same ID between step 2 and step 5, the insert's unique violation also returns
`session_conflict`.

`pricing_audit_decide_eligibility` is the SQL copy of the shared TypeScript eligibility decision.
Both are tested against one table of cases, `tests/fixtures/pricing-audit-eligibility-cases.json`.

It never touches goal progress. The next eligible date comes from
`pricing_audit_next_eligible_date(timestamptz)`, the UTC calendar date 90 days later. That matches
the shared TypeScript eligibility rule. Only `service_role` can execute `complete_pricing_audit`,
`pricing_audit_session_state` and `pricing_audit_decide_eligibility`; `anon`, `authenticated` and
`PUBLIC` cannot. The migration also adds the nullable
`pricing_audits.recap_sent_at` column. The Milestone 1 compatibility functions are unchanged.

The transcript is stored in the existing `sessions.transcript` format, which labels the
customer's turns `Founder`: `Marcus: …` and `Founder: …` turns separated by a blank line.

## Configuration (Edge Function secrets)

| Secret | Default | Notes |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | none | Required. The same secret as the other functions. |
| `AUDIT_COMPLETE_MODEL` | `claude-opus-5-5` | |
| `AUDIT_COMPLETE_EFFORT` | `low` | `low`, `medium`, `high`, `xhigh` or `max` |
| `AUDIT_COMPLETE_MAX_TOKENS` | `16000` | Covers thinking and the JSON result. |
| `AUDIT_COMPLETE_TIMEOUT_MS` | `60000` | Per attempt. The SDK retries once. |
| `AUDIT_COMPLETE_MAX_TRANSCRIPT_CHARS` | `140000` | Above the chat cap, since it includes Marcus's closing Verdict. |
| `S12_RECAP_URL` | none | The S12 webhook URL, `https` only. Set it together with the secret. |
| `S12_RECAP_SECRET` | none | S12's own server-only secret, sent as `Authorization: Bearer …`. |
| `S12_RECAP_TIMEOUT_MS` | `10000` | How long a Completion waits for S12. |

If neither recap setting is set, each Completion logs "S12 is not configured" and sends no recap.
If only one is set, or the URL isn't `https`, the configuration is invalid.

An invalid value makes every call return `internal_error`. The log names the setting but not its
value.

## Tests

```powershell
node --experimental-strip-types --test tests/functions/pricing-audit-complete.test.ts tests/functions/pricing-audit-complete-config.test.ts
node --test tests/n8n/s12-pricing-audit-recap.test.mjs
npx -y deno check supabase/functions/pricing-audit-complete/index.ts
& ./tests/migrations/run-quarterly-pricing-audit-foundation.ps1   # includes tests/migrations/pricing-audit-completion.sql
& ./tests/supabase/run-pricing-audit-runtime.ps1
```
