import assert from "node:assert/strict";
import test from "node:test";

import { createPricingAuditCompleteHandler } from "../../supabase/functions/pricing-audit-complete/handler.ts";
import { AUDIT_COMPLETE_DEFAULTS } from "../../supabase/functions/pricing-audit-complete/config.ts";

const sessionId = "3f0c2a4e-8b1d-4c6f-9a2e-5d7b1c0e9f41";
const intake = {
  mrr: 4200,
  customer_count: 37,
  churn_rate: 4.5,
  current_pricing: "Two tiers: 49 and 99 per month.",
  last_pricing_change: "Raised the starter tier in March.",
};
const conversation = [
  { role: "assistant", content: "What do you charge today?" },
  { role: "user", content: "49 and 99 a month." },
  { role: "assistant", content: "Raise the starter tier to 59 by 1 November. People buy it for the time it saves." },
];
const baseline = {
  value_anchor: "Time saved on reporting",
  friction_read: "Low friction at checkout",
  mix: "Mostly solo founders",
  churn_window: "Month two",
};
const extraction = {
  verdict_found: true,
  action: "raise",
  number: "59 per month",
  deadline: "2026-11-01",
  reasoning: "Customers buy it for the time it saves.",
  baseline,
};

function rawMessage(content: unknown[], stop_reason = "end_turn", extra: object = {}) {
  return {
    id: "msg_fixture", type: "message", role: "assistant", model: "claude-opus-5-5", content,
    stop_reason, stop_sequence: null, stop_details: null, usage: { input_tokens: 10, output_tokens: 10 },
    ...extra,
  };
}
const thinking = { type: "thinking", thinking: "", signature: "fixture-signature" };
const jsonReply = (value: unknown) => rawMessage([thinking, { type: "text", text: JSON.stringify(value), citations: null }]);

const completedRow = {
  audit_id: "9d1f7a52-6a0e-4b8e-9d0c-1a2b3c4d5e6f",
  status: "completed",
  is_welcome_audit: true,
  verdict_action: "raise",
  verdict_number: "59 per month",
  verdict_deadline: "2026-11-01",
  verdict_reasoning: "Customers buy it for the time it saves.",
  next_eligible_date: "2026-12-23",
};

const newSession = {
  audit_id: null, status: "new", is_welcome_audit: null, verdict_action: null, verdict_number: null,
  verdict_deadline: null, verdict_reasoning: null, next_eligible_date: null,
};
const welcomeRecord = {
  plan: "operator", status: "active", trial_end: null, welcome_audit_used: false, last_audit_completed_at: null,
};

const recapTarget = { url: "https://recap.example.test/webhook/recap", secret: "recap-test-secret" };
const recipient = { email: "founder@example.test", firstName: "Sam" };

function setup(overrides: Record<string, unknown> = {}, reply: unknown = extraction) {
  const calls: {
    params: any[]; rpc: any[]; logs: unknown[][]; lookups: unknown[][];
    recaps: { target: unknown; payload: unknown }[]; recorded: unknown[][];
  } = {
    params: [], rpc: [], logs: [], lookups: [], recaps: [], recorded: [],
  };
  const handler = createPricingAuditCompleteHandler({
    authenticate: async () => ({ userId: "user-1" }),
    lookupSession: async (...args: unknown[]) => {
      calls.lookups.push(args);
      return newSession;
    },
    readEligibilityRecord: async () => welcomeRecord,
    createMessage: async (params: unknown) => {
      calls.params.push(params);
      return jsonReply(reply);
    },
    completeAudit: async (input: unknown) => {
      calls.rpc.push(input);
      return completedRow;
    },
    readRecipient: async () => recipient,
    postRecap: async (target: unknown, payload: unknown) => {
      calls.recaps.push({ target, payload });
      return new Response('{"sent":true}', { status: 200 });
    },
    recordRecapSent: async (...args: unknown[]) => {
      calls.recorded.push(args);
    },
    loadConfig: () => ({ ...AUDIT_COMPLETE_DEFAULTS, recap: recapTarget }),
    now: () => new Date("2026-09-24T12:00:00.000Z"),
    logError: (...args: unknown[]) => calls.logs.push(args),
    ...overrides,
  } as any);
  return { handler, calls };
}

