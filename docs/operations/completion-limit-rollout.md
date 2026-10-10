# Completion limit rollout

> **DRAFT for review (ticket #45).** Nothing here has been run. It follows
> [pricing-audit-m2-rollout.md](pricing-audit-m2-rollout.md) and changes production in three steps.

Takes the completion limit live: the #43 migration (`20261010120000_pricing_audit_completion_limit.sql`)
and the #44 function change (`pricing-audit-complete` calls the limiter and returns
`429 rate_limited`). Behaviour is in [pricing-audit-complete.md](pricing-audit-complete.md#rate-limit).

1. [Manual database backup and restore test](#1-manual-database-backup-and-restore-test)
2. [Migration](#2-migration)
3. [Deploy `pricing-audit-complete`](#3-deploy-pricing-audit-complete)
4. [Live QA](#4-live-qa)

## Rules for every step

- **One approval per step.** Each step changes production. Get an approval that names that step.
  An approval for one step does not cover the next.
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
not used: lowering the live secrets would return `429` to real customers. The run seeds counter rows
for the QA account instead, and needs no AI call, audit or email.

1. **Preflight.** The limiter table and function exist, and the QA account has no counted calls.
2. **Before.** Counts and md5 hashes of the QA account's rows and the run's session IDs (as in M2
   step 7), now including `pricing_audit_completion_calls`. Saves the QA account's entitlement.
3. **Entitle.** Temporary DB-only `operator/active`, Welcome audit unused, with a guarded update.
4. **Session limit.** Seeds 60 rows on one session, then calls `pricing-audit-complete` with it.
   Expects `429 {"reason":"rate_limited","limit":"session"}`.
5. **User limit.** Seeds 40 more rows on other sessions (the QA account now has 100), then calls with
   a new session. Expects `429` with `"limit":"user"`.
6. **Cleanup.** Deletes by exact ID every counter row tied to the run's session IDs (the seeded rows,
   and any row the limiter itself recorded), restores the entitlement only if the account still has
   the granted values, and signs out the QA session.
7. **After.** The same counts and hashes. A difference in a QA row fails the run.

The call body holds no Verdict. If a limit had been raised above the seeded counts, the call would be
allowed, cost one extraction that ends in `422 extraction_incomplete`, and fail the run, and cleanup
would still delete the row the limiter recorded.

The allowed path (a call under the limits is counted and runs extraction) is covered by the unit
tests and the disposable-stack runtime test, not by a live call.

**Pre-check**

- Steps 2 and 3 are verified. The configuration is the same as for the M2 live QA run
  ([step 7](pricing-audit-m2-rollout.md#7-live-qa-run)): the `GC_QA_*` variables, loaded from the
  private folder. `GC_QA_N8N_*` and `GC_QA_S12_WORKFLOW_ID` are read but unused by this run.
- The dry run prints the plan and the target and sends no request:

  ```powershell
  node scripts/qa/pricing-audit-live-qa.mjs --limit --dry-run
  ```

**Run**

```powershell
node scripts/qa/pricing-audit-live-qa.mjs --limit --execute --confirm-project=<project ref> --confirm-user=<QA account ID>
```

**Verification**

- `pricing_audit_completion_calls` is back to its before count, and no row for the QA account remains.
- The QA account's entitlement and the hashed rows match the before record.
- The function's limit secrets are still unset.

**Rollback**

Delete any leftover rows by their recorded IDs and restore the saved entitlement. Then, if the
limiter itself misbehaves, roll back step 3.
