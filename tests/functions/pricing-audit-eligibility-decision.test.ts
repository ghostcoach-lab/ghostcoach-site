import assert from "node:assert/strict";
import test from "node:test";

import {
  decidePricingAuditEligibility,
  type EligibilityDecision,
  type EligibilityRecord,
} from "../../supabase/functions/_shared/pricing-audit-eligibility.ts";

const now = new Date("2026-09-19T12:00:00.000Z");

const cases: Array<{
  name: string;
  record: EligibilityRecord;
  now?: Date;
  expected: EligibilityDecision;
}> = [
  {
    name: "an active Operator with no completed audit gets a Welcome audit",
    record: {
      plan: "operator",
      status: "active",
      trial_end: null,
      welcome_audit_used: false,
      last_audit_completed_at: null,
    },
    expected: { state: "eligible", isWelcomeAudit: true },
  },
  {
    name: "an Operator in an unexpired trial gets a Welcome audit",
    record: {
      plan: "operator",
      status: "trialing",
      trial_end: "2026-09-20T12:00:00.000Z",
      welcome_audit_used: false,
      last_audit_completed_at: null,
    },
    expected: { state: "eligible", isWelcomeAudit: true },
  },
  {
    name: "an Operator at the trial expiry instant is not entitled",
    record: {
      plan: "operator",
      status: "trialing",
      trial_end: "2026-09-19T12:00:00.000Z",
      welcome_audit_used: false,
      last_audit_completed_at: null,
    },
    expected: { state: "not_entitled" },
  },
  {
    name: "an Operator whose trial has no end date is not entitled",
    record: {
      plan: "operator",
      status: "trialing",
      trial_end: null,
      welcome_audit_used: false,
      last_audit_completed_at: null,
    },
    expected: { state: "not_entitled" },
  },
  {
    name: "an active Lifetime customer gets a Welcome audit",
    record: {
      plan: "lifetime",
      status: "active",
      trial_end: null,
      welcome_audit_used: false,
      last_audit_completed_at: null,
    },
    expected: { state: "eligible", isWelcomeAudit: true },
  },
  {
    name: "an active Builder is not entitled",
    record: {
      plan: "builder",
      status: "active",
      trial_end: null,
      welcome_audit_used: false,
      last_audit_completed_at: null,
    },
    expected: { state: "not_entitled" },
  },
  {
    name: "a trialing Builder is not entitled",
    record: {
      plan: "builder",
      status: "trialing",
      trial_end: "2026-09-20T12:00:00.000Z",
      welcome_audit_used: false,
      last_audit_completed_at: null,
    },
    expected: { state: "not_entitled" },
  },
  {
    name: "a past-due Operator is not entitled",
    record: {
      plan: "operator",
      status: "past_due",
      trial_end: null,
      welcome_audit_used: true,
      last_audit_completed_at: "2026-06-01T08:00:00.000Z",
    },
    expected: { state: "not_entitled" },
  },
  {
    name: "a canceled Lifetime customer is not entitled",
    record: {
      plan: "lifetime",
      status: "canceled",
      trial_end: null,
      welcome_audit_used: false,
      last_audit_completed_at: null,
    },
    expected: { state: "not_entitled" },
  },
  {
    name: "an entitled customer inside the Cooldown is gated until 90 days after Completion",
    record: {
      plan: "operator",
      status: "active",
      trial_end: null,
      welcome_audit_used: true,
      last_audit_completed_at: "2026-08-01T09:30:00.000Z",
    },
    expected: { state: "gated", nextEligibleDate: "2026-10-30" },
  },
  {
    name: "an entitled customer one millisecond before 90 days is still gated",
    record: {
      plan: "lifetime",
      status: "active",
      trial_end: null,
      welcome_audit_used: true,
      last_audit_completed_at: "2026-06-21T12:00:00.000Z",
    },
    now: new Date("2026-09-19T11:59:59.999Z"),
    expected: { state: "gated", nextEligibleDate: "2026-09-19" },
  },
  {
    name: "an entitled customer at exactly 90 days is eligible for a non-welcome audit",
    record: {
      plan: "operator",
      status: "active",
      trial_end: null,
      welcome_audit_used: true,
      last_audit_completed_at: "2026-06-21T12:00:00.000Z",
    },
    expected: { state: "eligible", isWelcomeAudit: false },
  },
  {
    name: "a trialing Operator inside the Cooldown is gated",
    record: {
      plan: "operator",
      status: "trialing",
      trial_end: "2026-09-20T12:00:00.000Z",
      welcome_audit_used: true,
      last_audit_completed_at: "2026-09-18T23:30:00.000Z",
    },
    expected: { state: "gated", nextEligibleDate: "2026-12-17" },
  },
  {
    name: "a not-entitled customer with an inconsistent audit state is not entitled",
    record: {
      plan: "builder",
      status: "active",
      trial_end: null,
      welcome_audit_used: true,
      last_audit_completed_at: null,
    },
    expected: { state: "not_entitled" },
  },
];

for (const { name, record, now: at = now, expected } of cases) {
  test(name, () => {
    assert.deepEqual(decidePricingAuditEligibility(record, at), expected);
  });
}

test("an entitled customer with a used Welcome audit but no Completion timestamp is an error", () => {
  assert.throws(
    () =>
      decidePricingAuditEligibility({
        plan: "operator",
        status: "active",
        trial_end: null,
        welcome_audit_used: true,
        last_audit_completed_at: null,
      }, now),
    /Completed audit timestamp is missing/,
  );
});
