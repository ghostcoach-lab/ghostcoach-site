# Audit completion runs in an Edge Function; n8n S12 only sends the recap

The briefs describe audit completion as an n8n webhook workflow. We instead handle completion in a versioned, JWT-verified Supabase Edge Function. It authenticates the caller, re-checks entitlement and cooldown, extracts the verdict and baseline from the transcript, and persists everything through a single Postgres RPC. Only after that commit does it call an n8n workflow labelled **S12** server-to-server, and S12's sole job is the recap email.

The existing n8n webhooks authenticate with a browser-visible shared secret, so n8n cannot establish who the caller is. Its workflow source also lives outside the repository and cannot be tested offline. The recap stays in n8n alongside the other customer emails. It is sent through Resend with the audit ID as the idempotency key, not through Beehiiv as the briefs said. The client confirmed this on 2026-09-24: the recap is transactional email to a single recipient, and Beehiiv is a newsletter tool.

## Consequences

- Structured audit fields (`is_welcome_audit`, verdict, baseline) are derived on the server. The client sends only the session ID, the transcript and the audit intake.
- The transcript is client-supplied. A forged transcript can only fake the forger's own record and consume their own cooldown, and that risk is accepted.
- The completion RPC can be executed by `service_role` only. A `SECURITY DEFINER` RPC open to `authenticated` users would have let any user write a verdict directly through PostgREST, skipping extraction and validation.
- A recap that fails never rolls back a completion. `pricing_audits.recap_sent_at` records delivery, and unsent recaps are replayed by hand.
- The authoritative entitlement check happens at completion. An audit whose entitlement lapses mid-conversation is rejected.
