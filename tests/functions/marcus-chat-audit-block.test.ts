import assert from "node:assert/strict";
import test from "node:test";

import { latestAudit, renderAuditBlock } from "../../supabase/functions/marcus-chat/audit-block.ts";
import { createMarcusChatHandler } from "../../supabase/functions/marcus-chat/handler.ts";

const DUMMY_TEMPLATE = "Coach {{first_name}}.{{session_history}}{{audit_block}}";
const BASE_PROMPT = "Coach the founder.";
const today = new Date("2026-10-10T09:00:00.000Z");

const audit = {
  verdict_action: "raise",
  verdict_number: "$49/month",
  completed_at: "2026-10-03T23:30:00.000Z",
  verdict_deadline: "2026-11-02",
};

test("no audit renders an empty block", () => {
  assert.equal(renderAuditBlock(null, today), "");
});

test("a raise with a number and a future act-by date", () => {
  assert.equal(
    renderAuditBlock(audit, today),
    "\n\nLATEST PRICING AUDIT (completed 2026-10-03):\nVerdict: raise\nNumber: $49/month\nAct by: 2026-11-02",
  );
});

test("a hold", () => {
  assert.equal(
    renderAuditBlock({ ...audit, verdict_action: "hold", verdict_number: null }, today),
    "\n\nLATEST PRICING AUDIT (completed 2026-10-03):\nVerdict: hold\nNumber: no number\nAct by: 2026-11-02",
  );
});

test("a restructure without a number, null or blank", () => {
  for (const verdict_number of [null, "", "  "]) {
    const block = renderAuditBlock({ ...audit, verdict_action: "restructure", verdict_number }, today);
    assert.ok(block.includes("Verdict: restructure\nNumber: no number\n"), String(verdict_number));
  }
});

test("(passed) appears only when today's UTC date is after the act-by date", () => {
  const actBy = (deadline: string) => renderAuditBlock({ ...audit, verdict_deadline: deadline }, today);
  assert.ok(actBy("2026-10-11").endsWith("Act by: 2026-10-11"), "before");
  assert.ok(actBy("2026-10-10").endsWith("Act by: 2026-10-10"), "on the day");
  assert.ok(actBy("2026-10-09").endsWith("Act by: 2026-10-09 (passed)"), "after");
});

test("the UTC date decides near midnight", () => {
  const lateOnTheDay = new Date("2026-10-10T23:59:59.000Z");
  const justAfter = new Date("2026-10-11T00:00:00.000Z");
  assert.ok(!renderAuditBlock({ ...audit, verdict_deadline: "2026-10-10" }, lateOnTheDay).includes("(passed)"));
  assert.ok(renderAuditBlock({ ...audit, verdict_deadline: "2026-10-10" }, justAfter).includes("(passed)"));
});

test("a null deadline renders no act-by date", () => {
  assert.ok(renderAuditBlock({ ...audit, verdict_deadline: null }, today).endsWith("Act by: no act-by date"));
});

function setup(overrides: Record<string, unknown> = {}) {
  const calls: { model: any[]; logs: unknown[][]; audits: unknown[][] } = { model: [], logs: [], audits: [] };
  const handler = createMarcusChatHandler({
    authenticate: async () => ({ userId: "user-1" }),
    readRecentSessions: async () => [],
    readAudits: async (...args: unknown[]) => {
      calls.audits.push(args);
      return [];
    },
    loadPromptTemplate: () => DUMMY_TEMPLATE,
    createMessage: async (params: unknown) => {
      calls.model.push(params);
      return { content: [{ type: "text", text: "Welcome." }] };
    },
    hashPrompt: async () => "prompt-hash",
    now: () => today,
    log: (...args: unknown[]) => calls.logs.push(args),
    ...overrides,
  } as any);
  return { handler, calls };
}

const post = () =>
  new Request("http://localhost/functions/v1/marcus-chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [], profile: {}, session_id: "session-1" }),
  });

test("no audit: the prompt is byte-identical to the no-audit render and the flag is false", async () => {
  const { handler, calls } = setup();
  await handler(post());
  assert.equal(calls.model[0].system, BASE_PROMPT);
  assert.deepEqual(calls.audits, [["user-1"]]);
  assert.deepEqual(calls.logs, [["marcus-chat: prompt", { sha256: "prompt-hash", audit_block: false }]]);
});

test("an audit adds the block after the history position and sets the flag", async () => {
  const { handler, calls } = setup({ readAudits: async () => [audit] });
  await handler(post());
  assert.equal(
    calls.model[0].system,
    `${BASE_PROMPT}\n\nLATEST PRICING AUDIT (completed 2026-10-03):\nVerdict: raise\nNumber: $49/month\nAct by: 2026-11-02`,
  );
  assert.deepEqual(calls.logs, [["marcus-chat: prompt", { sha256: "prompt-hash", audit_block: true }]]);
});

test("the Verdict reasoning and baseline never reach the prompt", async () => {
  const { handler, calls } = setup({
    readAudits: async () => [{
      ...audit,
      verdict_reasoning: "SECRET-REASONING",
      baseline: { value_anchor: "SECRET-BASELINE" },
    }],
  });
  await handler(post());
  const system = calls.model[0].system as string;
  assert.equal(system.includes("SECRET-REASONING"), false);
  assert.equal(system.includes("SECRET-BASELINE"), false);
});

test("the audit-first founder gets the audit block but no history block", async () => {
  const { handler, calls } = setup({
    readAudits: async () => [audit],
    readRecentSessions: async () => [{
      session_number: 1,
      summary: "Audit summary",
      action_committed: null,
      created_at: "2026-10-03T12:00:00.000Z",
      is_pricing_audit: true,
    }],
  });
  await handler(post());
  const system = calls.model[0].system as string;
  assert.ok(system.includes("LATEST PRICING AUDIT"));
  assert.equal(system.includes("PREVIOUS SESSIONS"), false);
});

test("a failed audit read logs an error and the reply continues without the block", async () => {
  const { handler, calls } = setup({
    readAudits: async () => {
      throw new Error("db down");
    },
  });
  const response = await handler(post());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { reply: "Welcome." });
  assert.equal(calls.model[0].system, BASE_PROMPT);
  assert.equal(calls.logs.some(([label]) => label === "marcus-chat: audit"), true);
  assert.deepEqual(calls.logs.at(-1), ["marcus-chat: prompt", { sha256: "prompt-hash", audit_block: false }]);
});

test("two audits: the newest by completed_at is used, whatever the row order", () => {
  const older = { ...audit, verdict_action: "hold", completed_at: "2026-07-01T10:00:00.000Z" };
  assert.equal(latestAudit([older, audit]), audit);
  assert.equal(latestAudit([audit, older]), audit);
  assert.equal(latestAudit([]), null);
});

test("two audits reach the prompt as the newest one", async () => {
  const older = { ...audit, verdict_action: "hold", completed_at: "2026-07-01T10:00:00.000Z" };
  const { handler, calls } = setup({ readAudits: async () => [older, audit] });
  await handler(post());
  assert.ok((calls.model[0].system as string).includes("Verdict: raise"));
  assert.equal((calls.model[0].system as string).includes("Verdict: hold"), false);
});

test("a stored number is shown exactly as stored", () => {
  assert.ok(renderAuditBlock({ ...audit, verdict_number: " $49/month " }, today).includes("Number:  $49/month  \n"));
});
