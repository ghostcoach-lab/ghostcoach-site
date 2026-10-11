# Completion limit rollout

> **DRAFT for review (ticket #45).** Nothing here has been run. It follows
> [pricing-audit-m2-rollout.md](pricing-audit-m2-rollout.md) and changes production in three steps.
> Updated 2026-10-11 with the client's conditions: an under-limit call in the live QA, a notice
> before the QA, and steps 2 to 4 held until the client says the production window is clear.

Takes the completion limit live: the #43 migration (`20261010120000_pricing_audit_completion_limit.sql`)
and the #44 function change (`pricing-audit-complete` calls the limiter and returns
`429 rate_limited`). Behaviour is in [pricing-audit-complete.md](pricing-audit-complete.md#rate-limit).

1. [Manual database backup and restore test](#1-manual-database-backup-and-restore-test)
2. [Migration](#2-migration)
3. [Deploy `pricing-audit-complete`](#3-deploy-pricing-audit-complete)
4. [Live QA](#4-live-qa)

## Rules for every step

- **One approval per step.** Each step changes production. Get an approval that names that step.
  An approval for one step does not cover the next. The client approves each step separately too:
  the backup and restore test, the migration, the function deploy, and the live QA.
- **The client opens the window.** Steps 2, 3 and 4 wait until the client says the production
  window is clear. Run step 1 after that as well, because step 2 needs a backup that restored in
  the last hour.
- **Stop on a failed check.** Roll back that step and do not continue.
- **Customers can reach the audit.** `GC.PRICING_AUDIT_ENABLED` is `true` on `origin/main` (confirm
  on the live site first). Unlike the Milestone 2 rollout, a step can affect real customers, so
  the order below matters and the QA never lowers the live limits.
- **Secrets and evidence.** Keys, JWTs, backups, account emails and production IDs stay in
  `%LOCALAPPDATA%\GhostCoach\private-backups\`. Evidence (counts, hashes, exact row IDs) goes in a
  dated local QA document, not in a GitHub issue.

Tools: Supabase CLI `2.117.0` (`npx -y supabase@2.117.0 …`), Node 22, PowerShell. The project ref
is `<project ref>`.

## Before you start

- #43 (PR #50) and #44 (PR #51) are merged to `main`, and the reviewed commit is checked out.
- The CI on those PRs is Netlify only. Run the tests locally on this exact commit:

  ```powershell
  node --experimental-strip-types --test tests/functions/*.test.ts
  npx -y deno check supabase/functions/pricing-audit-complete/index.ts
  & ./tests/migrations/run-quarterly-pricing-audit-foundation.ps1
  & ./tests/supabase/run-pricing-audit-runtime.ps1
  ```

- Read-only: `migration list` shows `20261010120000` as the only pending migration, and
  `pricing_audit_completion_calls` does not exist yet.

## 1. Manual database backup and restore test

Same procedure as [Milestone 2, step 2](pricing-audit-m2-rollout.md#2-manual-database-backup-and-restore-test):
the Free plan has no managed backups, so dump, restore into a disposable local stack, and match the
row counts. Do not apply the migration without a backup that restored successfully in the last hour.

## 2. Migration

Additive only: one new table (`pricing_audit_completion_calls`, RLS on, `service_role` only) and one
function (`pricing_audit_take_completion_call`). It changes no existing row and no existing function,
so it is safe while customers are using the audit. The currently deployed `pricing-audit-complete`
does not call it.

**Pre-check**

- Step 1 passed in the last hour and nothing was deployed since.
- `migration list` shows only `20261010120000` as pending.

**Change**

```powershell
npx -y supabase@2.117.0 db push
```

**Verification** (read-only)

- `migration list` shows `20261010120000` applied.
- The table exists with RLS enabled and 0 rows. Only `service_role` has table privileges and can
  execute the function:

  ```sql
  select p.proname, r.rolname, has_function_privilege(r.rolname, p.oid, 'execute') as can_execute
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  cross join (values ('anon'), ('authenticated'), ('service_role')) as r(rolname)
  where n.nspname = 'public' and p.proname = 'pricing_audit_take_completion_call'
  order by 2;
  ```

  Expect `true` only for `service_role`.
- Run the Supabase security and performance advisors. Only findings the migration adds count.

**Rollback** (while the deployed function does not call the limiter, and the table is empty)

```sql
begin;
drop function public.pricing_audit_take_completion_call(uuid, uuid, integer, integer);
drop table public.pricing_audit_completion_calls;
delete from supabase_migrations.schema_migrations where version = '20261010120000';
commit;
```

If step 3 is already deployed, roll that back first: the function fails closed
(`internal_error`) while the limiter is missing.

## 3. Deploy `pricing-audit-complete`

Only this function, with `verify_jwt = true` from `supabase/config.toml`. **Never before step 2 is
verified:** with the limiter missing, every call returns `internal_error`, for real customers too.

**Pre-check**

- Step 2 is verified. The Deno check passes on this commit.
- Record the function's current version from `functions list`, for the rollback. Also record the
  commit SHA of `main` just before #51 merged (`git log --first-parent main`, the commit before the
  merge). Supabase cannot restore an old function version, so the rollback redeploys from that commit.
- No `AUDIT_COMPLETE_USER_LIMIT` or `AUDIT_COMPLETE_SESSION_LIMIT` secret is set, so the defaults
  (100 and 60) apply.

**Change**

```powershell
npx -y supabase@2.117.0 functions deploy pricing-audit-complete --project-ref <project ref>
```

**Verification**

- `functions list` shows a new version, active, JWT verification on.
- A `POST` with no `Authorization` header gets `401` from the gateway.
- `marcus-chat`, `marcus-audit-chat` and `pricing-audit-eligibility` have the same versions as before.

**Rollback**

Check out the commit SHA recorded in the pre-check and redeploy from it. Do not delete the function:
customers can reach it. The table and function from step 2 can stay; the old code ignores them.

## 4. Live QA

Proves the limiter against production without touching the live limits or any customer. It uses
one QA account with temporary DB-only entitlement, restored afterwards, as in the Milestone 2 run.

`scripts/qa/pricing-audit-live-qa.mjs --limit` runs it. The "set the limits to 2 and 1" procedure is
not used: lowering the live secrets would return `429` to real customers. The run makes one normal
call under the limits, then seeds counter rows for the QA account to reach each limit.

1. **Preflight.** The limiter table and function exist, and the QA account has no counted calls.
2. **Before.** Counts and md5 hashes of the QA account's rows and the run's session IDs (as in M2
   step 7), now including `pricing_audit_completion_calls`. Saves the QA account's entitlement.
3. **Entitle.** Temporary DB-only `operator/active`, Welcome audit unused, with a guarded update.
4. **Under limit.** Calls `pricing-audit-complete` with a new session and a body that holds no
   Verdict. The limiter allows and records the call, and extraction finds no Verdict. Expects
   `422 {"reason":"extraction_incomplete"}` and exactly one counter row for that session.
5. **Session limit.** Seeds 60 rows on another session, then calls `pricing-audit-complete` with it.
   Expects `429 {"reason":"rate_limited","limit":"session"}`.
6. **User limit.** Seeds 39 more rows on other sessions, so the QA account has exactly 100 (1
   recorded and 99 seeded). Then calls with a new session. Expects `429` with `"limit":"user"`.
7. **Cleanup.** Deletes by exact ID every counter row tied to the run's session IDs (the recorded
   row, the seeded rows, and any other row the limiter recorded). Also deletes any sessions or audit
   row under those IDs. Restores the entitlement only if the account still has the granted values,
   and signs out the QA session.
8. **After.** The same counts and hashes. A difference in a QA row fails the run.

The under-limit call costs up to two extraction calls to the AI provider. No audit chat runs.

The QA sign-in updates `auth.users`, so the `gc_s1_new_signup` trigger calls S1, which can send a
real signup email to the QA account, as in the Milestone 2 live QA.

If extraction finds a Verdict after all, the call persists a full audit for the QA account, and S12
sends its recap email to the QA account. The run then fails at the under-limit step. Cleanup deletes
the audit and the session by exact ID and restores the entitlement, including the Cooldown fields.

If a limit had been raised above the seeded counts, the session-limit call would also be allowed and
end in `422`. The run fails, and cleanup still deletes the rows the limiter recorded.

### Notice to the client before the QA

Send this to the client privately, by email and not in GitHub, and wait for the approval of step 4:

- **The QA account ID.**
- **The fields the run changes on that account's `users` row, with their current values** (read-only
  query, just before sending). The run sets `plan` to `operator`, `status` to `active`,
  `welcome_audit_used` to `false` and `last_audit_completed_at` to `null`, and restores all four.
  It also adds and deletes rows in `pricing_audit_completion_calls`, tied to the run's sessions.
- **The sign-in email.** The QA sign-in fires S1, which can send one signup email to the QA account.
- **The worst case.** If extraction unexpectedly finds a Verdict, the under-limit call also writes
  one sessions row and one `pricing_audits` row for the QA account, sets its Cooldown fields, and
  S12 sends one recap email to the QA account's address. The run then fails, deletes both rows by
  exact ID and restores the four `users` fields. The email cannot be recalled.
- **No Stripe records.** Confirm that the account has no Stripe customer and no subscription. Check
  the `users` row and, read-only, the Stripe dashboard. Make no Stripe change.
- **The time window.** Name the window and state that it avoids Monday 07:00 `Europe/Amsterdam`.
  Avoid 07:00 on every other day too: S13 runs daily at that time, and the temporarily entitled QA
  account could get an audit-availability email.

**Pre-check**

- Steps 2 and 3 are verified. The client has said the production window is clear, has approved
  step 4, and the notice above was sent.
- The configuration is the same as for the M2 live QA run
  ([step 7](pricing-audit-m2-rollout.md#7-live-qa-run)): the `GC_QA_*` variables, loaded again from
  the private folder just before the run, so they hold the current keys. The script refuses to
  start, and sends nothing, when a key it needs is missing. `GC_QA_N8N_*` and
  `GC_QA_S12_WORKFLOW_ID` are read but unused by this run.
- The dry run prints the plan and the target and sends no request:

  ```powershell
  node scripts/qa/pricing-audit-live-qa.mjs --limit --dry-run
  ```

**Run**

```powershell
node scripts/qa/pricing-audit-live-qa.mjs --limit --execute --confirm-project=<project ref> --confirm-user=<QA account ID>
```

**Verification**

- The output shows the under-limit step with `422`, `extraction_incomplete` and `"recorded":1`,
  then both `429`s.
- `pricing_audit_completion_calls` is back to its before count, and no row for the QA account remains.
- No sessions or audit row exists under the run's session IDs.
- The QA account's entitlement and the hashed rows match the before record.
- The function's limit secrets are still unset.

**Rollback**

Delete any leftover rows by their recorded IDs and restore the saved entitlement. Then, if the
limiter itself misbehaves, roll back step 3.