function post(body: unknown) {
  return new Request("http://localhost/functions/v1/pricing-audit-complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const valid = (messages: unknown[] = conversation) => ({ session_id: sessionId, audit_intake: intake, messages });

async function expectReason(response: Response, status: number, reason: string) {
  assert.equal(response.status, status);
  assert.deepEqual(await response.json(), { reason });
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
});

test("a Welcome audit is extracted, recorded and returned", async () => {
  const { handler, calls } = setup();
  const response = await handler(post(valid()));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    status: "completed",
    audit_id: completedRow.audit_id,
    is_welcome_audit: true,
    verdict: {
      action: "raise",
      number: "59 per month",
      deadline: "2026-11-01",
      reasoning: "Customers buy it for the time it saves.",
    },
    next_eligible_date: "2026-12-23",
  });
  assert.deepEqual(calls.rpc, [{
    userId: "user-1",
    sessionId,
    transcript:
      "Marcus: What do you charge today?\n\nFounder: 49 and 99 a month.\n\n" +
      "Marcus: Raise the starter tier to 59 by 1 November. People buy it for the time it saves.",
    auditIntake: intake,
    verdict: {
      action: "raise",
      number: "59 per month",
      deadline: "2026-11-01",
      reasoning: "Customers buy it for the time it saves.",
    },
    baseline,
  }]);
});

test("extraction uses the configured model with effort set explicitly and a structured output format", async () => {
  const { handler, calls } = setup();
  await handler(post(valid()));
  assert.equal(calls.params.length, 1);
  const params = calls.params[0];
  assert.equal(params.model, "claude-opus-5-5");
  assert.equal(params.output_config.effort, "low");
  assert.equal(params.output_config.format.type, "json_schema");
  assert.equal(params.output_config.format.schema.additionalProperties, false);
  assert.equal("thinking" in params, false);
  assert.equal("tools" in params || "tool_choice" in params, false);
  assert.equal(params.messages.length, 1);
  const content = params.messages[0].content as string;
  assert.match(content, /2026-09-24/, "the completion date anchors relative deadlines");
  assert.match(content, /Founder: 49 and 99 a month\./);
});

test("client-sent Verdict, Baseline and Welcome audit flag are ignored", async () => {
  const { handler, calls } = setup();
  const response = await handler(post({
    ...valid(),
    is_welcome_audit: false,
    verdict: { action: "hold", number: null, deadline: "2026-10-01", reasoning: "forged" },
    baseline: { value_anchor: "forged" },
    user_id: "someone-else",
  }));
  assert.equal(response.status, 200);
  assert.equal(calls.rpc[0].userId, "user-1");
  assert.equal(calls.rpc[0].verdict.action, "raise");
  assert.deepEqual(calls.rpc[0].baseline, baseline);
});

test("extracted values are trimmed before they are recorded", async () => {
  const { handler, calls } = setup({}, {
    ...extraction,
    number: "  59 per month ",
    reasoning: " Customers buy it for the time it saves.\n",
    baseline: { ...baseline, mix: "  Mostly solo founders " },
  });
  assert.equal((await handler(post(valid()))).status, 200);
  assert.equal(calls.rpc[0].verdict.number, "59 per month");
  assert.equal(calls.rpc[0].verdict.reasoning, "Customers buy it for the time it saves.");
  assert.equal(calls.rpc[0].baseline.mix, "Mostly solo founders");
});

test("a hold is recorded with no number", async () => {
  const { handler, calls } = setup({}, { ...extraction, action: "hold", number: null });
  assert.equal((await handler(post(valid()))).status, 200);
  assert.equal(calls.rpc[0].verdict.number, null);
});

