# Pricing audit completion limit

Status: draft for client review, 2026-10-08. Tracked in #39 (tickets #43, #44, #45). Nothing here reaches production until the client has
reviewed this spec and approved the migration and the deploy separately.

## Problem Statement

The audit page calls `pricing-audit-complete` after every Marcus reply from turn 4, to check whether
the conversation has reached a Verdict. A typical audit makes about 7 calls, a long one up to about
37. Every call that gets past the pre-checks runs an AI extraction, which costs money. Nothing caps
how many of those calls one customer can trigger, whether by a stuck page, a reload loop or a script
using their login.

A cap has to leave real audits alone: a tight limit such as "5 per day" would block normal use.

## Solution

`pricing-audit-complete` gets two limits, checked after the existing pre-checks and before the AI
extraction:

- **Per customer:** at most 100 counted calls in any rolling 24 hours, counted from the calls made in
  the last 24 hours, not per calendar day.
- **Per audit session:** at most 60 counted calls for one `session_id`. The page generates session
  IDs, so a customer could rotate them; the per-customer limit covers that.

A call over a limit gets HTTP 429 with `{"reason":"rate_limited","limit":"session"}` or
`{"reason":"rate_limited","limit":"user"}`. When both are exceeded, the answer is `"user"`. The audit
page already handles this response. Both limits default to these numbers in code and can be
changed with environment variables.

The check is one atomic database step, so parallel calls can't both slip under a limit. No account
is exempt, test accounts included.

## User Stories

1. As a founder doing a normal audit, I want the limit to never get in my way, so that I can finish
   my audit however the conversation goes.
2. As a founder on a long audit of up to about 37 checks, I want headroom well above that, so that a
   long conversation still completes.
3. As a founder who already completed an audit, I want reopening the result to keep working, so that
   checking my Verdict again never uses up my limit.
4. As a founder, I want my sign-in, request and eligibility errors reported as before, so that the
   limit doesn't hide the real problem.
5. As a founder who hits a limit, I want a clear "rate limited" response that says which limit, so
   that the page can tell me what happened.
6. As a founder who hits the per-customer limit, I want it to free up as my older calls age past 24
   hours, so that I'm not locked out until midnight.
7. As the client, I want each customer capped at 100 counted calls per rolling 24 hours, so that one
   account can't run up AI costs.
8. As the client, I want each audit session capped at 60 counted calls, so that one stuck page can't
   use up a customer's whole allowance.
9. As the client, I want the per-customer limit to catch rotated session IDs, so that switching IDs
   gains nothing.
10. As the client, I want calls that end in an AI failure or an incomplete extraction to count, so
    that repeated failing calls are capped too.
11. As the client, I want calls rejected before the limiter to never count, so that the counter only
    measures calls that could reach the AI.
12. As the client, I want replays of completed audits to never count, so that the stored result stays
    free to fetch.
13. As the client, I want parallel calls counted exactly, so that a burst can't exceed the limit.
14. As the client, I want "user" reported when both limits are exceeded, so that the response always
    names the limit that matters more.
15. As the client, I want both limits adjustable by environment variable with safe defaults in code,
    so that tuning needs no code change and deploying needs no new secret.
16. As the client, I want no exemptions for test accounts, so that what we test is what customers
    get.
17. As the client, I want the limit records in their own table with RLS on and service-role writes
    only, so that customers can't read or reset their own counters.
18. As the client, I want old limit records removed during the check, so that the table stays small
    with nothing extra to schedule.
19. As the client, I want a customer's limit records removed when their account is deleted, so that
    account deletion leaves nothing behind.
20. As the client, I want the new reason code in the shared error helper and the function docs, so
    that it behaves like every other refusal.
21. As the client, I want the rule for which calls count written in the function docs, so that it
    can be checked later.
22. As the client, I want live QA with temporary low limits and cleanup by exact ID, so that the
    limit is proven in production without touching real founders.
23. As the client, I want the migration and the deploy approved separately, so that each production
    step is a deliberate decision.
24. As a developer, I want the limiter behind an injected dependency, so that the handler's ordering
    can be tested under Node with fakes.
25. As a developer, I want the database function tested on its own against real Postgres, so that
    atomicity and the window maths are proven where they run.

## Implementation Decisions

**Where the check sits.** The handler order becomes:

1. Method, authentication, configuration, body parsing and validation.
2. Session lookup: a replay of a completed audit returns the stored result. A session conflict is
   refused.
3. Entitlement and Cooldown.
4. **Limit check and count** (new).
5. Extraction, then completion and the recap, as today.

Calls settled in steps 1–3 never reach the counter and never count. Every call allowed in step 4
counts, whatever happens afterwards: an AI failure, an incomplete extraction, a deadline rejected
by the completion RPC, an internal error. A call refused by the limiter itself is not recorded, so a
customer who keeps calling while limited doesn't push their own window forward.

**Database: a new table and a new function in their own migration.**

