import assert from "node:assert/strict";
import test from "node:test";

import { createPricingAuditEligibilityHandler } from "../../supabase/functions/pricing-audit-eligibility/handler.ts";

test("an unauthenticated caller receives 401", async () => {
  const handler = createPricingAuditEligibilityHandler({
    authenticate: async () => null,
    readEligibilityRecord: async () => {
      throw new Error("the database must not be queried before authentication");
    },
    now: () => new Date("2026-09-19T12:00:00.000Z"),
  });

  const response = await handler(new Request(
    "http://localhost/functions/v1/pricing-audit-eligibility",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: "another-user" }),
    },
  ));

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "Unauthorized" });
});

test("a browser preflight succeeds without authentication", async () => {
  const handler = createPricingAuditEligibilityHandler({
    authenticate: async () => {
      throw new Error("preflight must not authenticate");
    },
    readEligibilityRecord: async () => {
      throw new Error("preflight must not query the database");
    },
    now: () => new Date("2026-09-19T12:00:00.000Z"),
  });

  const response = await handler(new Request(
    "http://localhost/functions/v1/pricing-audit-eligibility",
    { method: "OPTIONS" },
  ));

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-methods"), "POST, OPTIONS");
});

test("an unsupported method receives 405", async () => {
  const handler = createPricingAuditEligibilityHandler({
    authenticate: async () => {
      throw new Error("unsupported methods must not authenticate");
    },
    readEligibilityRecord: async () => {
      throw new Error("unsupported methods must not query the database");
    },
    now: () => new Date("2026-09-19T12:00:00.000Z"),
  });

  const response = await handler(new Request(
    "http://localhost/functions/v1/pricing-audit-eligibility",
    { method: "GET" },
  ));

  assert.equal(response.status, 405);
  assert.deepEqual(await response.json(), { error: "Method not allowed" });
});

test("an active Operator with no completed audit receives a welcome audit", async () => {
  const handler = createPricingAuditEligibilityHandler({
    authenticate: async () => ({ userId: "user-123" }),
    readEligibilityRecord: async (userId) => {
      assert.equal(userId, "user-123");
      return {
        plan: "operator",
        status: "active",
        trial_end: null,
        welcome_audit_used: false,
        last_audit_completed_at: null,
      };
    },
    now: () => new Date("2026-09-19T12:00:00.000Z"),
  });

  const response = await handler(new Request(
    "http://localhost/functions/v1/pricing-audit-eligibility",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: "another-user" }),
    },
  ));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    state: "eligible",
    is_welcome_audit: true,
    next_eligible_date: null,
    last_completed_at: null,
  });
});

test("an active Lifetime customer with no completed audit receives a welcome audit", async () => {
  const handler = createPricingAuditEligibilityHandler({
    authenticate: async () => ({ userId: "lifetime-user" }),
    readEligibilityRecord: async () => ({
      plan: "lifetime",
      status: "active",
      trial_end: null,
      welcome_audit_used: false,
      last_audit_completed_at: null,
    }),
    now: () => new Date("2026-09-19T12:00:00.000Z"),
  });

  const response = await handler(new Request(
    "http://localhost/functions/v1/pricing-audit-eligibility",
    { method: "POST" },
  ));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    state: "eligible",
    is_welcome_audit: true,
    next_eligible_date: null,
    last_completed_at: null,
  });
});

test("an Operator in an unexpired trial receives a welcome audit", async () => {
  const handler = createPricingAuditEligibilityHandler({
    authenticate: async () => ({ userId: "trial-user" }),
    readEligibilityRecord: async () => ({
      plan: "operator",
      status: "trialing",
      trial_end: "2026-09-20T12:00:00.000Z",
      welcome_audit_used: false,
      last_audit_completed_at: null,
    }),
    now: () => new Date("2026-09-19T12:00:00.000Z"),
  });

  const response = await handler(new Request(
    "http://localhost/functions/v1/pricing-audit-eligibility",
    { method: "POST" },
  ));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    state: "eligible",
    is_welcome_audit: true,
    next_eligible_date: null,
    last_completed_at: null,
  });
});

test("a Builder is not entitled to a pricing audit", async () => {
  const handler = createPricingAuditEligibilityHandler({
    authenticate: async () => ({ userId: "builder-user" }),
    readEligibilityRecord: async () => ({
      plan: "builder",
      status: "active",
      trial_end: null,
      welcome_audit_used: true,
      last_audit_completed_at: "2026-08-01T09:30:00.000Z",
    }),
    now: () => new Date("2026-09-19T12:00:00.000Z"),
  });

  const response = await handler(new Request(
    "http://localhost/functions/v1/pricing-audit-eligibility",
    { method: "POST" },
  ));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    state: "not_entitled",
    is_welcome_audit: false,
    next_eligible_date: null,
    last_completed_at: "2026-08-01T09:30:00.000Z",
  });
});