const invalidExtractions: Record<string, unknown> = {
  "no verdict": { ...extraction, verdict_found: false },
  "an action outside the set": { ...extraction, action: "lower" },
  "a raise without a number": { ...extraction, number: null },
  "a restructure with a blank number": { ...extraction, action: "restructure", number: "  " },
  "a hold with a number": { ...extraction, action: "hold", number: "49" },
  "a missing deadline": { ...extraction, deadline: null },
  "a deadline that is not a date": { ...extraction, deadline: "soon" },
  "a deadline in month 13": { ...extraction, deadline: "2026-13-01" },
  "30 February": { ...extraction, deadline: "2027-02-30" },
  "a deadline on the completion date": { ...extraction, deadline: "2026-09-24" },
  "a deadline before the completion date": { ...extraction, deadline: "2026-09-01" },
  "a deadline one year and one day out": { ...extraction, deadline: "2027-09-25" },
  "blank reasoning": { ...extraction, reasoning: " " },
  "a Baseline missing a key": { ...extraction, baseline: { ...baseline, mix: undefined } },
  "a Baseline with an extra key": { ...extraction, baseline: { ...baseline, notes: "x" } },
  "a blank Baseline value": { ...extraction, baseline: { ...baseline, churn_window: "" } },
  "a Baseline that is not an object": { ...extraction, baseline: null },
  "a result that is not an object": ["raise"],
};

for (const [label, reply] of Object.entries(invalidExtractions)) {
  test(`extraction_incomplete: ${label}`, async () => {
    const { handler, calls } = setup({}, reply);
    await expectReason(await handler(post(valid())), 422, "extraction_incomplete");
    assert.equal(calls.rpc.length, 0, "nothing is written");
  });
}

test("extraction_incomplete: a reply that is not JSON", async () => {
  const { handler, calls } = setup({
    createMessage: async () => rawMessage([thinking, { type: "text", text: "Raise to 59.", citations: null }]),
  });
  await expectReason(await handler(post(valid())), 422, "extraction_incomplete");
  assert.equal(calls.rpc.length, 0);
});

test("a deadline exactly one year out is accepted", async () => {
  const { handler } = setup({}, { ...extraction, deadline: "2027-09-24" });
  assert.equal((await handler(post(valid()))).status, 200);
});

test("from 29 February the one-year limit is 28 February", async () => {
  const leapDay = { now: () => new Date("2028-02-29T08:00:00.000Z") };
  assert.equal((await setup(leapDay, { ...extraction, deadline: "2029-02-28" }).handler(post(valid()))).status, 200);
  await expectReason(
    await setup(leapDay, { ...extraction, deadline: "2029-03-01" }).handler(post(valid())), 422, "extraction_incomplete",
  );
});

const invalidBodies: Record<string, unknown> = {
  "non-JSON body": "{nope",
  "non-UUID session_id": { ...valid(), session_id: "abc" },
  "a bad intake": { ...valid(), audit_intake: { ...intake, mrr: "lots" } },
  "an empty conversation": valid([]),
  "a conversation ending with the customer": valid(conversation.slice(0, 2)),
  "a conversation starting with the customer": valid([{ role: "user", content: "hi" }, ...conversation]),
};

for (const [label, body] of Object.entries(invalidBodies)) {
  test(`invalid_request: ${label}`, async () => {
    const { handler, calls } = setup();
    await expectReason(await handler(post(body)), 400, "invalid_request");
    assert.equal(calls.params.length, 0);
    assert.equal(calls.rpc.length, 0);
  });
}

test("audit_too_long: a transcript over the configured cap", async () => {
  const total = conversation.reduce((sum, m) => sum + m.content.length, 0);
  const capped = (cap: number) => setup({ loadConfig: () => ({ ...AUDIT_COMPLETE_DEFAULTS, maxTranscriptChars: cap }) });
  assert.equal((await capped(total).handler(post(valid()))).status, 200);
  const { handler, calls } = capped(total - 1);
  await expectReason(await handler(post(valid())), 413, "audit_too_long");
  assert.equal(calls.params.length, 0);
});

test("ai_unavailable: the extraction call fails", async () => {
  const { handler, calls } = setup({
    createMessage: async () => {
      throw Object.assign(new Error("529 overloaded"), { status: 529 });
    },
  });
  await expectReason(await handler(post(valid())), 503, "ai_unavailable");
  assert.equal(calls.rpc.length, 0);
});

test("ai_unavailable: the model refuses", async () => {
  const { handler, calls } = setup({
    createMessage: async () => rawMessage([thinking], "refusal", {
      stop_details: { type: "refusal", category: null, explanation: "declined" },
    }),
  });
  await expectReason(await handler(post(valid())), 503, "ai_unavailable");
  assert.equal(calls.rpc.length, 0);
});

