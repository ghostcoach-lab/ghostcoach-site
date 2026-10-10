import assert from "node:assert/strict";
import test from "node:test";

import { createMarcusChatEntryHandler } from "../../supabase/functions/marcus-chat/entry.ts";
import { createMarcusChatHandler } from "../../supabase/functions/marcus-chat/handler.ts";
import { renderMarcusChatPrompt } from "../../supabase/functions/marcus-chat/prompt.ts";

const DUMMY_TEMPLATE = "Coach {{first_name}} of {{product}} at {{stage}} toward {{goal_90_day}} ({{goal_progress}}).{{session_history}}{{audit_block}}";

function setup(overrides: Record<string, unknown> = {}) {
  const calls: { model: unknown[]; hashes: string[]; logs: unknown[][] } = {
    model: [], hashes: [], logs: [],
  };
  const handler = createMarcusChatHandler({
    authenticate: async () => ({ userId: "user-1" }),
    readRecentSessions: async () => [],
    readAudits: async () => [],
    now: () => new Date("2026-10-10T09:00:00.000Z"),
    loadPromptTemplate: () => DUMMY_TEMPLATE,
    createMessage: async (params: unknown) => {
      calls.model.push(params);
      return { content: [{ type: "text", text: "Welcome." }] };
    },
    hashPrompt: async (prompt: string) => {
      calls.hashes.push(prompt);
      return "prompt-hash";
    },
    log: (...args: unknown[]) => calls.logs.push(args),
    ...overrides,
  } as any);
  return { handler, calls };
}

function post(body: unknown) {
  return new Request("http://localhost/functions/v1/marcus-chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("entry preflight bypasses configuration and client construction", async () => {
  const entry = createMarcusChatEntryHandler({
    createHandler: () => {
      throw new Error("configuration must not load for preflight");
    },
    logError: () => {
      throw new Error("preflight must not log an error");
    },
  });

  const response = await entry(new Request(
    "http://localhost/functions/v1/marcus-chat",
    { method: "OPTIONS" },
  ));

  assert.equal(response.status, 200);
  assert.equal(await response.text(), "ok");
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  assert.equal(response.headers.get("access-control-allow-headers"), "authorization, content-type");
});

test("entry setup failures return JSON 500 with the deployed CORS headers", async () => {
  const logs: unknown[][] = [];
  const entry = createMarcusChatEntryHandler({
    createHandler: () => {
      throw new Error("SUPABASE_URL is missing or blank");
    },
    logError: (...args: unknown[]) => logs.push(args),
  });

  const response = await entry(post({ messages: [], profile: {}, session_id: "session-1" }));

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "SUPABASE_URL is missing or blank" });
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  assert.equal(response.headers.get("access-control-allow-headers"), "authorization, content-type");
  assert.equal(response.headers.get("content-type"), "application/json");
  assert.equal(logs.length, 1);
});

test("the prompt renderer inserts values literally in one pass", () => {
  const rendered = renderMarcusChatPrompt(
    "{{first_name}}|{{product}}|{{stage}}|{{goal_90_day}}|{{goal_progress}}|{{session_history}}|{{audit_block}}",
    {
      first_name: "Ari $& $1 {{product}} \"quoted\"",
      product: "Billing {{first_name}}",
      stage: "Growing",
      goal_90_day: "Reach $10k MRR",
      goal_progress: "42%",
      session_history: "\nHistory",
      audit_block: "",
    },
  );

  assert.equal(
    rendered,
    "Ari $& $1 {{product}} \"quoted\"|Billing {{first_name}}|Growing|Reach $10k MRR|42%|\nHistory|",
  );
});

test("the prompt renderer rejects an unknown placeholder", () => {
  assert.throws(
    () => renderMarcusChatPrompt("Hello {{unknown}}", {
      first_name: "Ari",
      product: "Billing",
      stage: "Growing",
      goal_90_day: "Reach 10k MRR",
      goal_progress: "42%",
      session_history: "",
      audit_block: "",
    }),
    /unknown placeholder: unknown/,
  );
});

for (const placeholder of ["{{First_Name}}", "{{first-name}}", "{{ first_name }}"]) {
  test(`the prompt renderer rejects malformed placeholder ${placeholder}`, () => {
    assert.throws(
      () => renderMarcusChatPrompt(`Hello ${placeholder}`, {
        first_name: "Ari",
        product: "Billing",
        stage: "Growing",
        goal_90_day: "Reach 10k MRR",
        goal_progress: "42%",
        session_history: "",
        audit_block: "",
      }),
      /unknown placeholder/,
    );
  });
}

