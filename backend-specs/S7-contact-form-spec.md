# n8n Scenario S7 — Contact Form

**Status:** Not yet built. Build before going live with `/contact/`.
**Trigger:** HTTP webhook from `/contact/` handleSubmit().
**Webhook URL:** Set in `/contact/index.html` as `CONTACT_WEBHOOK` const.
**Storage:** Supabase `contacts` and `contact_rate_limit` tables.

---

## Why this scenario matters

The client-side defences on `/contact/` (honeypot, time-trap, length caps)
are speed bumps. **n8n S7 is the real wall.** If S7 is sloppy, the form
can be turned into a spam relay or used to overrun the contacts table.

The client-side defences are documented in `/contact/index.html`. This
scenario MUST enforce the same checks server-side because client checks
are bypassable.

---

## Webhook payload shape

`/contact/` POSTs JSON like:
```json
{
  "type": "contact_form",
  "name": "Maya Rodriguez",
  "email": "maya@example.com",
  "category": "billing",
  "subject": "Plan downgrade question",
  "message": "I'd like to switch from Operator back to Builder for next month...",
  "load_ts": 1735987200000,
  "website": "",
  "timestamp": "2026-05-18T14:23:00.000Z",
  "source": "getghostcoach.com/contact/"
}
```

The `website` field is the honeypot. The `load_ts` is the page-load timestamp.

---

## Required server-side checks (in this order — fail fast)

### 1. Honeypot check
Reject if `website` field is **missing** OR **non-empty**.
- Missing: JS was bypassed (likely a bot script).
- Non-empty: a bot auto-filled the URL field.

**Response:** HTTP 200, do nothing. (Silent rejection — see Why-silent below.)

### 2. Time-trap check
Reject if `load_ts` is:
- Missing or not numeric
- `(received_time - load_ts) < 3000ms` (too fast — bot)
- `(received_time - load_ts) > 86400000ms` (24h stale — replay or bot keeping the page open forever)

**Response:** HTTP 200, do nothing.

### 3. Email-header-injection defence
Strip `\r` and `\n` from `email` and `subject` BEFORE either is used in any email node (Beehiiv API call, notification render, etc.).

If you skip this, your form can be turned into an open relay. Bots inject `\nBcc: target@victim.com` into the subject and your Beehiiv sends spam to whoever they want.

```javascript
email = email.replace(/[\r\n]/g, '');
subject = subject.replace(/[\r\n]/g, '');
```

### 4. Length caps (server-side, don't trust client)
Truncate every field to the same caps as the client:
- `name`: 80
- `email`: 254
- `subject`: 120
- `message`: 5000

The client uses `maxlength` attributes AND `.slice()` as belt-and-braces — but the client can be bypassed entirely. Enforce here too.

### 5. Email shape validation
Reject if `email` doesn't match `^[^\s@]+@[^\s@]+\.[^\s@]+$`.
This is a "reasonable" regex, not RFC-compliant — fine for the autoresponder use case (n8n only uses the address to send a confirmation, not for auth).

### 6. Message minimum length
Reject if `message.length < 30`.
Matches the client minimum. Strong signal of bot or test traffic if below.

### 7. Rate limit (before INSERT)
Query `contact_rate_limit` and reject if:
- More than **3 submissions from this IP in the last hour**
- More than **1 submission from this email in the last hour**
- More than **50 submissions from this IP in the last 24 hours**

**Where to get the IP:**
- If you put a Netlify Edge Function in front of the n8n webhook: use header `x-nf-client-connection-ip` (most accurate, Netlify-trusted)
- If `/contact/` POSTs directly to n8n: use `x-forwarded-for` header (the first IP — your proxy chain may add more)

**Schema:** see `/sql/v22_contact_rate_limit_table.sql` for the table definition.

**Cleanup:** 24h cleanup cron. Either pg_cron in Supabase or a separate n8n
scheduled scenario that runs `cleanup_contact_rate_limit()`.

### 8. Then — and only then — INSERT into `contacts`

```sql
INSERT INTO contacts (user_id, name, email, category, subject, message, source, status)
VALUES ($1, $2, $3, $4, $5, $6, $7, 'open');
```

`user_id` may be null (for non-logged-in submitters). The client passes it
if the user is authenticated via Supabase.

### 9. INSERT counter row into `contact_rate_limit`
Even after a successful submission, record the counter so rate limits work
for the next attempt.

### 10. Trigger emails via Beehiiv
- Admin notification (to founder)
- User confirmation (autoresponder)

If a Beehiiv call fails, **do not retry indefinitely** — log the failure
and respond 200 to the webhook anyway. The submission is already in
`contacts`; missing the email is recoverable. A hung webhook isn't.

---

## Why silent rejection (HTTP 200 even when rejecting)

If you respond with an error code or message on a tripped bot defence,
bots learn your thresholds and adapt. The next bot in their queue waits
3.1 seconds, fills the website field with empty string, etc.

By showing the exact same success response as a real user, bots get no
signal. The real signal goes to n8n's execution log, which only you see.

---

## What `/contact/` does today (Phase 1)

While `CONTACT_WEBHOOK` contains the string `DISABLED`, handleSubmit shows
the success screen without firing the fetch. The form is fully testable
locally — bot defences run, validation runs, success state shows.

When S7 is built, change ONE LINE in `/contact/index.html`:

```javascript
const CONTACT_WEBHOOK = 'https://[your-n8n].railway.app/webhook/contact-form';
```

That's the entire client integration.