test("internal_error: the Completion RPC fails", async () => {
  const { handler, calls } = setup({
    completeAudit: async () => {
      throw new Error("sensitive database detail");
    },
  });
  await expectReason(await handler(post(valid())), 500, "internal_error");
  assert.ok(calls.logs.length > 0);
});

test("extraction_incomplete: the RPC finds the deadline outside its own completion date's window", async () => {
  const { handler } = setup({
    completeAudit: async () => {
      throw Object.assign(new Error("deadline out of range"), { code: "22023" });
    },
  });
  await expectReason(await handler(post(valid())), 422, "extraction_incomplete");
});

test("internal_error: invalid configuration", async () => {
  const { handler, calls } = setup({
    loadConfig: () => {
      throw new Error("AUDIT_COMPLETE_MAX_TRANSCRIPT_CHARS must be a positive integer");
    },
  });
  await expectReason(await handler(post(valid())), 500, "internal_error");
  assert.equal(calls.params.length, 0);
});

test("an unauthenticated caller is refused before any work", async () => {
  const { handler, calls } = setup({ authenticate: async () => null });
  await expectReason(await handler(post(valid())), 401, "unauthorized");
  assert.equal(calls.params.length, 0);
});

// Refusals and retries (#12).

const savedRow = {
  ...completedRow,
  status: "already_completed",
  verdict_action: "hold",
  verdict_number: null,
  verdict_deadline: "2026-10-15",
  verdict_reasoning: "The saved Verdict.",
  next_eligible_date: "2026-12-20",
};
const savedBody = {
  status: "already_completed",
  audit_id: savedRow.audit_id,
  is_welcome_audit: true,
  verdict: { action: "hold", number: null, deadline: "2026-10-15", reasoning: "The saved Verdict." },
  next_eligible_date: "2026-12-20",
};
const status = (value: string, extra: object = {}) => ({ ...newSession, status: value, ...extra });

test("already_completed: a replay returns the saved Verdict without extraction or a second record", async () => {
  const { handler, calls } = setup({ lookupSession: async () => savedRow });
  const response = await handler(post(valid()));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), savedBody);
  assert.equal(calls.params.length, 0);
  assert.equal(calls.rpc.length, 0);
});

test("the session lookup uses the caller's ID and the normalized session ID", async () => {
  const { handler, calls } = setup();
  await handler(post({ ...valid(), session_id: sessionId.toUpperCase() }));
  assert.deepEqual(calls.lookups, [["user-1", sessionId]]);
});

// The session-state RPC tells another customer's session and a coaching session apart from a
// new ID (see the contract tests); the handler refuses both before any extraction.
test("session_conflict: the session lookup finds the ID taken, before any extraction", async () => {
  const { handler, calls } = setup({ lookupSession: async () => status("session_conflict") });
  await expectReason(await handler(post(valid())), 409, "session_conflict");
  assert.equal(calls.params.length, 0);
  assert.equal(calls.rpc.length, 0);
});

test("plan_lapsed: the pre-check refuses a customer who isn't Entitled, with no extraction", async () => {
  const { handler, calls } = setup({
    readEligibilityRecord: async () => ({ ...welcomeRecord, plan: "builder" }),
  });
  await expectReason(await handler(post(valid())), 403, "plan_lapsed");
  assert.equal(calls.params.length, 0);
});

test("gated: the pre-check refuses a customer inside the Cooldown, with the next eligible date", async () => {
  const { handler, calls } = setup({
    readEligibilityRecord: async () => ({
      ...welcomeRecord, welcome_audit_used: true, last_audit_completed_at: "2026-08-01T09:30:00.000Z",
    }),
  });
  const response = await handler(post(valid()));
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { reason: "gated", next_eligible_date: "2026-10-30" });
  assert.equal(calls.params.length, 0);
});

test("plan_lapsed: the RPC re-check refuses after a successful extraction", async () => {
  const { handler, calls } = setup({
    completeAudit: async (input: unknown) => {
      calls.rpc.push(input);
      return status("plan_lapsed");
    },
  });
  await expectReason(await handler(post(valid())), 403, "plan_lapsed");
  assert.equal(calls.params.length, 1);
  assert.equal(calls.rpc.length, 1);
});