test("the dummy prompt matches deployed interpolation across founder shapes", () => {
  const template = [
    "FOUNDER={{first_name}}",
    "PRODUCT={{product}}",
    "STAGE={{stage}}",
    "GOAL={{goal_90_day}}",
    "PROGRESS={{goal_progress}}",
    "HISTORY={{session_history}}",
    "AUDIT={{audit_block}}",
  ].join("\n");
  const shapes = [
    {
      first_name: "the founder", product: "unknown", stage: "unknown",
      goal_90_day: "not set yet", goal_progress: 0, session_history: "", audit_block: "",
    },
    {
      first_name: "Nia", product: "Analytics", stage: "Early",
      goal_90_day: "Find fit", goal_progress: 10, session_history: "", audit_block: "",
    },
    {
      first_name: "Omar", product: "CRM", stage: "Growing",
      goal_90_day: "Reach 20k", goal_progress: 65,
      session_history: "\n\nPREVIOUS SESSIONS (most recent first):\n"
        + `Session 6 (2026-10-06): ${"Latest long summary ".repeat(100).trim()}. Action committed: Publish Friday.\n`
        + `Session 4 (2026-09-20): ${"Middle long summary ".repeat(100).trim()}.\n`
        + `Session 2 (2026-09-01): ${"Earlier long summary ".repeat(100).trim()}.`,
      audit_block: "",
    },
    {
      first_name: "Ari \"$&\" {{product}}", product: "L'équipe $1", stage: "Scale",
      goal_90_day: "Ship 'Plus'", goal_progress: 99, session_history: "\nHistory", audit_block: "",
    },
  ];

  for (const values of shapes) {
    const deployedReference = `FOUNDER=${values.first_name}\nPRODUCT=${values.product}\nSTAGE=${values.stage}\nGOAL=${values.goal_90_day}\nPROGRESS=${values.goal_progress}\nHISTORY=${values.session_history}\nAUDIT=${values.audit_block}`;
    assert.equal(renderMarcusChatPrompt(template, values), deployedReference);
  }
});

test("an unauthenticated caller receives the deployed 401 response", async () => {
  const handler = createMarcusChatHandler({
    authenticate: async () => null,
  } as any);

  const response = await handler(new Request(
    "http://localhost/functions/v1/marcus-chat",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [], profile: {}, session_id: "session-1" }),
    },
  ));

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "Unauthorised" });
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
});

test("an authentication failure preserves the deployed 500 response", async () => {
  const { handler } = setup({
    authenticate: async () => {
      throw new Error("authentication unavailable");
    },
  });

  const response = await handler(post({ messages: [], profile: {}, session_id: "session-1" }));

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "authentication unavailable" });
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  assert.equal(response.headers.get("content-type"), "application/json");
});

test("a browser preflight succeeds without authentication", async () => {
  const { handler } = setup({
    authenticate: async () => {
      throw new Error("preflight must not authenticate");
    },
  });

  const response = await handler(new Request(
    "http://localhost/functions/v1/marcus-chat",
    { method: "OPTIONS" },
  ));

  assert.equal(response.status, 200);
  assert.equal(await response.text(), "ok");
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
});

test("an empty conversation preserves the deployed model request and opening turn", async () => {
  const { handler, calls } = setup();
  const response = await handler(post({
    messages: [],
    profile: {
      firstname: "Mina",
      product: "Ledger",
      stage: "Growing",
      goal_90_day: "Reach 10k MRR",
      goal_progress: "42%",
    },
    session_id: "session-1",
  }));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { reply: "Welcome." });
  assert.equal(calls.model.length, 1);
  assert.deepEqual(calls.model[0], {
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    system: "Coach Mina of Ledger at Growing toward Reach 10k MRR (42%).",
    messages: [{
      role: "user",
      content: "(New session starting. Greet me and ask your one diagnostic question, per your instructions.)",
    }],
  });
});

test("a conversation not starting with a user turn gets the deployed opening turn prepended", async () => {
  const { handler, calls } = setup();
  const supplied = [
    { role: "assistant", content: "What are you building?" },
    { role: "user", content: "A billing tool." },
  ];

  await handler(post({ messages: supplied, profile: {}, session_id: "session-1" }));

  assert.deepEqual((calls.model[0] as any).messages, [
    {
      role: "user",
      content: "(New session starting. Greet me and ask your one diagnostic question, per your instructions.)",
    },
    ...supplied,
  ]);
});

