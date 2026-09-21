# Pricing Audit Release Flag Design

## Purpose

Allow the Milestone 1 database migration and eligibility Edge Function to be deployed and
verified without exposing a call to action that points to the unfinished `/account/audit/`
route.

The pricing-audit account section must remain completely hidden until the route and its final
session/verdict payload contract are launch-ready.

## Decision

Add `GC.PRICING_AUDIT_ENABLED` to `js/config.js`, following the existing
`GC.GOAL_BAR_ENABLED` configuration pattern. Its production default is `false`.

The account page passes the flag to the pricing-audit adapter. The adapter treats any value
other than the boolean `true` as disabled. When disabled, it resets the audit UI to its hidden
state, returns before invoking `pricing-audit-eligibility`, and renders no audit dates or CTA.

When the flag is `true`, the existing eligibility behavior remains unchanged:

- `eligible` shows the section and CTA.
- `gated` shows the section and eligibility dates without the CTA.
- `not_entitled`, request failures, and invalid payloads keep the section hidden.

## Alternatives Considered

### Remove or comment out the CTA markup

This would hide the link, but activation would require another structural edit and the account
section could still expose incomplete release state. It also would not provide a named,
testable launch control.

### Store the flag remotely

A database-backed or hosted configuration flag could be changed without a site deployment, but
it would add infrastructure and another production dependency for a single release gate. That
complexity is not justified for Milestone 1.

## Data Flow

1. `js/config.js` defines `GC.PRICING_AUDIT_ENABLED = false`.
2. `js/pages/account.js` supplies that value when it asks the pricing-audit adapter to load.
3. `js/pricing-audit.js` resets all audit elements first.
4. If the flag is not exactly `true`, the adapter returns without making a network request.
5. If the flag is `true`, the adapter invokes the authenticated eligibility Edge Function and
   renders the validated response using the existing behavior.

## Failure Behavior

The flag is fail-closed. A missing, undefined, false, or malformed flag value behaves as
disabled. The release flag does not weaken authentication, entitlement, cooldown, response
validation, or existing request-error handling.

The flag is only a presentation and activation gate. It is not an authorization control; the
Edge Function and later S12 completion path remain responsible for server-side enforcement.

## Testing

Add a focused frontend test that starts with visible audit controls, supplies a disabled flag,
and proves that:

- the entire audit section and CTA are hidden;
- all displayed values are reset; and
- the eligibility function is not invoked.

Update existing enabled-path tests to pass `enabled: true`, proving that eligible, gated,
not-entitled, loading, malformed-response, and failure behavior are preserved.

Run the complete frontend pricing-audit test file after implementation.

## Activation Procedure

Keep `GC.PRICING_AUDIT_ENABLED` set to `false` while deploying and validating the Milestone 1
database and eligibility foundation. Change it to `true` only after `/account/audit/` and the
final session/verdict payload contract have passed integration testing and the frontend release
owner approves activation.

Enabling the flag is a separate reviewed frontend release. It is not part of the database
migration or Edge Function deployment approval.
