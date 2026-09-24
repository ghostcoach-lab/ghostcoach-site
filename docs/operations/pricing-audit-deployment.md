# Pricing audit deployment and rollback

The account-page adapter is live through Netlify and is protected by
`GC.PRICING_AUDIT_ENABLED`, which defaults to `false`. While disabled, the entire pricing-audit
section remains hidden and the browser does not invoke the eligibility Edge Function. Do not
enable the flag until `/account/audit/` and its final verdict/session contract pass integration
testing and receive frontend release approval.

## Required approvals

- Obtain explicit approval before applying the production migration.
- Obtain explicit approval before deploying the Edge Function.
- Keep `GC.PRICING_AUDIT_ENABLED = false` during backend deployment. Enabling it is a separate
  reviewed frontend release after `/account/audit/` and the final payload contract are verified.
- Do not modify n8n workflows as part of this deployment.

## Preflight

1. Confirm the target project and create or verify a recoverable database backup.
2. Confirm `public.profiles.pricing_audit_last_date` has zero populated values. The migration aborts if this is not true.
3. Record row counts for `public.users`, `public.profiles`, and `public.sessions`, plus normal versus pricing-audit sessions.
4. Search database functions, views, triggers, website code, backend source, and deployed consumers for `pricing_audit_last_date`, `can_request_pricing_audit`, and `next_pricing_audit_date`.
5. Run the local regression suite and isolated runtime test:

```powershell
node --test tests/js/pricing-audit.test.cjs
node --experimental-strip-types --test tests/functions/pricing-audit-eligibility.test.ts tests/functions/pricing-audit-eligibility-decision.test.ts tests/functions/marcus-audit-chat.test.ts tests/functions/marcus-audit-chat-config.test.ts
npx -y deno check supabase/functions/pricing-audit-eligibility/handler.ts
npx -y deno check supabase/functions/pricing-audit-eligibility/index.ts
npx -y deno check supabase/functions/marcus-audit-chat/index.ts
& ./tests/migrations/run-quarterly-pricing-audit-foundation.ps1
& ./tests/supabase/run-pricing-audit-runtime.ps1
```

## Deployment

Use Supabase CLI `2.117.0` or re-verify the commands against the installed version's `--help` output.

1. Link the reviewed checkout to the confirmed production project.
2. Run `supabase migration list` and confirm that only the intended pricing-audit migration is pending.
3. Apply the migration with `supabase db push`.
4. Run Supabase security and performance advisors; resolve new findings before proceeding.
5. Deploy only `pricing-audit-eligibility`. Keep `verify_jwt = true` from `supabase/config.toml`.
6. Confirm production still has `GC.PRICING_AUDIT_ENABLED = false` and the account page does not
   display the pricing-audit section.
7. Verify an unauthenticated request returns `401`, then verify eligible, gated, and not-entitled responses using normal user sessions.
8. Verify one user cannot read another user's `pricing_audits` rows through the Data API.
9. Recheck the recorded row counts and a normal coaching-session flow.

## Rollback

### S3 regression repair

The separately reviewed normal-session repair, candidate/backup paths, tests, and recovery
procedure are recorded in [S3 repair publication review](s3-repair-review-2026-09-23.md).
It is prepared locally and awaits publication approval. The pricing-audit release flag
remains false. A saved n8n draft is not proof of publication: verify the active version
after publication and again after restoring unrelated unpublished recap changes.

The frontend already fails closed when eligibility is unavailable. If the function misbehaves, remove or roll back only that function first and confirm the account section becomes hidden again.

Do not improvise a destructive schema rollback after audit writes begin. Prefer a reviewed forward fix. Before any audit rows exist, a reversal migration may restore the legacy profile column and functions, then remove the new table and columns; after writes exist, preserve or export the audit history and restore from the verified backup if a full rollback is required.
