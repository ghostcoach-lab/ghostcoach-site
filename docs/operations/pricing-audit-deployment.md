# Pricing audit deployment and rollback

The account-page adapter is already live through Netlify but fails closed, so the pricing-audit section remains hidden until the authenticated Edge Function is available. Do not activate the CTA until `/account/audit/` and its verdict/session contract have an owner.

## Required approvals

- Obtain explicit approval before applying the production migration.
- Obtain explicit approval before deploying the Edge Function.
- Confirm the `/account/audit/` activation plan separately; backend deployment does not resolve that route.
- Do not modify n8n workflows as part of this deployment.

## Preflight

1. Confirm the target project and create or verify a recoverable database backup.
2. Confirm `public.profiles.pricing_audit_last_date` has zero populated values. The migration aborts if this is not true.
3. Record row counts for `public.users`, `public.profiles`, and `public.sessions`, plus normal versus pricing-audit sessions.
4. Search database functions, views, triggers, website code, backend source, and deployed consumers for `pricing_audit_last_date`, `can_request_pricing_audit`, and `next_pricing_audit_date`.
5. Run the local regression suite and isolated runtime test:

```powershell
node --test tests/js/pricing-audit.test.cjs
node --experimental-strip-types --test tests/functions/pricing-audit-eligibility.test.ts
npx -y deno check supabase/functions/pricing-audit-eligibility/handler.ts
npx -y deno check supabase/functions/pricing-audit-eligibility/index.ts
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
6. Verify an unauthenticated request returns `401`, then verify eligible, gated, and not-entitled responses using normal user sessions.
7. Verify one user cannot read another user's `pricing_audits` rows through the Data API.
8. Recheck the recorded row counts and a normal coaching-session flow.

## Rollback

The frontend already fails closed when eligibility is unavailable. If the function misbehaves, remove or roll back only that function first and confirm the account section becomes hidden again.

Do not improvise a destructive schema rollback after audit writes begin. Prefer a reviewed forward fix. Before any audit rows exist, a reversal migration may restore the legacy profile column and functions, then remove the new table and columns; after writes exist, preserve or export the audit history and restore from the verified backup if a full rollback is required.
