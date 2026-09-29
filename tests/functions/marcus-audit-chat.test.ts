import assert from "node:assert/strict";
import test from "node:test";

import {
  BUSINESS_PROFILE_FIELD_MAX_CHARS,
  createMarcusAuditChatHandler,
} from "../../supabase/functions/marcus-audit-chat/handler.ts";
import { AUDIT_CHAT_DEFAULTS } from "../../supabase/functions/marcus-audit-chat/config.ts";

const PROMPT = "TEST-AUDIT-PROMPT-MARKER: run the pricing audit.";
const sessionId = "3f0c2a4e-8b1d-4c6f-9a2e-5d7b1c0e9f41";
const intake = {
  mrr: 4200,
  customer_count: 37,
  churn_rate: 4.5,
  current_pricing: "Two tiers: 49 and 99 per month.",
  last_pricing_change: "Raised the starter tier in March.",
};
const welcomeRecord = {
  plan: "operator",
  status: "active",
  trial_end: null,
  welcome_audit_used: false,
  last_audit_completed_at: null,
};
const returningRecord = {
  ...welcomeRecord,
  welcome_audit_used: true,
  last_audit_completed_at: "2026-05-01T09:00:00.000Z",
};

function rawMessage(content: unknown[], stop_reason = "end_turn", extra: object = {}) {
  return {
    id: "msg_fixture",
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    content,
    stop_reason,
    stop_sequence: null,
    stop_details: null,
    usage: { input_tokens: 10, output_tokens: 10 },
    ...extra,
  };
}
const thinking = { type: "thinking", thinking: "", signature: "fixture-signature" };
const text = (value: string) => ({ type: "text", text: value, citations: null });

function setup(overrides: Record<string, unknown> = {}) {
  const calls: {
    params: any[]; priorAudits: unknown[][]; profiles: string[]; sessions: string[]; logs: unknown[][];
  } = {
    params: [], priorAudits: [], profiles: [], sessions: [], logs: [],
  };
  const handler = createMarcusAuditChatHandler({
    authenticate: async () => ({ userId: "user-1" }),
    readEligibilityRecord: async () => welcomeRecord,
    sessionExists: async (id: string) => {
      calls.sessions.push(id);
      return false;
    },
    readPriorAudits: async (...args: unknown[]) => {
      calls.priorAudits.push(args);
      return [];
    },
    readBusinessProfile: async (userId: string) => {
      calls.profiles.push(userId);
      return null;
    },
    createMessage: async (params: unknown) => {
      calls.params.push(params);
      return rawMessage([thinking, text("Welcome to your pricing audit.")]);
    },
    loadConfig: () => ({ ...AUDIT_CHAT_DEFAULTS, prompt: PROMPT }),
    now: () => new Date("2026-09-24T12:00:00.000Z"),
    logError: (...args: unknown[]) => calls.logs.push(args),
    ...overrides,
  } as any);
  return { handler, calls };
}

function post(body: unknown, init: RequestInit = {}) {
  return new Request("http://localhost/functions/v1/marcus-audit-chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
    ...init,
  });
}

const valid = (messages: unknown[] = []) => ({ session_id: sessionId, audit_intake: intake, messages });

const priorRow = (completed: string, deadline: string | null, action = "raise") => ({
  completed_at: completed,
  verdict_action: action,
  verdict_number: action === "hold" ? null : "59",
  verdict_deadline: deadline,
  verdict_reasoning: `Reasoning from ${completed}.`,
  baseline: { value_anchor: "a", friction_read: "b", mix: "c", churn_window: "d" },
});

function auditData(params: any) {
  const block = params.system[1].text as string;
  const match = block.match(/^<audit_data>\n([\s\S]*)\n<\/audit_data>$/);
  assert.ok(match, "data block is wrapped in audit_data tags");
  return JSON.parse(match[1]);
}

async function expectReason(response: Response, status: number, body: object) {
  assert.equal(response.status, status);
  assert.deepEqual(await response.json(), body);
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
}