test("profile defaults use nullish semantics so an empty string stays empty", async () => {
  const { handler, calls } = setup();

  await handler(post({
    messages: [],
    profile: { product: "" },
    session_id: "session-1",
  }));

  assert.equal(
    (calls.model[0] as any).system,
    "Coach the founder of  at unknown toward not set yet (0).",
  );
});

test("an omitted profile uses the deployed defaults", async () => {
  const { handler, calls } = setup();

  const response = await handler(post({ messages: [], session_id: "session-1" }));

  assert.equal(response.status, 200);
  assert.equal(
    (calls.model[0] as any).system,
    "Coach the founder of unknown at unknown toward not set yet (0).",
  );
});

test("coaching history keeps stored session numbers and gaps", async () => {
  const { handler, calls } = setup({
    readRecentSessions: async () => [
      {
        session_number: 6,
        summary: "Validated the annual plan",
        action_committed: "Publish it Friday",
        created_at: "2026-10-06T12:00:00.000Z",
        is_pricing_audit: false,
      },
      {
        session_number: 4,
        summary: "Chose the retention segment",
        action_committed: null,
        created_at: "2026-09-20T12:00:00.000Z",
        is_pricing_audit: false,
      },
    ],
  });

  await handler(post({ messages: [], profile: {}, session_id: "session-7" }));

  assert.equal(
    (calls.model[0] as any).system,
    "Coach the founder of unknown at unknown toward not set yet (0)."
      + "\n\nPREVIOUS SESSIONS (most recent first):\n"
      + "Session 6 (2026-10-06): Validated the annual plan. Action committed: Publish it Friday.\n"
      + "Session 4 (2026-09-20): Chose the retention segment.",
  );
});

test("a Pricing audit with a summary is excluded from coaching history", async () => {
  const { handler, calls } = setup({
    readRecentSessions: async () => [
      {
        session_number: 5,
        summary: "PRIVATE AUDIT SUMMARY MARKER",
        action_committed: "Raise prices",
        created_at: "2026-10-03T12:00:00.000Z",
        is_pricing_audit: true,
      },
      {
        session_number: 4,
        summary: "Ordinary coaching summary",
        action_committed: null,
        created_at: "2026-09-20T12:00:00.000Z",
        is_pricing_audit: false,
      },
    ],
  });

  await handler(post({ messages: [], profile: {}, session_id: "session-6" }));

  const system = (calls.model[0] as any).system as string;
  assert.equal(system.includes("PRIVATE AUDIT SUMMARY MARKER"), false);
  assert.match(system, /Session 4 .*Ordinary coaching summary/);
});

test("a founder whose only earlier session is a Pricing audit has no coaching history block", async () => {
  const { handler, calls } = setup({
    readRecentSessions: async () => [{
      session_number: 1,
      summary: "Audit summary",
      action_committed: null,
      created_at: "2026-10-03T12:00:00.000Z",
      is_pricing_audit: true,
    }],
  });

  await handler(post({ messages: [], profile: {}, session_id: "session-2" }));

  const system = (calls.model[0] as any).system as string;
  assert.equal(system.includes("PREVIOUS SESSIONS"), false);
  assert.equal(system, "Coach the founder of unknown at unknown toward not set yet (0).");
});

for (const [label, template] of [["missing", undefined], ["blank", " \n "]] as const) {
  test(`${label} prompt template fails closed before the Anthropic call`, async () => {
    const { handler, calls } = setup({ loadPromptTemplate: () => template });

    const response = await handler(post({ messages: [], profile: {}, session_id: "session-1" }));

    assert.equal(response.status, 500);
    assert.equal(calls.model.length, 0);
    assert.ok(calls.logs.length > 0, "the configuration problem is logged");
    assert.equal(JSON.stringify(calls.logs).includes(DUMMY_TEMPLATE), false);
  });
}

test("a successful call logs only the rendered prompt hash and audit-block flag", async () => {
  const { handler, calls } = setup();

  await handler(post({ messages: [], profile: {}, session_id: "session-1" }));

  assert.deepEqual(calls.hashes, [
    "Coach the founder of unknown at unknown toward not set yet (0).",
  ]);
  assert.deepEqual(calls.logs, [[
    "marcus-chat: prompt",
    { sha256: "prompt-hash", audit_block: false },
  ]]);
  assert.equal(JSON.stringify(calls.logs).includes("Coach the founder"), false);
});