test("gated: the RPC re-check refuses after a successful extraction", async () => {
  const { handler } = setup({ completeAudit: async () => status("gated", { next_eligible_date: "2026-12-01" }) });
  const response = await handler(post(valid()));
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { reason: "gated", next_eligible_date: "2026-12-01" });
});

test("session_conflict: the RPC finds the session taken after extraction", async () => {
  const { handler } = setup({ completeAudit: async () => status("session_conflict") });
  await expectReason(await handler(post(valid())), 409, "session_conflict");
});

test("already_completed: a concurrent duplicate gets the saved audit from the RPC", async () => {
  const { handler } = setup({ completeAudit: async () => savedRow });
  const response = await handler(post(valid()));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), savedBody);
});

// A Verdict was found but fails validation (blank reasoning), so it is retried once.
const invalidExtraction = { ...extraction, reasoning: "  " };

test("the retry succeeds on the second attempt after an invalid result", async () => {
  const replies = [invalidExtraction, extraction];
  const { handler, calls } = setup({
    createMessage: async (params: unknown) => {
      calls.params.push(params);
      return jsonReply(replies[calls.params.length - 1]);
    },
  });
  assert.equal((await handler(post(valid()))).status, 200);
  assert.equal(calls.params.length, 2);
  assert.equal(calls.rpc.length, 1);
});

test("a reply that is not JSON is retried too", async () => {
  const { handler, calls } = setup({
    createMessage: async (params: unknown) => {
      calls.params.push(params);
      return calls.params.length === 1
        ? rawMessage([thinking, { type: "text", text: "Raise to 59.", citations: null }])
        : jsonReply(extraction);
    },
  });
  assert.equal((await handler(post(valid()))).status, 200);
  assert.equal(calls.params.length, 2);
});

test("extraction_incomplete: the retry is exhausted after exactly two attempts", async () => {
  const { handler, calls } = setup({}, invalidExtraction);
  await expectReason(await handler(post(valid())), 422, "extraction_incomplete");
  assert.equal(calls.params.length, 2);
  assert.equal(calls.rpc.length, 0);
});

test("extraction_incomplete: \"no verdict\" is not retried, so an early attempt costs one call", async () => {
  const { handler, calls } = setup({}, { ...extraction, verdict_found: false });
  await expectReason(await handler(post(valid())), 422, "extraction_incomplete");
  assert.equal(calls.params.length, 1);
  assert.equal(calls.rpc.length, 0);
});

test("ai_unavailable: a timeout, with no retry", async () => {
  const { handler, calls } = setup({
    createMessage: async (params: unknown) => {
      calls.params.push(params);
      throw Object.assign(new Error("Request timed out."), { name: "APIConnectionTimeoutError" });
    },
  });
  await expectReason(await handler(post(valid())), 503, "ai_unavailable");
  assert.equal(calls.params.length, 1);
});

test("ai_unavailable: the second attempt fails after an invalid first result", async () => {
  const { handler, calls } = setup({
    createMessage: async (params: unknown) => {
      calls.params.push(params);
      if (calls.params.length === 1) return jsonReply(invalidExtraction);
      throw Object.assign(new Error("529 overloaded"), { status: 529 });
    },
  });
  await expectReason(await handler(post(valid())), 503, "ai_unavailable");
  assert.equal(calls.params.length, 2);
});

const unexpected: Record<string, Record<string, unknown>> = {
  "a failed session lookup": { lookupSession: async () => { throw new Error("sensitive detail"); } },
  "a failed eligibility read": { readEligibilityRecord: async () => { throw new Error("sensitive detail"); } },
  "a missing customer record": { readEligibilityRecord: async () => null },
  "an inconsistent audit state": {
    readEligibilityRecord: async () => ({ ...welcomeRecord, welcome_audit_used: true }),
  },
  "an unknown RPC status": { completeAudit: async () => status("mystery") },
  "the RPC answering new": { completeAudit: async () => newSession },
  "an RPC gated status without a date": { completeAudit: async () => status("gated") },
  "an unknown session lookup status": { lookupSession: async () => status("mystery") },
};

for (const [label, overrides] of Object.entries(unexpected)) {
  test(`internal_error: ${label}`, async () => {
    const { handler, calls } = setup(overrides);
    await expectReason(await handler(post(valid())), 500, "internal_error");
    assert.ok(calls.logs.length > 0, "the cause is logged");
  });
}

