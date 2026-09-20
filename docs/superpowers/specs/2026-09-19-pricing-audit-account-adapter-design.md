# Pricing Audit Account Adapter Design

## Goal

Connect the account page to the authenticated `pricing-audit-eligibility` Edge Function and render its result without duplicating entitlement or cooldown rules in the browser.

## Scope

This slice covers the account-page eligibility read and rendering behavior. It also includes the small backend type cleanup and checklist correction identified during review. Deploying the Edge Function, applying migrations, pushing commits, and building the pricing-audit intake flow remain out of scope.

## Public Seam

The frontend behavior is exposed through:

```js
GCPricingAudit.loadAndRender({ supabase, elements, formatDate })
```

`supabase` is the authenticated browser client. `elements` contains the pricing-audit section, date fields, call to action, and gated notice. `formatDate` is supplied by the account page so date presentation stays consistent with the rest of that page.

The module owns the Edge Function invocation, response validation, and rendering. `account.js` only locates the real elements and supplies dependencies.

## Data Flow

1. The audit section is hidden before the request begins.
2. The module calls `supabase.functions.invoke("pricing-audit-eligibility")` with `POST` and no user-controlled identity.
3. The module rejects invocation errors and responses that do not match the eligibility contract.
4. A valid response is rendered according to its descriptive state.

The accepted response is:

```js
{
  state: "eligible" | "gated" | "not_entitled",
  is_welcome_audit: boolean,
  next_eligible_date: string | null,
  last_completed_at: string | null
}
```

The browser never calculates entitlement, elapsed days, or a next eligibility date.

## Rendering

- `eligible`: show the section and call to action, hide the gated notice, show the last completion date when present, and show `Available now` for the next audit.
- `gated`: show the section and gated notice, hide the call to action, and display the server-provided next eligibility date.
- `not_entitled`: keep the entire section hidden.
- Loading, request failure, invocation error, or malformed response: keep the entire section hidden.

Each render resets all relevant element state first so a later invocation cannot retain stale content from an earlier state.

## Backend Cleanup

The Edge Function handler will use union types for known plan and account-status values and a named `isEntitled` boolean. Timestamp strings remain plain strings because branding them would add machinery without improving this boundary.

## Verification

Node tests exercise the confirmed `GCPricingAudit.loadAndRender` seam with an injected Supabase client and lightweight fake elements. Tests cover the three valid states, authenticated invocation shape, loading behavior, invocation errors, and malformed responses. Existing Edge Function and migration tests remain part of regression verification.

The milestone checklist will distinguish handler-level authentication tests from pending JWT/RLS integration testing. Full JWT and RLS verification requires an isolated Supabase runtime and remains a deployment gate.