test("a browser preflight succeeds without authentication", async () => {
  const { handler } = setup({
    authenticate: async () => {
      throw new Error("preflight must not authenticate");
    },
  });
  const response = await handler(new Request("http://localhost/", { method: "OPTIONS" }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-methods"), "POST, OPTIONS");
  assert.match(response.headers.get("access-control-allow-headers") ?? "", /authorization/);
});

test("an empty conversation returns Marcus's opener after a fixed opening user turn", async () => {
  const { handler, calls } = setup();
  const response = await handler(post(valid()));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { reply: "Welcome to your pricing audit." });
  assert.equal(calls.params.length, 1);
  const params = calls.params[0];
  assert.equal(params.model, "claude-opus-5-5");
  assert.deepEqual(params.output_config, { effort: "low" });
  assert.equal("thinking" in params, false);
  assert.equal(params.system[0].text, PROMPT);
  assert.equal(params.messages.length, 1);
  assert.equal(params.messages[0].role, "user");
  assert.ok(params.messages[0].content.trim().length > 0);
});

test("a follow-up sends the history after the opening turn and joins the reply's text blocks", async () => {
  const history = [
    { role: "assistant", content: "What do you charge today?" },
    { role: "user", content: "49 and 99 a month." },
  ];
  const { handler, calls } = setup({
    createMessage: async (params: unknown) => {
      calls.params.push(params);
      return rawMessage([thinking, text("Noted. "), thinking, text("Who churns first?")]);
    },
  });
  const response = await handler(post(valid(history)));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { reply: "Noted. Who churns first?" });
  const { messages } = calls.params[0];
  assert.equal(messages.length, 3);
  assert.deepEqual(messages.slice(1), history);
  assert.equal(messages[0].role, "user");
});

test("with no Prior audits the data block marks a Welcome audit", async () => {
  const { handler, calls } = setup();
  await handler(post(valid()));
  assert.deepEqual(calls.priorAudits, [["user-1", 2]]);
  const data = auditData(calls.params[0]);
  assert.equal(data.is_welcome_audit, true);
  assert.equal(data.prior_audit, null);
  assert.equal(data.earlier_audit, null);
  assert.equal(data.today, "2026-09-24");
  assert.equal("welcome_audit" in data, false);
  assert.equal("prior_audits" in data, false);
});

test("is_welcome_audit follows the user record, as at Completion, not the Prior audit count", async () => {
  const { handler, calls } = setup({
    readEligibilityRecord: async () => returningRecord,
    readPriorAudits: async () => [],
  });
  assert.equal((await handler(post(valid()))).status, 200);
  const data = auditData(calls.params[0]);
  assert.equal(data.is_welcome_audit, false);
  assert.equal(data.prior_audit, null);
});

test("the business profile appears in the data block, read for the caller", async () => {
  const profile = { product: "Invoicing app", stage: "Growing", bottleneck: "Churn", goal_90_day: "Hit 10k MRR" };
  const { handler, calls } = setup({
    readBusinessProfile: async (userId: string) => {
      calls.profiles.push(userId);
      return profile;
    },
  });
  await handler(post(valid()));
  assert.deepEqual(calls.profiles, ["user-1"]);
  assert.deepEqual(auditData(calls.params[0]).business_profile, profile);
});

test("a customer with no profile can still run an audit", async () => {
  const { handler, calls } = setup();
  assert.equal((await handler(post(valid()))).status, 200);
  assert.equal(auditData(calls.params[0]).business_profile, null);
});

test("each business profile field is cut to the cap, and blank fields become null", async () => {
  const cap = BUSINESS_PROFILE_FIELD_MAX_CHARS;
  const { handler, calls } = setup({
    readBusinessProfile: async () => ({
      product: "p".repeat(cap + 50), stage: "s".repeat(cap), bottleneck: "  ", goal_90_day: null,
    }),
  });
  await handler(post(valid()));
  assert.deepEqual(auditData(calls.params[0]).business_profile, {
    product: "p".repeat(cap), stage: "s".repeat(cap), bottleneck: null, goal_90_day: null,
  });
});

