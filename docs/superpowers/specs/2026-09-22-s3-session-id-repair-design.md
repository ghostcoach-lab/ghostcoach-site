# S3 Session-ID Repair Design

## Goal

Repair the normal coaching-session completion workflow so it completes the session row
created by the frontend, never creates a duplicate row, and suppresses duplicate recap
sends on repeated submissions. Pricing-audit routing and billing remain out of scope.

## Verified problem

The frontend creates a pending session and submits its ID to S3. Published S3 ignores
that ID, inserts another session, and completes the new row. The completion page watches
the original row, so it remains pending. Controlled QA reproduced this behavior.

Execution 17353 successfully reached Resend. Resend accepted the recap for the correct
QA address and later reported `last_event=delivered`; there is no demonstrated send-node
failure. User-visible inbox placement remains unconfirmed.

## Selected design

S3 will require UUID-shaped `session_id` and `user_id` values plus a nonblank transcript.
It will conditionally PATCH the existing row by session ID, owner, normal-session type,
pending status, and empty transcript. The PATCH stores only the transcript and requests
the changed row. Exactly one matching returned row is required before AI processing.

This conditional PATCH is an atomic first-submission claim. A repeated or concurrent
request cannot create a row or start a second processing chain. There is no compatibility
fallback that inserts a session when the ID is absent or unknown.

The final summary PATCH will also filter by the original ID and owner, request the changed
row, and require exactly one matching result before profile mutation or email. Resend will
receive a stable idempotency key derived from the session ID as secondary protection.
Resend retains keys for 24 hours, so this is not permanent exactly-once delivery.

## Failure and recovery

A failure after the claim preserves the submitted transcript. This repair does not add
automatic workflow retries or reset the claim. Recovery must inspect the last successful
node and Resend delivery state before any manual replay. This avoids blindly resending an
email already accepted by the provider.

The current webhook secret is present in public frontend configuration, and `user_id` is
caller supplied. Owner filtering protects row selection but does not authenticate the
caller. Webhook authentication is a separate security project.

## Draft preservation

Published version `7add89c0-5ae8-4d68-b669-ba3ad8a25338` is the repair base. Saved draft
`c730a7c8-2824-49f9-bcc8-f10cc2f6b6a2` contains unrelated recap-template changes and must
not be published with the repair. A private full backup exists at
`C:/Users/user/AppData/Local/GhostCoach/private-backups/s3-before-repair-20260922.json`.
It contains existing secrets and must never be committed or printed.

After the repair is published, the unrelated draft changes may be reapplied over the
repaired version and left unpublished. A structural diff must verify that the repair
remains present and only the intended recap changes differ from production.

## Acceptance

- A valid submission completes the original session ID with no new session row.
- Missing/malformed IDs, blank transcript, unknown row, wrong owner, and audit rows fail
  before scoring, profile mutation, or email.
- Repeated/concurrent submissions produce at most one claim and one recap attempt.
- Final persistence verifies the original ID and owner before later side effects.
- `created_at`, audit fields, retry count, and unrelated workflow nodes are preserved.
- Controlled QA uses confirmed accounts without trials, cards, Stripe IDs, or billing.
- Cleanup restores exact QA state and keeps all non-QA hashes unchanged.

## Scope boundary

Milestone 1 remains at 8/10. Step 9 completes only after the repair is published and the
controlled regression passes. Step 10 is the milestone closeout.

