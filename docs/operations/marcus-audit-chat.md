# marcus-audit-chat

The Edge Function that runs the Pricing audit conversation (spec #5, ticket #10, ADR 0003). It is
separate from the live `marcus-chat` function, which it does not touch. It is JWT-verified
(`verify_jwt = true`), reads through the caller-scoped client so RLS applies, and writes nothing.

## Request and response

`POST` with the user's JWT and body `{ session_id, audit_intake, messages: [{ role, content }] }`.

- `session_id`: a UUID the page generates. It must not belong to one of the caller's sessions.
  The caller-scoped read can't see other users' sessions; the completion function re-checks the
  ID against every session.
- `audit_intake`: exactly `mrr`, `customer_count` (a whole number) and `churn_rate`, all
  non-negative numbers, plus `current_pricing` and `last_pricing_change`, non-blank text of up to
  2000 characters each.
- `messages`: the visible turns only. Empty for the opener. Otherwise Marcus's opener first, then
  alternating turns ending with the customer's. The server puts a fixed opening user turn in front.

Success is `200 { "reply": "..." }`. Every failure body is `{ "reason": "<code>" }`, plus
`next_eligible_date` for `gated`. Details go to the function logs only; the audit prompt is never
logged.

| Reason | HTTP | When |
| --- | --- | --- |
| `invalid_request` | 400 | Malformed body, bad UUID, bad intake or bad message sequence (405 for a method other than POST) |
| `unauthorized` | 401 | No user in the verified JWT. The gateway normally rejects these first. |
| `plan_lapsed` | 403 | Not Entitled |
| `gated` | 403 | Inside the Cooldown; includes `next_eligible_date` |
| `session_conflict` | 409 | The session ID already belongs to one of the caller's sessions |
| `audit_too_long` | 413 | A message-count, per-message or transcript-length cap was exceeded |
| `ai_unavailable` | 503 | API error, timeout, refusal, a reply cut off at `max_tokens`, or no text |
| `internal_error` | 500 | Missing or blank audit prompt, invalid configuration, or a failed read |

## System prompt

The audit prompt (cached, the same for every caller), followed by an `<audit_data>` JSON block:

- `today`: the UTC date of the request;
- `welcome_audit`: `true` when the caller has no Prior audits;
- `prior_audits`: up to two, newest first. Each has `completed_on`, `verdict` (`action`, `number`,
  `deadline`, `reasoning`), `baseline` and `deadline_passed`. `deadline_passed` is `null` when
  there is no deadline, and `false` on the deadline day itself.
- `audit_intake`: the intake from this request.

## Configuration (Edge Function secrets)

| Secret | Default | Notes |
| --- | --- | --- |
| `AUDIT_MARCUS_PROMPT` | none | Required. Missing or blank fails closed with `internal_error`. Never commit it. |
| `ANTHROPIC_API_KEY` | none | Required. The same secret the live `marcus-chat` uses. |
| `AUDIT_CHAT_MODEL` | `claude-opus-5-5` | |
| `AUDIT_CHAT_EFFORT` | `low` | `low`, `medium`, `high`, `xhigh` or `max`. Thinking is always on for this model; effort controls how much. |
| `AUDIT_CHAT_MAX_TOKENS` | `16000` | Covers thinking and the reply. |
| `AUDIT_CHAT_TIMEOUT_MS` | `60000` | Per attempt. The SDK retries once, so a call can take up to twice this. |
| `AUDIT_CHAT_MAX_MESSAGES` | `80` | Visible turns in `messages`. |
| `AUDIT_CHAT_MAX_MESSAGE_CHARS` | `8000` | Per message. |
| `AUDIT_CHAT_MAX_TRANSCRIPT_CHARS` | `120000` | All messages together. |

The caps are starting values, to be tuned with full-length audits. An invalid value (for example a
non-integer cap or an unknown effort) makes every call return `internal_error`. The log names the
setting but not its value.

## Tests

```powershell
node --experimental-strip-types --test tests/functions/marcus-audit-chat.test.ts tests/functions/marcus-audit-chat-config.test.ts
npx -y deno check supabase/functions/marcus-audit-chat/index.ts
& ./tests/supabase/run-pricing-audit-runtime.ps1
```

The runtime test serves a fake Messages API on port 55390 of the host and points the function at
it through `ANTHROPIC_BASE_URL` (see `tests/supabase/config.toml`). It never calls the real API.
