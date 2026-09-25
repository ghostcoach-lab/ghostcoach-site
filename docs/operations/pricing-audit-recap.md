# Pricing audit recap (S12)

After a new **Completion**, the customer gets one recap email, and `pricing_audits.recap_sent_at`
records that it was sent (spec #5, ticket #13, ADR 0002). Two parts do this:

- **`pricing-audit-complete`** (Edge Function) calls S12 server to server after
  `complete_pricing_audit` returns `completed`. It never calls S12 for `already_completed`.
- **S12** (n8n) checks the payload and sends one transactional email through Resend. It has no
  database access.

## Contract

`POST` to the S12 webhook (`gc-s12-pricing-audit-recap`) with the header
`Authorization: Bearer <S12_RECAP_SECRET>`. The secret is S12's own server-only secret, not the
browser's shared webhook secret. n8n refuses a request without it before the workflow runs.

```json
{
  "audit_id": "…",
  "email": "…",
  "first_name": "…",
  "verdict": { "action": "raise", "number": "59 per month", "deadline": "2026-11-01", "reasoning": "…" },
  "next_eligible_date": "2026-12-23"
}
```

- `audit_id` is a UUID. It is also the Resend `Idempotency-Key`.
- `email` is one address. The function reads it from the customer's `users` row.
- `first_name` comes from the customer's `profiles.firstname`. The customer can edit this field, so
  S12 HTML-escapes it and refuses one over 100 characters. The function sends `""` for a missing
  name or one over 100 characters; the email then greets without a name.
- `verdict.number` is `null` for `hold` and set for `raise` and `restructure`. Dates are
  `YYYY-MM-DD`.
- Any other field, or a missing one, makes the payload invalid.

| S12 answers | When | The function |
| --- | --- | --- |
| `200 {"sent":true}` | Resend accepted the email | sets `recap_sent_at` |
| `400 {"reason":"invalid_request"}` | The payload is invalid. Nothing is sent. | logs, leaves it null |
| `502 {"sent":false}` | Resend refused the email, failed or timed out (8 s) | logs, leaves it null |
| n8n `403` | Missing or wrong secret | logs, leaves it null |

The function waits at most `S12_RECAP_TIMEOUT_MS` (default 15 s). The customer gets `200 completed`
whatever happens to the recap: a failure is logged as `pricing-audit-complete: recap` with the
audit ID only, and nothing is rolled back. There is no automatic retry. See **Manual resend**.

The email text is a **placeholder**, marked `[PLACEHOLDER]` in the subject and body. The client
supplies the final wording before the release flag is turned on. It holds the Verdict, the reasoning, the
deadline, and a line saying that the next pricing audit opens on the next eligible date and checks
what the customer did with this Verdict.

## Building the candidate

`scripts/n8n/s12-pricing-audit-recap.mjs` builds the workflow offline. Its inputs stay out of git:
a private JSON file with the sender address and the webhook credential:

```json
{ "from": "Marcus <…>", "webhookCredential": { "id": "…", "name": "…" } }
```

```powershell
node scripts/n8n/s12-pricing-audit-recap.mjs --report <private options>             # safe to print
node scripts/n8n/s12-pricing-audit-recap.mjs --emit-private-json <private options> > <private file>
```

Keep the options file and the emitted JSON in `%LOCALAPPDATA%\GhostCoach\private-backups\`.
`--report` shows neither the sender nor the credential ID, and flags `placeholderCopy`.

The workflow reads the Resend key from the n8n variable `RESEND_API_KEY`, which S3 already uses.
The sender must be on the domain that S3 sends from, which Resend has already verified.

S12 saves its successful executions (`saveDataSuccessExecution: 'all'`), whatever the instance
default is. The live QA needs them: it checks that each Completion gives exactly one successful S12
run. The candidate refuses to build without this setting. A saved execution keeps the recap
payload: the customer's email address, first name and Verdict. n8n keeps it in the execution
history until the plan's pruning removes it.

## Going live (ticket #16, one approval per step)

1. Generate a new random secret. Create an n8n **Header Auth** credential with the name
   `Authorization` and the value `Bearer <secret>`. Put its ID and name in the private options file.
2. Build the candidate, then create the workflow through the n8n API (inactive). Check it in the
   editor, then activate it.
3. Set the Edge Function secrets `S12_RECAP_URL` (the production webhook URL) and `S12_RECAP_SECRET`
   (the same secret). Until both are set, every Completion logs "S12 is not configured" and sends
   no recap.
4. Live QA: one Completion gives one email and sets `recap_sent_at`. A replay (`already_completed`)
   sends nothing.

## Manual resend

Use this for audits whose recap failed. Every write and every S12 call is a production action and
needs its own approval.

1. **Find them** (read-only):

   ```sql
   select id, user_id, completed_at
   from public.pricing_audits
   where recap_sent_at is null
   order by completed_at;
   ```

   An audit completed in the last minute may still be waiting for S12's answer. Leave it.

2. **Check Resend's send log first.** In the Resend dashboard (Emails), look for a recap to that
   customer's address, sent at or after `completed_at`. A timeout can happen *after* Resend accepted the
   email, so the email may have gone out even though `recap_sent_at` is null. Resend only
   deduplicates by `Idempotency-Key` for 24 hours. After that, a resend to S12 sends a second email.
   - **Found:** don't resend. Record the send time from the log and go to step 4.
   - **Not found:** go to step 3.

3. **Resend through S12.** Build the exact payload from the saved audit:

   ```sql
   select json_build_object(
     'audit_id', a.id,
     'email', u.email,
     'first_name', coalesce(trim(p.firstname), ''),
     'verdict', json_build_object(
       'action', a.verdict_action, 'number', a.verdict_number,
       'deadline', a.verdict_deadline, 'reasoning', a.verdict_reasoning),
     'next_eligible_date', public.pricing_audit_next_eligible_date(a.completed_at)
   ) as payload
   from public.pricing_audits a
   join public.users u on u.id = a.user_id
   left join public.profiles p on p.user_id = a.user_id
   where a.id = '<audit_id>';
   ```

   POST it to the S12 webhook with the `Authorization: Bearer` secret. Only `200 {"sent":true}`
   counts. On a 400 or 502, read the S12 execution in n8n and fix the cause before trying again.
   Don't print the payload or the secret into chat or a ticket, because the payload holds the
   customer's address.

4. **Record it**:

   ```sql
   update public.pricing_audits
   set recap_sent_at = '<send time from the Resend log, or now()>'
   where id = '<audit_id>' and recap_sent_at is null;
   ```

   It must update exactly one row.

## Tests

```powershell
node --test tests/n8n/s12-pricing-audit-recap.test.mjs
node --experimental-strip-types --test tests/functions/pricing-audit-complete.test.ts tests/functions/pricing-audit-complete-config.test.ts
```

The S12 tests run the candidate's own Code node against valid and invalid payloads. They also check the
webhook's header credential, the Resend request and its `Idempotency-Key`, and that only a
successful send answers 2xx. They run offline. No test calls n8n or Resend.
