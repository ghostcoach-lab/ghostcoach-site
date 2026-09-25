# Milestone 2 rollout and live QA

This runbook takes Milestone 2 live and proves it before `/account/audit/` exists (spec #5,
ticket #14; the run itself is #16). It covers seven steps, in this order:

1. [Existing-workflow corrections](#1-existing-workflow-corrections-s6-s4-s3)
2. [Manual database backup and restore test](#2-manual-database-backup-and-restore-test)
3. [Migration](#3-migration)
4. [Deploy both functions](#4-deploy-both-functions)
5. [Configure secrets](#5-configure-secrets)
6. [Create and activate S12](#6-create-and-activate-s12)
7. [Live QA run](#7-live-qa-run)

Each step has a pre-check, a verification and a rollback.

## Rules for every step

- **One approval per step.** Every step changes production. Before each step, get an approval
  that names that step. An approval for one step does not cover the next.
- **Stop on a failed check.** If a pre-check or a verification fails, stop and roll back that
  step. Do not continue to the next step.
- **The release flag stays off.** `GC.PRICING_AUDIT_ENABLED` stays `false` for the whole
  rollout, so no customer can reach an audit. Turning it on is a separate frontend release.
- **Secrets stay private.** Keys, JWTs, workflow exports, backups, account emails and production
  IDs go only in `%LOCALAPPDATA%\GhostCoach\private-backups\`, never into git, a ticket or chat.
- **Evidence goes in local QA notes.** Record it in a dated QA document in the engagement
  workspace, not in a GitHub issue: version IDs, counts, hashes and exact row IDs.

Tools: Supabase CLI `2.117.0` (`npx -y supabase@2.117.0 …`), the n8n public API with an API key,
Node 22 and PowerShell. Where a command needs the project ref, use `<project ref>`.

## Before you start

Run the full local regression on the reviewed branch. Every test must pass:

```powershell
node --test tests/js/pricing-audit.test.cjs tests/n8n/s12-pricing-audit-recap.test.mjs tests/qa/pricing-audit-live-qa.test.mjs
node --experimental-strip-types --test tests/functions/*.test.ts
npx -y deno check supabase/functions/pricing-audit-eligibility/index.ts supabase/functions/marcus-audit-chat/index.ts supabase/functions/pricing-audit-complete/index.ts
& ./tests/migrations/run-quarterly-pricing-audit-foundation.ps1
& ./tests/supabase/run-pricing-audit-runtime.ps1
```

Also confirm these, read-only:

- The production site still has `GC.PRICING_AUDIT_ENABLED = false`.
- `public.pricing_audits` has 0 rows.
- The Milestone 1 migration is applied and `20260924170000` is not.

## 1. Existing-workflow corrections (S6, S4, S3)

Each correction is a no-op while no audit exists, so all three go live first. They are ticket #15.
The procedure for each workflow is in its candidate runbook:

- S6: `docs/operations/s6-account-deletion-audits.md` (PR #18);
- S4 and S3: `docs/operations/s3-s4-ignore-audit-sessions.md` (PR #19).

Publish one workflow at a time, with an approval that names it.

**Pre-check**

- Export the live workflow (read-only) into the private backup folder. This export is also the
  rollback copy. Record its `activeVersion` ID.
- The transformer's `--report` shows only the intended change and no `validationProblems`.
- Record whether the workflow has an unpublished draft that differs from its published version.

**Change**

1. Save the candidate as a draft with `PUT /api/v1/workflows/<id>?publishIfActive=false`.
2. Publish that exact version with `POST /api/v1/workflows/<id>/publish`.
3. If an unrelated draft existed (S3 has one), re-save those draft edits on top of the new
   version as an unpublished draft.

**Verification**

- Fetch the workflow again. The active version's nodes and connections equal the candidate
  (compare key-order-insensitively; n8n reorders keys on save). The workflow is still active.
- The re-saved draft differs from the active version only by the unrelated edits.
- Do not execute the workflow to test it. With no audits, the change has no visible effect.

**Rollback**

Publish the previous `activeVersion` from n8n version history, or `PUT` the private export and
publish it. Then fetch it again and compare it with the export.

## 2. Manual database backup and restore test

The project is on the Free plan, which has no managed backups. Do not apply the migration
without a backup that you restored successfully.

**Pre-check**

- Get the database connection string (Dashboard → Connect, session pooler) into an environment
  variable. It holds the database password, so never print it:

  ```powershell
  $env:GC_BACKUP_DB_URL = Get-Content <private file> -Raw
  ```

- Record the row counts that the restore must match:

  ```sql
  select 'users' as t, count(*) from public.users union all
  select 'profiles', count(*) from public.profiles union all
  select 'sessions', count(*) from public.sessions union all
  select 'pricing_audits', count(*) from public.pricing_audits union all
  select 'subscriptions', count(*) from public.subscriptions union all
  select 'auth.users', count(*) from auth.users;
  ```

**Backup**

```powershell
$dir = "$env:LOCALAPPDATA\GhostCoach\private-backups\db-$(Get-Date -Format yyyyMMdd-HHmm)"
New-Item -ItemType Directory -Force $dir
npx -y supabase@2.117.0 db dump --db-url $env:GC_BACKUP_DB_URL -f "$dir\roles.sql" --role-only
npx -y supabase@2.117.0 db dump --db-url $env:GC_BACKUP_DB_URL -f "$dir\schema.sql"
npx -y supabase@2.117.0 db dump --db-url $env:GC_BACKUP_DB_URL -f "$dir\data.sql" --use-copy --data-only
```

The dumps hold customer data. They stay in the private folder.

**Restore test**

Restore into a disposable local Supabase stack, never into production. It needs Docker and a
PostgreSQL 17 `psql` client:

```powershell
npx -y supabase@2.117.0 start          # in an empty scratch folder
psql --single-transaction --variable ON_ERROR_STOP=1 `
  --file "$dir\roles.sql" --file "$dir\schema.sql" `
  --command "SET session_replication_role = replica" --file "$dir\data.sql" `
  --dbname "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
```

**Verification**

- The restore finishes with no error.
- The counts query above gives the same numbers on the restored database.
- `public.pricing_audits`, `users.welcome_audit_used` and the Milestone 1 functions exist in the
  restored schema.

Then stop and delete the disposable stack (`npx -y supabase@2.117.0 stop --no-backup`).

**Rollback**

Nothing changed in production. If the restore fails, fix the dump and repeat this step.

## 3. Migration

The migration is `supabase/migrations/20260924170000_pricing_audit_completion.sql`. It adds
`pricing_audits.recap_sent_at` and four functions. It changes no existing row.

**Pre-check**

- Step 2 passed in the last hour, and nothing was deployed since.
- `npx -y supabase@2.117.0 link --project-ref <project ref>`, then
  `npx -y supabase@2.117.0 migration list`: only `20260924170000` is pending.
- Save the Milestone 1 function definitions for the comparison:

  ```sql
  select p.proname, md5(pg_get_functiondef(p.oid)) as definition, p.proacl::text as acl
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('can_request_pricing_audit', 'next_pricing_audit_date')
  order by 1;
  ```

**Change**

```powershell
npx -y supabase@2.117.0 db push
```

**Verification** (read-only)

- `migration list` shows `20260924170000` as applied.
- `pricing_audits.recap_sent_at` exists and is nullable.
- `pricing_audit_next_eligible_date`, `pricing_audit_decide_eligibility`,
  `pricing_audit_session_state` and `complete_pricing_audit` exist. Only `service_role` can
  execute the last three:

  ```sql
  select p.proname, r.rolname, has_function_privilege(r.rolname, p.oid, 'execute') as can_execute
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  cross join (values ('anon'), ('authenticated'), ('service_role')) as r(rolname)
  where n.nspname = 'public'
    and p.proname in ('pricing_audit_decide_eligibility', 'pricing_audit_session_state', 'complete_pricing_audit')
  order by 1, 2;
  ```

  Expect `true` only for `service_role`.
- The Milestone 1 definitions and grants are the same as in the pre-check.
- `select public.pricing_audit_next_eligible_date('2026-09-25T23:30:00Z')` returns `2026-12-24`.
- Run the Supabase security and performance advisors. Compare them with the baseline in the
  production preflight notes. Only findings that the migration adds count.

**Rollback**

Before the first Completion (`pricing_audits` still has 0 rows), roll back step 4 first, because
`pricing-audit-complete` calls these functions. Then reverse the migration:

```sql
begin;
drop function public.complete_pricing_audit(uuid, uuid, text, jsonb, text, text, date, text, jsonb);
drop function public.pricing_audit_session_state(uuid, uuid);
drop function public.pricing_audit_decide_eligibility(public.plan_type, public.user_status, timestamptz, boolean, timestamptz, timestamptz);
drop function public.pricing_audit_next_eligible_date(timestamptz);
alter table public.pricing_audits drop column recap_sent_at;
delete from supabase_migrations.schema_migrations where version = '20260924170000';
commit;
```

After real audits exist, do not drop anything. Make a reviewed forward fix instead, or restore
the step 2 backup if a full rollback is necessary.

## 4. Deploy both functions

`marcus-audit-chat` and `pricing-audit-complete`. Both have `verify_jwt = true` in
`supabase/config.toml`. `pricing-audit-eligibility` is not redeployed.

**Pre-check**

- Step 3 is verified.
- The Deno checks from "Before you start" pass on this exact commit.
- `npx -y supabase@2.117.0 secrets list --project-ref <project ref>` shows `ANTHROPIC_API_KEY`
  (the live `marcus-chat` uses it).

**Change**

```powershell
npx -y supabase@2.117.0 functions deploy marcus-audit-chat --project-ref <project ref>
npx -y supabase@2.117.0 functions deploy pricing-audit-complete --project-ref <project ref>
```

**Verification**

- `functions list` shows both as active, with JWT verification on.
- A `POST` to each with no `Authorization` header gets `401` from the gateway.
- An `OPTIONS` preflight to each gets the same CORS answer as `pricing-audit-eligibility`.
- `marcus-chat` and `pricing-audit-eligibility` still have the same version as before.

Until step 5, an authenticated call returns `internal_error`, because the audit prompt is not set.
This is the fail-closed behaviour. No customer can call the functions, because the flag is off.

**Rollback**

```powershell
npx -y supabase@2.117.0 functions delete marcus-audit-chat --project-ref <project ref>
npx -y supabase@2.117.0 functions delete pricing-audit-complete --project-ref <project ref>
```

Nothing calls them while the release flag is off, so deleting them affects no customer.

## 5. Configure secrets

The names, defaults and limits are in [marcus-audit-chat.md](marcus-audit-chat.md) and
[pricing-audit-complete.md](pricing-audit-complete.md).

| Secret | Value for the rollout |
| --- | --- |
| `AUDIT_MARCUS_PROMPT` | The client's audit prompt, or the QA placeholder below until they supply it |
| `AUDIT_CHAT_MODEL`, `AUDIT_CHAT_EFFORT`, `AUDIT_COMPLETE_MODEL`, `AUDIT_COMPLETE_EFFORT` | Leave unset to use the defaults (`claude-opus-5-5`, `low`) |
| `AUDIT_CHAT_MAX_*`, `AUDIT_COMPLETE_MAX_TRANSCRIPT_CHARS` | Leave unset to use the default caps |
| `S12_RECAP_URL` | `https://<n8n host>/webhook/gc-s12-pricing-audit-recap` |
| `S12_RECAP_SECRET` | A new random secret, only for S12 |

**QA placeholder prompt.** Use it only for the live QA run. The client's prompt must replace it
before the release flag is turned on:

> [QA PLACEHOLDER: the client's audit prompt replaces this before launch.] You are Marcus,
> GhostCoach's pricing coach, running a pricing audit. Open with one short question about the
> customer's pricing. When the customer asks for your Verdict, give it in one reply: the action
> (raise, hold or restructure), the new price unless you hold, a deadline as a calendar date, and
> your reasoning. Then state the Baseline: the value anchor, the friction read, the customer mix
> and the churn window.

**Pre-check**

- Step 4 is verified.
- Generate the S12 secret privately, for example
  `[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Maximum 256 }))`. Keep it in
  the private folder.
- Write all the values to a private env file in the private folder.

**Change**

```powershell
npx -y supabase@2.117.0 secrets set --env-file <private env file> --project-ref <project ref>
```

Then create the n8n **Header Auth** credential for S12: name `Authorization`, value
`Bearer <S12 secret>`. It is a credential, not a workflow. Step 6 uses it.

**Verification**

- `secrets list` shows each name. Compare the digests with the private file, not the values.
- An authenticated call is no longer `internal_error`. Step 7 checks this with the QA account.

**Rollback**

`npx -y supabase@2.117.0 secrets unset <name> … --project-ref <project ref>`. With
`AUDIT_MARCUS_PROMPT` unset, the audit chat fails closed. With both S12 secrets unset,
completions log "S12 is not configured" and send no recap.

## 6. Create and activate S12

S12 is a new workflow. It sends the recap email and has no database access. The build procedure
and its contract are in [pricing-audit-recap.md](pricing-audit-recap.md).

**Pre-check**

- Step 5 is verified, and the Header Auth credential exists.
- `node scripts/n8n/s12-pricing-audit-recap.mjs --report <private options>` shows no
  `validationProblems`, and `placeholderCopy` is `true` until the client supplies the wording.
- No workflow named `S12 — Pricing Audit Recap` exists yet.

**Change**

1. Create the workflow from the private candidate with `POST /api/v1/workflows`. It is created
   inactive.
2. Check it in the n8n editor: the webhook uses the S12 credential, and the sender is correct.
3. Activate it.

**Verification**

- `GET /api/v1/workflows/<S12 id>` shows `active: true` and the webhook path
  `gc-s12-pricing-audit-recap`.
- A `POST` without the `Authorization` header gets n8n's `403`, and no execution runs.
- A `POST` with the header and the body `{}` gets `400 {"reason":"invalid_request"}`, and no
  email is sent.
- Record the S12 workflow ID privately. The live QA run needs it.

**Rollback**

Deactivate S12 (`POST /api/v1/workflows/<S12 id>/deactivate`). Completions then log a failed
recap and leave `recap_sent_at` null. Use the [manual resend](pricing-audit-recap.md#manual-resend)
for them after S12 is fixed.

## 7. Live QA run

`scripts/qa/pricing-audit-live-qa.mjs` runs one short real audit with one of the two existing QA
accounts. The account must have no pricing audit. The script makes these checks:

1. **Before.** It checks that the migration is applied, the QA account has no audit and S12 is
   active. Then it records row counts and md5 hashes of the QA account's rows in `users`,
   `profiles`, `sessions`, `pricing_audits`, `subscriptions`, `digests` and its Auth sessions.
   The `sessions` and `pricing_audits` hashes also include any row with one of the run's two
   session IDs. For information, it also records the row count of each whole table.
2. **Sign in.** It signs in the QA account with a magic-link token, with no email and no password.
   This updates `auth.users`, so the `gc_s1_new_signup` trigger calls S1, as in the Milestone 1 QA.
3. **Entitlement.** It grants temporary database-only `operator/active`, with the Welcome audit
   unused. The update applies only if the account still has the values that the preflight saved.
4. **Opener.** It calls `marcus-audit-chat` with no messages, then sends one message that asks
   Marcus for his Verdict and Baseline.
5. **Complete.** It calls `pricing-audit-complete`. It checks the audit `sessions` row, the
   `pricing_audits` row, the moved Cooldown, `recap_sent_at`, and exactly one new successful S12
   execution.
6. **Replay.** It sends the same completion again. It expects `already_completed`, no change in
   the rows and no new S12 execution.
7. **Gated.** It starts a new audit with a new session ID. It expects `gated` from the chat and
   from completion, with the same next eligible date, and no write.
8. **Cleanup.** This step always runs after the preflight, even if an earlier step failed. It
   finds the rows by the two session IDs that the run created. It deletes exactly those rows and
   restores the saved entitlement in one guarded statement. It restores the entitlement only if
   the account still has the granted `operator/active` values. If the plan or status changed
   outside the run, it keeps that change. Then it signs out the QA session.
9. **After.** It records the counts and hashes again. A difference in a hashed row fails the run.
   A change in a whole-table count does not fail the run: live chat inserts a pending `sessions`
   row on every page load, so these counts move during any run. The `after` line lists them as
   `count_changes`.

The run costs a few Anthropic calls and sends one recap email to the QA account's inbox.

**Configuration** (environment only; the script reads nothing from the repository):

| Variable | Value |
| --- | --- |
| `GC_QA_KEYS` | The JSON list of API keys used by earlier QA runs (legacy `anon` and `service_role`) |
| `GC_QA_SUPABASE_URL` | `https://<project ref>.supabase.co` |
| `GC_QA_SUPABASE_ACCESS_TOKEN` | A Supabase personal access token, for the Management API SQL endpoint. Create it for this run and revoke it after. |
| `GC_QA_USER_ID` | The QA account's user ID |
| `GC_QA_N8N_URL` | `https://<n8n host>` |
| `GC_QA_N8N_API_KEY` | An n8n API key |
| `GC_QA_S12_WORKFLOW_ID` | The S12 workflow ID from step 6 |

Load each value from the private folder, for example
`$env:GC_QA_KEYS = Get-Content <private file> -Raw`. The script removes the variables from its
own environment after it reads them. It prints only statuses, counts, hashes and row IDs. It
never prints a key, a JWT, an email address or Marcus's replies.

**Pre-check**

- Steps 1 to 6 are verified. `AUDIT_MARCUS_PROMPT` holds the client's prompt or the QA
  placeholder.
- The dry run prints the plan and the target, and shows no configuration problem. It sends no
  request:

  ```powershell
  node scripts/qa/pricing-audit-live-qa.mjs --dry-run
  ```

**Run**

```powershell
node scripts/qa/pricing-audit-live-qa.mjs --execute --confirm-project=<project ref> --confirm-user=<QA account ID>
```

Both confirmation flags must repeat the configured target. Otherwise the script refuses and
sends nothing (exit code 2).

**Verification**

- The last line is `{"result":"passed"}` and the exit code is 0.
- The QA inbox has exactly one recap email from this run, with the `[PLACEHOLDER]` subject.
- Copy the output into the dated QA notes: the session and audit IDs, the S12 execution ID, and
  the before and after state.

**If the run fails**

The output shows the failed step. Cleanup has already run.

- `"step":"cleanup","ok":true` and no `FAILED: production differs` line: nothing is left behind.
  Fix the cause, and then run again.
- `FAILED: production differs`: the `differences` in the `after` line name each table. Only the
  QA account's rows and the run's rows are hashed, so every difference is in those rows. First
  find out if something outside the run wrote the row, for example a sign-in to the QA account.
  If nothing did, the row is a leftover: clean it up by hand, as described below.
- `"step":"cleanup","ok":false`: read its `error`. Either the cleanup statement was rolled back
  as a whole, or the plan or status changed outside the run, which blocks the restore. Clean up
  by hand with the session IDs printed in the `before` line:

  ```sql
  -- Read first; every row must belong to the QA account and to this run's session IDs.
  select id, session_id, user_id from public.pricing_audits
  where user_id = '<QA account ID>' and session_id in ('<session_id>', '<gated_session_id>');
  select id, user_id, is_pricing_audit from public.sessions
  where id in ('<session_id>', '<gated_session_id>');

  begin;
  delete from public.pricing_audits
   where user_id = '<QA account ID>' and session_id in ('<session_id>', '<gated_session_id>');
  delete from public.sessions
   where user_id = '<QA account ID>' and is_pricing_audit and id in ('<session_id>', '<gated_session_id>');
  update public.users
     set plan = '<saved plan>', status = '<saved status>',
         welcome_audit_used = <saved flag>, last_audit_completed_at = <saved timestamp or null>
   where id = '<QA account ID>' and plan = 'operator' and status = 'active';
  -- Check each row count before you commit.
  commit;
  ```

  The saved values are the QA account's values before the run. In Milestone 1 QA, the accounts
  ended as `builder/pending`, `false`, `null`. Confirm them from the QA notes. If the plan or
  status changed outside the run, keep that change: set only `welcome_audit_used` and
  `last_audit_completed_at` back to their saved values. If the `sign out` step failed, delete that
  Auth session by its exact ID.

**Rollback**

The run leaves nothing behind once cleanup is verified. Database cleanup cannot recall the recap
email or the S1 call. S12 and S1 executions stay in the n8n history.

## After the rollout

- `GC.PRICING_AUDIT_ENABLED` is still `false`.
- Before the flag is turned on, the client's prompt replaces the QA placeholder
  (`AUDIT_MARCUS_PROMPT`), and the client's wording replaces the placeholder recap copy in S12.
- If a recap fails later, follow the [manual resend](pricing-audit-recap.md#manual-resend).
