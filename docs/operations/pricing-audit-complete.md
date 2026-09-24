# pricing-audit-complete

The Edge Function that records a **Completion** (spec #5, ticket #11, ADR 0002). It is
JWT-verified (`verify_jwt = true`). It reads Marcus's Verdict and Baseline out of the finished
conversation and records the audit through the `complete_pricing_audit` RPC. This page describes
the Completion path from ticket #11; the rest of the Completion contract in spec #5 is built in
#12 and #13, before the function is deployed.

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

Every failure body is `{ "reason": "<code>" }`; details go to the function logs only.

| Reason | HTTP | When |
| --- | --- | --- |
| `invalid_request` | 400 | Malformed body, bad UUID, bad intake, or a conversation that doesn't end with Marcus (405 for a method other than POST) |
| `unauthorized` | 401 | No user in the verified JWT. The gateway normally rejects these first. |
| `audit_too_long` | 413 | The transcript is over the cap |
| `extraction_incomplete` | 422 | No Verdict, or the Verdict or Baseline fails a rule below (including the RPC's own deadline re-check). Nothing is written. |
| `ai_unavailable` | 503 | The extraction call failed, timed out, was refused or returned no text |
| `internal_error` | 500 | Invalid configuration, or the RPC failed |

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

1. It locks the customer's `users` row and derives the Welcome audit flag as "Welcome audit not
   yet used".
2. It inserts the audit `sessions` row: `is_pricing_audit = true`, `processing_status = complete`,
   the transcript, the Audit intake and a null summary. The `session_number` comes from the
   existing numbering trigger.
3. It inserts the `pricing_audits` row with `completed_at = now()`.
4. It sets `last_audit_completed_at` and `welcome_audit_used = true`.

It never touches goal progress. The next eligible date comes from
`pricing_audit_next_eligible_date(timestamptz)`, the UTC calendar date 90 days later. That matches
the shared TypeScript eligibility rule. Only `service_role` can execute the RPC; `anon`,
`authenticated` and `PUBLIC` cannot. The migration also adds the nullable
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

An invalid value makes every call return `internal_error`. The log names the setting but not its
value.

## Tests

```powershell
node --experimental-strip-types --test tests/functions/pricing-audit-complete.test.ts tests/functions/pricing-audit-complete-config.test.ts
npx -y deno check supabase/functions/pricing-audit-complete/index.ts
& ./tests/migrations/run-quarterly-pricing-audit-foundation.ps1   # includes tests/migrations/pricing-audit-completion.sql
& ./tests/supabase/run-pricing-audit-runtime.ps1
```