test("the prompt block is identical for every caller; only the data block differs", async () => {
  const first = setup();
  const second = setup({
    authenticate: async () => ({ userId: "user-2" }),
    readEligibilityRecord: async () => returningRecord,
    readPriorAudits: async () => [priorRow("2026-05-01T09:00:00.000Z", "2026-06-30")],
    readBusinessProfile: async () => ({ product: "x", stage: "y", bottleneck: "z", goal_90_day: "w" }),
  });
  await first.handler(post(valid()));
  await second.handler(post(valid([{ role: "assistant", content: "Hi" }, { role: "user", content: "Hello" }])));
  const [a, b] = [first.calls.params[0].system, second.calls.params[0].system];
  assert.deepEqual(a[0], { type: "text", text: PROMPT, cache_control: { type: "ephemeral" } });
  assert.deepEqual(b[0], a[0]);
  assert.notEqual(a[1].text, b[1].text);
});

test("the Audit intake appears in the data block", async () => {
  const { handler, calls } = setup();
  await handler(post(valid()));
  assert.deepEqual(auditData(calls.params[0]).audit_intake, intake);
});

test("one Prior audit becomes prior_audit with its Verdict, Baseline and deadline flag", async () => {
  const row = priorRow("2026-05-01T09:00:00.000Z", "2026-06-30");
  const { handler, calls } = setup({
    readEligibilityRecord: async () => returningRecord,
    readPriorAudits: async () => [row],
  });
  const response = await handler(post(valid()));
  assert.equal(response.status, 200);
  const data = auditData(calls.params[0]);
  assert.equal(data.is_welcome_audit, false);
  assert.deepEqual(data.prior_audit, {
    completed_on: "2026-05-01",
    verdict: { action: "raise", number: "59", deadline: "2026-06-30", reasoning: "Reasoning from 2026-05-01T09:00:00.000Z." },
    baseline: row.baseline,
    deadline_passed: true,
  });
  assert.equal(data.earlier_audit, null);
});

test("two Prior audits: the newest is prior_audit, the one before it is earlier_audit", async () => {
  const newer = priorRow("2026-05-01T09:00:00.000Z", "2026-09-24");
  const older = priorRow("2026-01-15T09:00:00.000Z", null, "hold");
  const { handler, calls } = setup({
    readEligibilityRecord: async () => returningRecord,
    readPriorAudits: async () => [newer, older],
  });
  await handler(post(valid()));
  const data = auditData(calls.params[0]);
  assert.equal(data.prior_audit.completed_on, "2026-05-01");
  assert.equal(data.earlier_audit.completed_on, "2026-01-15");
  assert.equal(data.prior_audit.deadline_passed, false, "the deadline day itself has not passed");
  assert.equal(data.earlier_audit.deadline_passed, null, "a hold has no deadline");
  assert.equal(data.earlier_audit.verdict.number, null);
});

test("a Prior audit whose deadline is tomorrow has not passed", async () => {
  const { handler, calls } = setup({
    readEligibilityRecord: async () => returningRecord,
    readPriorAudits: async () => [priorRow("2026-05-01T09:00:00.000Z", "2026-09-25")],
  });
  await handler(post(valid()));
  assert.equal(auditData(calls.params[0]).prior_audit.deadline_passed, false);
});

