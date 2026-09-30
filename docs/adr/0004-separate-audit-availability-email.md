# ADR 0004: Send audit availability in a separate workflow

Status: accepted

## Context

The first Milestone 2 design added a Pricing audit line to the Monday digest. That coupled launch
to S4, whose audience excludes Operator trials and whose delivery was being repaired separately.
The audit page also needs a one-time message when each Welcome audit or later audit becomes
available, including opportunities already open at launch.

Email delivery and database recording cannot be one atomic transaction. Recording before Resend
can suppress an email that was never sent. Recording after Resend can leave an accepted email
unrecorded if the database write fails.

## Decision

Use an independent daily n8n workflow, S13. Keep the S4 digest-line candidate inactive.

S13 asks a service-role-only database function for currently available, unsent opportunities. The
function delegates Entitlement and Cooldown to the shared eligibility decision. Its audience is
active Operators, unexpired Operator trials, and Lifetime customers.

Persist accepted sends in `pricing_audit_availability_emails`. A Welcome audit is keyed by the
customer with a null audit ID. Every later opportunity is keyed by the customer and the preceding
completed Pricing audit. A nulls-not-distinct unique constraint makes each opportunity durable and
unique.

Send through Resend first, using the opportunity as its idempotency key. Record the delivery only
after Resend accepts it. A send failure records nothing and retries on the next daily run. A record
failure stops visibly for operator reconciliation because the email may already have been accepted.

Keep the table and both RPCs service-role-only. Enable RLS on the table as defense in depth. Build
S13 offline and activate it only after `/account/audit/` is live and separately approved.

## Consequences

- The audit email reaches trial Operators without changing the digest audience.
- Customers with an already-open opportunity receive the launch batch once.
- Delivery state is independent of digest state and survives workflow execution pruning.
- Resend acceptance followed by a database failure needs manual reconciliation. The stable
  idempotency key reduces immediate duplicate risk but does not replace that check.
- Production rollout adds a table, two service-only RPCs, an inactive workflow QA step, and a
  separate activation gate.
