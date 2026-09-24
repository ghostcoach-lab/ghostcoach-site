import assert from "node:assert/strict";
import { createServer } from "node:http";

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

// marcus-audit-chat: the gateway enforces the JWT, and the function reads only the
// caller's own Prior audits. The Messages API is a local fake (see config.toml).
const fakeAnthropicRequests = [];
const fakeAnthropic = createServer(async (req, res) => {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  fakeAnthropicRequests.push({ path: req.url, apiKey: req.headers["x-api-key"], body: JSON.parse(raw) });
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({
    id: "msg_runtime",
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    content: [
      { type: "thinking", thinking: "", signature: "runtime-signature" },
      { type: "text", text: "Fake Marcus reply.", citations: null },
    ],
    stop_reason: "end_turn",
    stop_sequence: null,
    stop_details: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  }));
});
await new Promise((resolve) => fakeAnthropic.listen(55390, "0.0.0.0", resolve));

try {
  const chatMissingCredentials = await fetch(`${apiUrl}/functions/v1/marcus-audit-chat`, { method: "POST" });
  assert.equal(chatMissingCredentials.status, 401);
  const chatInvalidJwt = await request("/functions/v1/marcus-audit-chat", {
    key: anonKey, token: "not-a-valid-jwt", method: "POST",
  });
  assert.equal(chatInvalidJwt.response.status, 401);
  assert.equal(fakeAnthropicRequests.length, 0);

  const returningEmail = "audit-returning@example.test";
  const returningId = await createUser(returningEmail);
  await serviceInsert("users", [{
    id: returningId,
    plan: "lifetime",
    status: "active",
    welcome_audit_used: true,
    last_audit_completed_at: "2026-05-01T09:00:00.000Z",
  }]);
  const returningSessions = [
    ["10000000-0000-0000-0000-000000000003", "2026-01-10T09:00:00.000Z", "returning-oldest"],
    ["10000000-0000-0000-0000-000000000004", "2026-03-01T09:00:00.000Z", "returning-middle"],
    ["10000000-0000-0000-0000-000000000005", "2026-05-01T09:00:00.000Z", "returning-newest"],
  ];
  await serviceInsert("sessions", returningSessions.map(([id]) => ({
    id, user_id: returningId, is_pricing_audit: true, processing_status: "complete", audit_intake: {},
  })));
  await serviceInsert("pricing_audits", returningSessions.map(([sessionId, completedAt, reasoning]) => ({
    user_id: returningId,
    session_id: sessionId,
    completed_at: completedAt,
    is_welcome_audit: reasoning === "returning-oldest",
    verdict_action: "hold",
    verdict_reasoning: reasoning,
    baseline: {},
  })));
  const returningToken = await signIn(returningEmail);

  const chatBody = (sessionId) => JSON.stringify({
    session_id: sessionId,
    audit_intake: {
      mrr: 1000, customer_count: 10, churn_rate: 2,
      current_pricing: "One tier.", last_pricing_change: "Never.",
    },
    messages: [],
  });
  const chat = await request("/functions/v1/marcus-audit-chat", {
    key: anonKey,
    token: returningToken,
    method: "POST",
    body: chatBody("20000000-0000-4000-8000-000000000001"),
  });
  assert.equal(chat.response.status, 200, JSON.stringify(chat.body));
  assert.deepEqual(chat.body, { reply: "Fake Marcus reply." });

  assert.equal(fakeAnthropicRequests.length, 1);
  const [sent] = fakeAnthropicRequests;
  assert.equal(sent.path, "/v1/messages");
  assert.equal(sent.apiKey, "runtime-test-fake-key");
  assert.equal(sent.body.model, "claude-opus-5-5");
  assert.equal(sent.body.system[0].text, "Runtime-test placeholder audit prompt.");
  const data = JSON.parse(sent.body.system[1].text.replace(/^<audit_data>\n|\n<\/audit_data>$/g, ""));
  assert.equal(data.welcome_audit, false);
  assert.deepEqual(
    data.prior_audits.map((audit) => audit.verdict.reasoning),
    ["returning-newest", "returning-middle"],
  );
  for (const foreign of ["Owner-only audit history.", "Other user's audit history."]) {
    assert.equal(JSON.stringify(sent.body).includes(foreign), false);
  }

  const conflict = await request("/functions/v1/marcus-audit-chat", {
    key: anonKey, token: ownerToken, method: "POST", body: chatBody(ownerSession),
  });
  assert.equal(conflict.response.status, 409, JSON.stringify(conflict.body));
  assert.deepEqual(conflict.body, { reason: "session_conflict" });
  assert.equal(fakeAnthropicRequests.length, 1);
} finally {
  fakeAnthropic.close();
}

// pricing-audit-complete: the gateway enforces the JWT, and only the service role can
// execute the Completion RPC.
const completeMissingCredentials = await fetch(`${apiUrl}/functions/v1/pricing-audit-complete`, { method: "POST" });
assert.equal(completeMissingCredentials.status, 401);
const completeInvalidJwt = await request("/functions/v1/pricing-audit-complete", {
  key: anonKey, token: "not-a-valid-jwt", method: "POST",
});
assert.equal(completeInvalidJwt.response.status, 401);

const rpcArgs = {
  p_user_id: ownerId,
  p_session_id: "30000000-0000-4000-8000-000000000001",
  p_transcript: "Marcus: Hold.",
  p_audit_intake: {},
  p_verdict_action: "hold",
  p_verdict_number: null,
  p_verdict_deadline: "2027-01-01",
  p_verdict_reasoning: "Forged through the REST API.",
  p_baseline: {},
};
for (const [label, token] of [["authenticated", ownerToken], ["anon", anonKey]]) {
  const attempt = await request("/rest/v1/rpc/complete_pricing_audit", {
    key: anonKey, token, method: "POST", body: JSON.stringify(rpcArgs),
  });
  assert.ok(
    [401, 403].includes(attempt.response.status) && attempt.body?.code === "42501",
    `${label} was not refused permission: ${attempt.response.status} ${JSON.stringify(attempt.body)}`,
  );
}
// Positive control: the service role reaches the RPC, which rejects an invalid Verdict.
const serviceAttempt = await request("/rest/v1/rpc/complete_pricing_audit", {
  key: serviceRoleKey, method: "POST", body: JSON.stringify({ ...rpcArgs, p_verdict_action: "lower" }),
});
assert.equal(serviceAttempt.body?.code, "23514", JSON.stringify(serviceAttempt.body));
const ownerAuditsAfterRpc = await visibleAudits(ownerToken);
assert.equal(ownerAuditsAfterRpc.length, 1, "a refused RPC call wrote an audit");

console.log("Pricing-audit gateway and caller-scoped RLS checks passed.");