const invalidBodies: Record<string, unknown> = {
  "non-JSON body": "{not json",
  "array body": [],
  "missing session_id": { audit_intake: intake, messages: [] },
  "non-UUID session_id": { ...valid(), session_id: "abc" },
  "missing intake": { session_id: sessionId, messages: [] },
  "intake with an extra field": { ...valid(), audit_intake: { ...intake, plan: "x" } },
  "intake missing a field": { ...valid(), audit_intake: { ...intake, churn_rate: undefined } },
  "intake number as a string": { ...valid(), audit_intake: { ...intake, mrr: "4200" } },
  "negative intake number": { ...valid(), audit_intake: { ...intake, customer_count: -1 } },
  "fractional customer count": { ...valid(), audit_intake: { ...intake, customer_count: 3.5 } },
  "blank intake text": { ...valid(), audit_intake: { ...intake, current_pricing: "  " } },
  "messages not an array": { ...valid(), messages: "hi" },
  "unknown role": valid([{ role: "system", content: "x" }, { role: "user", content: "y" }]),
  "history starting with the user": valid([{ role: "user", content: "hi" }]),
  "roles not alternating": valid([
    { role: "assistant", content: "a" }, { role: "assistant", content: "b" }, { role: "user", content: "c" },
  ]),
  "last turn from Marcus": valid([
    { role: "assistant", content: "a" }, { role: "user", content: "b" }, { role: "assistant", content: "c" },
  ]),
  "blank message": valid([{ role: "assistant", content: "a" }, { role: "user", content: "  " }]),
  "non-string content": valid([{ role: "assistant", content: "a" }, { role: "user", content: [{ type: "text" }] }]),
};

for (const [label, body] of Object.entries(invalidBodies)) {
  test(`invalid_request: ${label}`, async () => {
    const { handler, calls } = setup();
    await expectReason(await handler(post(body)), 400, { reason: "invalid_request" });
    assert.equal(calls.params.length, 0);
  });
}

const pairs = (count: number, content = "x") => Array.from({ length: count }, (_, i) =>
  ({ role: i % 2 === 0 ? "assistant" : "user", content }));

test("audit_too_long: more messages than the cap", async () => {
  const { handler, calls } = setup({
    loadConfig: () => ({ ...AUDIT_CHAT_DEFAULTS, prompt: PROMPT, maxMessages: 4 }),
  });
  assert.equal((await handler(post(valid(pairs(4))))).status, 200);
  await expectReason(await handler(post(valid(pairs(6)))), 413, { reason: "audit_too_long" });
  assert.equal(calls.params.length, 1);
});

test("audit_too_long: one message longer than the per-message cap", async () => {
  const { handler } = setup({
    loadConfig: () => ({ ...AUDIT_CHAT_DEFAULTS, prompt: PROMPT, maxMessageChars: 10 }),
  });
  assert.equal((await handler(post(valid(pairs(2, "x".repeat(10)))))).status, 200);
  await expectReason(await handler(post(valid(pairs(2, "x".repeat(11))))), 413, { reason: "audit_too_long" });
});

test("audit_too_long: the whole transcript longer than the transcript cap", async () => {
  const { handler } = setup({
    loadConfig: () => ({ ...AUDIT_CHAT_DEFAULTS, prompt: PROMPT, maxTranscriptChars: 30 }),
  });
  assert.equal((await handler(post(valid(pairs(4, "x".repeat(7)))))).status, 200);
  await expectReason(await handler(post(valid(pairs(4, "x".repeat(8))))), 413, { reason: "audit_too_long" });
});

test("plan_lapsed: a caller who is not Entitled", async () => {
  const { handler, calls } = setup({
    readEligibilityRecord: async () => ({ ...welcomeRecord, status: "past_due" }),
  });
  await expectReason(await handler(post(valid())), 403, { reason: "plan_lapsed" });
  assert.equal(calls.params.length, 0);
});

test("gated: a caller inside the Cooldown gets the next eligible date", async () => {
  const { handler, calls } = setup({
    readEligibilityRecord: async () => ({
      ...returningRecord, last_audit_completed_at: "2026-08-01T09:30:00.000Z",
    }),
  });
  await expectReason(await handler(post(valid())), 403, { reason: "gated", next_eligible_date: "2026-10-30" });
  assert.equal(calls.params.length, 0);
});

test("session_conflict: the session ID already belongs to a session", async () => {
  const { handler, calls } = setup({ sessionExists: async () => true });
  await expectReason(
    await handler(post({ ...valid(), session_id: sessionId.toUpperCase() })), 409, { reason: "session_conflict" },
  );
  assert.equal(calls.params.length, 0);
});