test("an Operator at the trial expiry instant is not entitled", async () => {
  const handler = createPricingAuditEligibilityHandler({
    authenticate: async () => ({ userId: "expired-trial-user" }),
    readEligibilityRecord: async () => ({
      plan: "operator",
      status: "trialing",
      trial_end: "2026-09-19T12:00:00.000Z",
      welcome_audit_used: false,
      last_audit_completed_at: null,
    }),
    now: () => new Date("2026-09-19T12:00:00.000Z"),
  });

  const response = await handler(new Request(
    "http://localhost/functions/v1/pricing-audit-eligibility",
    { method: "POST" },
  ));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    state: "not_entitled",
    is_welcome_audit: false,
    next_eligible_date: null,
    last_completed_at: null,
  });
});

test("a past-due Operator is not entitled and keeps audit history", async () => {
  const handler = createPricingAuditEligibilityHandler({
    authenticate: async () => ({ userId: "past-due-user" }),
    readEligibilityRecord: async () => ({
      plan: "operator",
      status: "past_due",
      trial_end: null,
      welcome_audit_used: true,
      last_audit_completed_at: "2026-06-01T08:00:00.000Z",
    }),
    now: () => new Date("2026-09-19T12:00:00.000Z"),
  });

  const response = await handler(new Request(
    "http://localhost/functions/v1/pricing-audit-eligibility",
    { method: "POST" },
  ));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    state: "not_entitled",
    is_welcome_audit: false,
    next_eligible_date: null,
    last_completed_at: "2026-06-01T08:00:00.000Z",
  });
});

test("an entitled returning customer remains gated one millisecond before 90 days", async () => {
  const handler = createPricingAuditEligibilityHandler({
    authenticate: async () => ({ userId: "gated-user" }),
    readEligibilityRecord: async () => ({
      plan: "operator",
      status: "active",
      trial_end: null,
      welcome_audit_used: true,
      last_audit_completed_at: "2026-06-21T12:00:00.000Z",
    }),
    now: () => new Date("2026-09-19T11:59:59.999Z"),
  });

  const response = await handler(new Request(
    "http://localhost/functions/v1/pricing-audit-eligibility",
    { method: "POST" },
  ));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    state: "gated",
    is_welcome_audit: false,
    next_eligible_date: "2026-09-19",
    last_completed_at: "2026-06-21T12:00:00.000Z",
  });
});

test("an entitled returning customer is eligible at exactly 90 days", async () => {
  const handler = createPricingAuditEligibilityHandler({
    authenticate: async () => ({ userId: "quarterly-user" }),
    readEligibilityRecord: async () => ({
      plan: "operator",
      status: "active",
      trial_end: null,
      welcome_audit_used: true,
      last_audit_completed_at: "2026-06-21T12:00:00.000Z",
    }),
    now: () => new Date("2026-09-19T12:00:00.000Z"),
  });

  const response = await handler(new Request(
    "http://localhost/functions/v1/pricing-audit-eligibility",
    { method: "POST" },
  ));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    state: "eligible",
    is_welcome_audit: false,
    next_eligible_date: null,
    last_completed_at: "2026-06-21T12:00:00.000Z",
  });
});

test("a canceled Operator is not entitled", async () => {
  const handler = createPricingAuditEligibilityHandler({
    authenticate: async () => ({ userId: "canceled-user" }),
    readEligibilityRecord: async () => ({
      plan: "operator",
      status: "canceled",
      trial_end: null,
      welcome_audit_used: true,
      last_audit_completed_at: "2026-08-01T09:30:00.000Z",
    }),
    now: () => new Date("2026-09-19T12:00:00.000Z"),
  });

  const response = await handler(new Request(
    "http://localhost/functions/v1/pricing-audit-eligibility",
    { method: "POST" },
  ));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    state: "not_entitled",
    is_welcome_audit: false,
    next_eligible_date: null,
    last_completed_at: "2026-08-01T09:30:00.000Z",
  });
});

test("a database failure returns a stable server error", async () => {
  const handler = createPricingAuditEligibilityHandler({
    authenticate: async () => ({ userId: "user-123" }),
    readEligibilityRecord: async () => {
      throw new Error("sensitive database detail");
    },
    now: () => new Date("2026-09-19T12:00:00.000Z"),
  });

  const response = await handler(new Request(
    "http://localhost/functions/v1/pricing-audit-eligibility",
    { method: "POST" },
  ));

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    error: "Unable to determine pricing audit eligibility",
  });
});

test("an inconsistent completed-audit state fails closed", async () => {
  const handler = createPricingAuditEligibilityHandler({
    authenticate: async () => ({ userId: "inconsistent-user" }),
    readEligibilityRecord: async () => ({
      plan: "operator",
      status: "active",
      trial_end: null,
      welcome_audit_used: true,
      last_audit_completed_at: null,
    }),
    now: () => new Date("2026-09-19T12:00:00.000Z"),
  });

  const response = await handler(new Request(
    "http://localhost/functions/v1/pricing-audit-eligibility",
    { method: "POST" },
  ));

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    error: "Unable to determine pricing audit eligibility",
  });
});

test("a missing application user record fails closed", async () => {
  const handler = createPricingAuditEligibilityHandler({
    authenticate: async () => ({ userId: "missing-user" }),
    readEligibilityRecord: async () => null,
    now: () => new Date("2026-09-19T12:00:00.000Z"),
  });

  const response = await handler(new Request(
    "http://localhost/functions/v1/pricing-audit-eligibility",
    { method: "POST" },
  ));

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    error: "Unable to determine pricing audit eligibility",
  });
});
