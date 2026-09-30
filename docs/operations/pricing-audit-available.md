# Pricing audit available email (S13)

Status: candidate only (#32). S13 replaces the dormant S4 digest-line candidate from #26. It
must stay inactive until `/account/audit/` is ready and the frontend release is approved.

## Contract

S13 runs daily at 07:00 in `Europe/Amsterdam`. It sends one email when a Pricing audit becomes
available to any Entitled customer:

- active Operator;
- Operator on an unexpired trial;
- Lifetime.

This includes customers whose Welcome audit or later audit is already available when S13 first
goes live. Candidate selection calls `pricing_audit_decide_eligibility`; n8n does not copy the
Entitlement or Cooldown rules.

Each opportunity has a stable key:

- Welcome audit: `(user_id, null)`;
- later audit: `(user_id, preceding pricing_audits.id)`.

That key is both the database uniqueness boundary and the Resend idempotency key. S13 writes
`pricing_audit_availability_emails` only after Resend returns 2xx. A refused or timed-out send
takes the failure branch, writes nothing, and is selected again on the next daily run. A database
recording failure stops the execution for operator review because Resend may already have accepted
the email.

The migration exposes two RPCs only to `service_role`:

- `pricing_audit_availability_candidates(p_now, p_only_user_id default null)` lists unsent,
  currently available opportunities. The optional customer ID exists only for safe QA.
- `record_pricing_audit_availability_email(...)` records an accepted send and returns `false` for
  a duplicate opportunity.

The delivery table has RLS enabled and no `anon` or `authenticated` grants.

The email copy is marked `[PLACEHOLDER]`. GhostCoach must approve final copy before activation.

## Build the candidate

Create a private options file:

```json
{
  "from": "Marcus <…>",
  "supabaseCredential": { "id": "…", "name": "…" }
}
```

The credential must be the server-side Supabase credential used by trusted n8n workflows. The
workflow reads `SUPABASE_URL` and `RESEND_API_KEY` from n8n variables.

```powershell
node scripts/n8n/s13-pricing-audit-available.mjs --report <private options>
node scripts/n8n/s13-pricing-audit-available.mjs --emit-private-json <private options> > <private candidate>
```

The report is safe to print. It shows the schedule, audience, node names, placeholder-copy flag,
and validation problems; it omits the sender and credential ID. Keep options and candidate files
under `%LOCALAPPDATA%\GhostCoach\private-backups\`.

Import the production candidate as **inactive**. Confirm its name is
`S13 — Pricing Audit Available`, its timezone is `Europe/Amsterdam`, and it has this path:

```text
Daily schedule → list unsent opportunities → prepare email → Resend
                                                      ├─ accepted → record send
                                                      └─ failed   → stop, no record
record send failed → stop for operator review
```

## Migration rollout

The S13 migration is part of step 3 in
[pricing-audit-m2-rollout.md](pricing-audit-m2-rollout.md). It must follow the completion migration
because it uses the shared decision function and `pricing_audits`.

After `db push`, check read-only:

```sql
select count(*) from public.pricing_audit_availability_emails;

select p.proname, r.rolname, has_function_privilege(r.rolname, p.oid, 'execute') as can_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
cross join (values ('anon'), ('authenticated'), ('service_role')) as r(rolname)
where n.nspname = 'public'
  and p.proname in ('pricing_audit_availability_candidates',
                    'record_pricing_audit_availability_email')
order by 1, 2;
```

Expect zero delivery rows before QA and `true` only for `service_role`. Run Supabase security and
performance advisors and compare them with the pre-migration baseline.

## Live QA (separate approval)

Never run the all-customer candidate manually. Build a temporary candidate by adding the QA
customer ID to the private options as `"onlyUserId": "<QA user UUID>"`. Its report must say
`one QA customer`, and its workflow name starts `TEMP QA —`.

1. Create the QA workflow inactive.
2. Make the QA customer Entitled with an available opportunity, using the guarded save/restore
   procedure from the Milestone 2 QA run.
3. Execute the QA workflow once. Verify one email, one successful Resend response, and one
   matching delivery row.
4. Execute it again. Verify no email and no extra row.
5. Delete the exact QA delivery row, restore the saved customer state, and compare before/after
   counts and hashes.
6. Delete the temporary workflow and confirm it is gone.

If Resend accepted the email but recording failed, inspect the Resend log before another run. Add
the delivery row from the accepted send only after confirming the exact customer and opportunity.

## Activation (separate approval)

Prerequisites:

- the Milestone 2 migration, functions, S12, and live QA are complete;
- final S13 copy is approved;
- `/account/audit/` is deployed and checked;
- the all-customer S13 workflow is still inactive and matches a freshly generated candidate.

Before activation, run the candidate RPC read-only and record only the count by opportunity type;
do not copy addresses into notes. This count is the expected launch batch. Activate S13, then
check the first execution read-only:

- candidate count matches the pre-check;
- every candidate ends in either an accepted send plus one delivery row, or a failed send with no
  row;
- no opportunity has more than one row;
- the workflow remains active for the next daily schedule.

Rollback: deactivate S13. This stops future sends. Delivery rows for accepted emails remain as the
deduplication record; do not delete them during rollback.

## Tests

```powershell
node --test tests/n8n/s13-pricing-audit-available.test.mjs
./tests/migrations/run-quarterly-pricing-audit-foundation.ps1
```

The workflow tests execute the embedded email code and validate the success/failure connections.
The migration contract runs on disposable Postgres 17 and covers audience, Cooldown, Welcome and
returning opportunities, QA scoping, deduplication, retry selection, RLS, and grants.