test("the session check uses the normalized session ID", async () => {
  const { handler, calls } = setup();
  await handler(post({ ...valid(), session_id: sessionId.toUpperCase() }));
  assert.deepEqual(calls.sessions, [sessionId]);
});

const unavailable: Record<string, () => Promise<unknown>> = {
  "an API error": async () => {
    throw Object.assign(new Error("529 overloaded"), { status: 529 });
  },
  "a timeout": async () => {
    throw Object.assign(new Error("Request timed out."), { name: "APIConnectionTimeoutError" });
  },
  "a refusal": async () => rawMessage([thinking], "refusal", {
    stop_details: { type: "refusal", category: "cyber", explanation: "declined" },
  }),
  "a reply cut off at max_tokens": async () => rawMessage([thinking, text("Half a")], "max_tokens"),
  "a reply with no text": async () => rawMessage([thinking]),
};

for (const [label, createMessage] of Object.entries(unavailable)) {
  test(`ai_unavailable: ${label}`, async () => {
    const { handler, calls } = setup({ createMessage });
    await expectReason(await handler(post(valid())), 503, { reason: "ai_unavailable" });
    assert.ok(calls.logs.length > 0, "the cause is logged");
  });
}

const internal: Record<string, Record<string, unknown>> = {
  "a missing audit prompt": { loadConfig: () => ({ ...AUDIT_CHAT_DEFAULTS, prompt: "" }) },
  "a blank audit prompt": { loadConfig: () => ({ ...AUDIT_CHAT_DEFAULTS, prompt: " \n " }) },
  "invalid configuration": { loadConfig: () => { throw new Error("AUDIT_CHAT_MAX_MESSAGES must be a positive integer"); } },
  "a failed eligibility read": { readEligibilityRecord: async () => { throw new Error("sensitive db detail"); } },
  "a missing user record": { readEligibilityRecord: async () => null },
  "an inconsistent audit state": {
    readEligibilityRecord: async () => ({ ...welcomeRecord, welcome_audit_used: true }),
  },
  "a failed session check": { sessionExists: async () => { throw new Error("sensitive db detail"); } },
  "a failed Prior audit read": { readPriorAudits: async () => { throw new Error("sensitive db detail"); } },
  "a failed business profile read": { readBusinessProfile: async () => { throw new Error("sensitive db detail"); } },
};

for (const [label, overrides] of Object.entries(internal)) {
  test(`internal_error: ${label}`, async () => {
    const { handler, calls } = setup(overrides);
    await expectReason(await handler(post(valid())), 500, { reason: "internal_error" });
    assert.equal(calls.params.length, 0);
    assert.ok(calls.logs.length > 0, "the cause is logged");
  });
}

test("an unauthenticated caller is refused before any read", async () => {
  const { handler } = setup({
    authenticate: async () => null,
    readEligibilityRecord: async () => {
      throw new Error("must not read before authentication");
    },
  });
  await expectReason(await handler(post(valid())), 401, { reason: "unauthorized" });
});

test("an unsupported method is refused", async () => {
  const { handler } = setup();
  await expectReason(await handler(new Request("http://localhost/", { method: "GET" })), 405, {
    reason: "invalid_request",
  });
});

test("the audit prompt never appears in logs, whatever fails", async () => {
  const logged: unknown[] = [];
  const failures: Record<string, unknown>[] = [
    ...Object.values(internal).filter((o) => !("loadConfig" in o)),
    ...Object.values(unavailable).map((createMessage) => ({ createMessage })),
    {
      createMessage: async (params: any) => {
        throw new Error(`echo ${JSON.stringify(params).length}`);
      },
    },
  ];
  for (const overrides of failures) {
    const { handler, calls } = setup(overrides);
    await handler(post(valid()));
    logged.push(...calls.logs);
  }
  const text = logged.map((entry) => JSON.stringify(entry, (_, v) => v instanceof Error ? v.message : v)).join("\n");
  assert.ok(logged.length >= failures.length);
  assert.equal(text.includes("TEST-AUDIT-PROMPT-MARKER"), false);
});
