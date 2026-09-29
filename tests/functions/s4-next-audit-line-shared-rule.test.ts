import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  decidePricingAuditEligibility,
  type EligibilityRecord,
} from "../../supabase/functions/_shared/pricing-audit-eligibility.ts";
// @ts-ignore: plain JavaScript module shared with the n8n candidate.
import { nextAuditLine } from "../../scripts/n8n/s4-next-audit-line.mjs";

// The shared eligibility cases, as pricing_audit_decide_eligibility returns them, mapped through
// the S4 line. pricing-audit-eligibility-parity.test.ts and the migration test pin those rows to
// both the TypeScript and the SQL rule.
const cases = JSON.parse(
  readFileSync(new URL("../fixtures/pricing-audit-eligibility-cases.json", import.meta.url), "utf8"),
);

const rpcRow = (expected: Record<string, unknown>) => ({
  state: expected.state,
  is_welcome_audit: expected.is_welcome_audit ?? null,
  next_eligible_date: expected.next_eligible_date ?? null,
});

// The line each rule result should give, with N counted from the case's own UTC dates.
function expectedLine(expected: Record<string, unknown>, now: string) {
  if (expected.error || expected.state === "not_entitled") return null;
  if (expected.state === "eligible") return { state: "available", text: "Your pricing audit is available now." };
  const days = (Date.parse(`${expected.next_eligible_date}T00:00:00Z`) -
    Date.parse(`${now.slice(0, 10)}T00:00:00Z`)) / 86400000;
  if (days === 0) return { state: "today", text: "Your next pricing audit opens today." };
  if (days === 1) return { state: "tomorrow", text: "Your next pricing audit opens tomorrow." };
  return { state: "in_days", text: `Your next pricing audit opens in ${days} days.` };
}

for (const { name, now, expected } of cases) {
  test(`S4 line for the shared case: ${name}`, () => {
    // A raised rule reaches the node as an n8n error item (continue on fail).
    const decision = expected.error ? { error: { message: "Completed audit timestamp is missing" } } : rpcRow(expected);
    assert.deepEqual(nextAuditLine(decision, now), expectedLine(expected, now));
  });
}

test("the shared cases include each rule result the line maps", () => {
  const results = new Set(cases.map(({ expected }: { expected: Record<string, unknown> }) =>
    expected.error ? "error" : expected.state));
  assert.deepEqual([...results].sort(), ["eligible", "error", "gated", "not_entitled"]);
});

// What pricing_audit_decide_eligibility returns, via the TypeScript rule it is pinned to.
function decisionAt(completedAt: string, now: Date) {
  const record: EligibilityRecord = {
    plan: "operator", status: "active", trial_end: null,
    welcome_audit_used: true, last_audit_completed_at: completedAt,
  };
  const decision = decidePricingAuditEligibility(record, now);
  if (decision.state === "eligible") return { state: "eligible", is_welcome_audit: decision.isWelcomeAudit };
  if (decision.state === "gated") return { state: "gated", next_eligible_date: decision.nextEligibleDate };
  return { state: "not_entitled" };
}

// A Cooldown ends 90 days after the Completion, at its time of day.
const completedFor = (end: string) => new Date(Date.parse(end) - 90 * 86400000).toISOString();

const runs = {
  "summer (07:00 Amsterdam = 05:00 UTC)": "2026-09-28T07:00:00.007+02:00",
  "winter (07:00 Amsterdam = 06:00 UTC)": "2026-11-02T07:00:00.000+01:00",
};

for (const [season, run] of Object.entries(runs)) {
  const runUtc = new Date(run);
  const day = runUtc.toISOString().slice(0, 10);
  const at = (offsetMs: number) => new Date(runUtc.getTime() + offsetMs).toISOString();
  const nextDay = new Date(Date.parse(day) + 86400000).toISOString().slice(0, 10);
  const boundaries: [string, string, string][] = [
    ["Cooldown ended one minute before the run", at(-60000), "available"],
    ["Cooldown ends at the run's exact moment", at(0), "available"],
    ["Cooldown ends one minute after the run", at(60000), "today"],
    ["Cooldown ends at 23:30 UTC the same day", `${day}T23:30:00.000Z`, "today"],
    ["Cooldown ends at 00:30 UTC the next day", `${nextDay}T00:30:00.000Z`, "tomorrow"],
    ["Cooldown ends two days later", at(2 * 86400000), "in_days"],
  ];
  for (const [label, end, state] of boundaries) {
    test(`day boundary, ${season}: ${label}`, () => {
      const line = nextAuditLine(decisionAt(completedFor(end), runUtc), run);
      assert.equal(line?.state, state, JSON.stringify(line));
    });
  }
}