- Table `pricing_audit_completion_calls`: an identity primary key, `user_id` referencing the
  application users table with `on delete cascade` (the same pattern as `pricing_audits`, so account
  deletion removes the rows with no workflow change), `session_id` as a plain uuid (no foreign key,
  because the session row may not exist yet), and `called_at timestamptz not null default now()`.
  Indexes support counting by `(user_id, called_at)`, by `(session_id, called_at)`, and the purge by
  `called_at`.
- RLS on, with no policies. All privileges revoked from `public`, `anon` and `authenticated`; only
  the service role has access.
- Function `pricing_audit_take_completion_call(user_id, session_id, user_limit, session_limit)`,
  executable by the service role only. In one transaction:
  1. Take a transaction-scoped lock for that customer, so parallel calls for the same customer run
     one after another.
  2. Delete every record older than 24 hours, for all customers. This keeps the table small and
     covers deleted accounts' leftovers.
  3. Count the customer's records in the last 24 hours, and the session's records in the last 24
     hours.
  4. If the customer's count has reached `user_limit`, return `user`. Otherwise, if the session's
     count has reached `session_limit`, return `session`. Otherwise insert one record and return
     `allowed`.
  The window boundary uses the database clock. A record exactly 24 hours old has left the window.
- Because old records are purged, the per-session count also only sees the last 24 hours. Audits
  finish well within a day, so in practice this is the same as a per-session total. Flagged for
  client review below.

**Edge Function changes.**

- A new injected dependency, the limiter, wraps the RPC call. The handler calls it in step 4 with
  the configured limits.
- On `user` or `session`, the handler returns 429 `{"reason":"rate_limited","limit":"user"|"session"}`
  through the existing refusal helper. The helper gains an optional extra field, as it already does
  for `next_eligible_date`.
- If the limiter itself fails (database error), the call is refused with `internal_error` and
  logged. It never proceeds to extraction without being counted.
- `rate_limited: 429` joins the shared reason-code table.
- Config: `AUDIT_COMPLETE_USER_LIMIT` (default 100) and `AUDIT_COMPLETE_SESSION_LIMIT` (default 60),
  read with the shared positive-integer setting helper, like the function's other settings.

**Docs.** The function's operations doc gets the new reason row, the counting rule from this spec,
the two settings and the live-QA procedure. The deployment runbook gets the migration and the
deploy order.

**Deploy order.** The audit page already handles `rate_limited`, so the deploy gate is met.

1. Back up the database and restore-test the backup (Free plan, no managed backups).
2. Apply the migration (separately approved). The function doesn't use the table until deployed, so
   the migration is safe on its own.
3. Deploy the function (separately approved).
4. Live QA as below.

Rollback: redeploy the previous function version. The table can stay and is ignored. A down
migration drops the function and the table if the client wants them gone.

## Testing Decisions

Good tests check behaviour through public interfaces: the handler's request in and response out, and
the database function's return value and table contents. Prior art: the existing
`pricing-audit-complete` handler tests (Node, fakes) and the migration contract runner (throwaway
Postgres).

- **Handler (Node, fakes):**
  - under, at and over the per-customer limit, and the same for the per-session limit
  - both limits exceeded returns `"user"`
  - a replay of a completed audit returns the stored result and never calls the limiter
  - auth, validation, session conflict, `plan_lapsed` and `gated` never call the limiter
  - allowed calls that then fail in extraction still count, because the limiter was called
  - a limiter error returns `internal_error` and skips extraction
  - the limits come from the settings, with the defaults when unset
- **Database function (migration contract runner, real Postgres):**
  - under, at and over each limit
  - both limits exceeded
  - a refused call inserts nothing
  - records older than 24 hours are purged and stop counting, for every customer
  - parallel calls for one customer at the boundary admit exactly the remaining allowance
  - privileges: `anon` and `authenticated` can neither read the table nor execute the function
  - deleting a user removes their records
- **Live QA** (each production change approved separately). Send the client beforehand: the exact
  QA account ID, the exact fields and values of the temporary eligibility reset with before/after
  evidence, the temporary limits (3 per customer, 2 per session) and the time window. During the
  test, call the deployed function until each limit returns 429. Afterwards:
  - remove the temporary limits and confirm the defaults (100/60) are back
  - restore the QA account by ID
  - delete the test's limit records and any audit row the test created, by exact ID
  - existing `pricing_audits` rows are never changed

## Out of Scope

- Rate limiting any other function, including the audit chat and `marcus-chat`.
- Changing the audit page. Its `rate_limited` handling already shipped.
- A `Retry-After` header or a retry time in the response body. The agreed response is the reason
  and the limit only.
- Exemptions or per-plan limits.
- Tracking completion rates or other analytics from these records.

## Further Notes

- **For client review:** the per-session count only sees the last 24 hours, because old records are
  purged in the same step. An audit session resumed more than a day later starts its session count
  again. The per-customer limit still applies.
- **For client review:** calls refused by the limiter are not recorded. Recording them would keep a
  customer who keeps calling locked out indefinitely.
- The limit defaults in code mean the deploy doesn't wait for any secret to be set.