// Recap (#13).

test("recap: a new Completion posts one recap to S12 and records that it was sent", async () => {
  const { handler, calls } = setup();
  assert.equal((await handler(post(valid()))).status, 200);
  assert.deepEqual(calls.recaps, [{
    target: recapTarget,
    payload: {
      audit_id: completedRow.audit_id,
      email: "founder@example.test",
      first_name: "Sam",
      verdict: {
        action: "raise",
        number: "59 per month",
        deadline: "2026-11-01",
        reasoning: "Customers buy it for the time it saves.",
      },
      next_eligible_date: "2026-12-23",
    },
  }]);
  assert.deepEqual(calls.recorded, [["user-1", completedRow.audit_id, "2026-09-24T12:00:00.000Z"]]);
});

test("recap: already_completed never sends a recap, from the lookup or from the RPC", async () => {
  for (const overrides of [{ lookupSession: async () => savedRow }, { completeAudit: async () => savedRow }]) {
    const { handler, calls } = setup(overrides);
    assert.equal((await handler(post(valid()))).status, 200);
    assert.equal(calls.recaps.length, 0);
    assert.equal(calls.recorded.length, 0);
  }
});

test("recap: a non-2xx answer from S12 leaves recap_sent_at null and the customer still gets 200", async () => {
  const { handler, calls } = setup({
    postRecap: async (target: unknown, payload: unknown) => {
      calls.recaps.push({ target, payload });
      return new Response('{"sent":false}', { status: 502 });
    },
  });
  const response = await handler(post(valid()));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, "completed");
  assert.equal(calls.recaps.length, 1);
  assert.equal(calls.recorded.length, 0);
  assert.ok(calls.logs.some(([label]) => String(label).includes("recap")), "the failure is logged");
});

// A fake S12 that never answers, so only the handler's own timeout ends the call.
const hangingRecap = (calls: { recaps: unknown[] }) => (target: unknown, payload: unknown, signal: AbortSignal) => {
  calls.recaps.push({ target, payload });
  return new Promise<Response>((_, reject) => signal.addEventListener("abort", () => reject(signal.reason)));
};

test("recap: a timeout leaves recap_sent_at null and the customer still gets 200", async () => {
  const calls = { recaps: [] as unknown[] };
  const { handler, calls: seen } = setup({
    postRecap: hangingRecap(calls),
    loadConfig: () => ({ ...AUDIT_COMPLETE_DEFAULTS, recap: recapTarget, recapTimeoutMs: 20 }),
  });
  const response = await handler(post(valid()));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, "completed");
  assert.equal(calls.recaps.length, 1);
  assert.equal(seen.recorded.length, 0);
  assert.ok(seen.logs.some(([label]) => String(label).includes("recap")), "the timeout is logged");
});

test("recap: when S12 is not configured, nothing is posted and the customer still gets 200", async () => {
  const { handler, calls } = setup({ loadConfig: () => AUDIT_COMPLETE_DEFAULTS });
  const response = await handler(post(valid()));
  assert.equal(response.status, 200);
  assert.equal(calls.recaps.length, 0);
  assert.equal(calls.recorded.length, 0);
  assert.ok(calls.logs.some(([label]) => String(label).includes("recap")), "the missing configuration is logged");
});

test("recap: a failed recipient read or record write is logged and the customer still gets 200", async () => {
  const failures = [
    { readRecipient: async () => { throw new Error("read failed"); } },
    { recordRecapSent: async () => { throw new Error("write failed"); } },
  ];
  for (const overrides of failures) {
    const { handler, calls } = setup(overrides);
    const response = await handler(post(valid()));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).status, "completed");
    assert.ok(calls.logs.some(([label]) => String(label).includes("recap")), "the failure is logged");
  }
});

// The first name is the customer's own editable profile field, and S12 refuses one over 100 characters.
test("recap: a first name over 100 characters is sent as an empty name, so the recap still goes", async () => {
  const { handler, calls } = setup({ readRecipient: async () => ({ ...recipient, firstName: "S".repeat(101) }) });
  assert.equal((await handler(post(valid()))).status, 200);
  assert.equal((calls.recaps[0].payload as { first_name: string }).first_name, "");
  assert.equal(calls.recorded.length, 1);
});
