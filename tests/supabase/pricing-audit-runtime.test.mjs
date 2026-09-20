import assert from "node:assert/strict";

const apiUrl = requiredEnv("GC_RUNTIME_API_URL");
const anonKey = requiredEnv("GC_RUNTIME_ANON_KEY");
const serviceRoleKey = requiredEnv("GC_RUNTIME_SERVICE_ROLE_KEY");

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

async function request(path, { key, token = key, ...options }) {
  const response = await fetch(`${apiUrl}${path}`, {
    ...options,
    headers: {
      apikey: key,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  return { response, body };
}

async function createUser(email) {
  const { response, body } = await request("/auth/v1/admin/users", {
    key: serviceRoleKey,
    method: "POST",
    body: JSON.stringify({
      email,
      password: "runtime-test-password",
      email_confirm: true,
    }),
  });
  assert.equal(response.status, 200, JSON.stringify(body));
  return body.id;
}

async function signIn(email) {
  const { response, body } = await request(
    "/auth/v1/token?grant_type=password",
    {
      key: anonKey,
      method: "POST",
      body: JSON.stringify({ email, password: "runtime-test-password" }),
    },
  );
  assert.equal(response.status, 200, JSON.stringify(body));
  return body.access_token;
}

async function serviceInsert(table, rows) {
  const { response, body } = await request(`/rest/v1/${table}`, {
    key: serviceRoleKey,
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(rows),
  });
  assert.equal(response.status, 201, JSON.stringify(body));
  return body;
}

const ownerEmail = "audit-owner@example.test";
const otherEmail = "audit-other@example.test";
const ownerId = await createUser(ownerEmail);
const otherId = await createUser(otherEmail);

await serviceInsert("users", [
  { id: ownerId, plan: "operator", status: "active" },
  { id: otherId, plan: "builder", status: "active" },
]);
await serviceInsert("profiles", [
  { user_id: ownerId },
  { user_id: otherId },
]);

const ownerSession = "10000000-0000-0000-0000-000000000001";
const otherSession = "10000000-0000-0000-0000-000000000002";
await serviceInsert("sessions", [
  {
    id: ownerSession,
    user_id: ownerId,
    is_pricing_audit: true,
    processing_status: "complete",
    audit_intake: {},
  },
  {
    id: otherSession,
    user_id: otherId,
    is_pricing_audit: true,
    processing_status: "complete",
    audit_intake: {},
  },
]);
await serviceInsert("pricing_audits", [
  {
    user_id: ownerId,
    session_id: ownerSession,
    completed_at: "2026-09-20T10:00:00.000Z",
    is_welcome_audit: true,
    verdict_action: "raise",
    verdict_reasoning: "Owner-only audit history.",
    baseline: {},
  },
  {
    user_id: otherId,
    session_id: otherSession,
    completed_at: "2026-09-20T10:00:00.000Z",
    is_welcome_audit: true,
    verdict_action: "hold",
    verdict_reasoning: "Other user's audit history.",
    baseline: {},
  },
]);

const ownerToken = await signIn(ownerEmail);
const otherToken = await signIn(otherEmail);

const missingCredentials = await fetch(
  `${apiUrl}/functions/v1/pricing-audit-eligibility`,
  { method: "POST" },
);
assert.equal(missingCredentials.status, 401);

const invalidJwt = await request(
  "/functions/v1/pricing-audit-eligibility",
  { key: anonKey, token: "not-a-valid-jwt", method: "POST" },
);
assert.equal(invalidJwt.response.status, 401);

const ownerEligibility = await request(
  "/functions/v1/pricing-audit-eligibility",
  {
    key: anonKey,
    token: ownerToken,
    method: "POST",
    body: JSON.stringify({ user_id: otherId }),
  },
);
assert.equal(ownerEligibility.response.status, 200, JSON.stringify(ownerEligibility.body));
assert.equal(ownerEligibility.body.state, "eligible");
assert.equal(ownerEligibility.body.is_welcome_audit, true);

const otherEligibility = await request(
  "/functions/v1/pricing-audit-eligibility",
  { key: anonKey, token: otherToken, method: "POST" },
);
assert.equal(otherEligibility.response.status, 200, JSON.stringify(otherEligibility.body));
assert.equal(otherEligibility.body.state, "not_entitled");

async function visibleAudits(token) {
  const { response, body } = await request(
    "/rest/v1/pricing_audits?select=id,user_id",
    { key: anonKey, token, method: "GET" },
  );
  assert.equal(response.status, 200, JSON.stringify(body));
  return body;
}

const ownerAudits = await visibleAudits(ownerToken);
assert.equal(ownerAudits.length, 1);
assert.equal(ownerAudits[0].user_id, ownerId);

const otherAudits = await visibleAudits(otherToken);
assert.equal(otherAudits.length, 1);
assert.equal(otherAudits[0].user_id, otherId);

console.log("Pricing-audit gateway and caller-scoped RLS checks passed.");
