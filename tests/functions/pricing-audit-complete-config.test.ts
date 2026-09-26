import assert from "node:assert/strict";
import test from "node:test";

import {
  AUDIT_COMPLETE_DEFAULTS,
  readAuditCompleteConfig,
} from "../../supabase/functions/pricing-audit-complete/config.ts";

const env = (values: Record<string, string>) => (name: string) => values[name];

test("defaults apply when nothing is configured", () => {
  assert.deepEqual(readAuditCompleteConfig(env({})), AUDIT_COMPLETE_DEFAULTS);
  assert.equal(AUDIT_COMPLETE_DEFAULTS.model, "claude-opus-5-5");
  assert.equal(AUDIT_COMPLETE_DEFAULTS.effort, "low");
});

test("every setting can be overridden", () => {
  assert.deepEqual(readAuditCompleteConfig(env({
    AUDIT_COMPLETE_MODEL: "claude-opus-5",
    AUDIT_COMPLETE_EFFORT: "medium",
    AUDIT_COMPLETE_MAX_TOKENS: "8000",
    AUDIT_COMPLETE_TIMEOUT_MS: "30000",
    AUDIT_COMPLETE_MAX_TRANSCRIPT_CHARS: "200000",
    S12_RECAP_URL: "https://recap.example.test/webhook/recap",
    S12_RECAP_SECRET: "recap-test-secret",
    S12_RECAP_TIMEOUT_MS: "5000",
  })), {
    model: "claude-opus-5",
    effort: "medium",
    maxTokens: 8000,
    timeoutMs: 30000,
    maxTranscriptChars: 200000,
    recap: { url: "https://recap.example.test/webhook/recap", secret: "recap-test-secret" },
    recapTimeoutMs: 5000,
  });
});

test("invalid values are rejected without echoing them", () => {
  for (const [name, value] of [
    ["AUDIT_COMPLETE_EFFORT", "extreme"],
    ["AUDIT_COMPLETE_MAX_TRANSCRIPT_CHARS", "0"],
    ["AUDIT_COMPLETE_MAX_TOKENS", "lots"],
    ["AUDIT_COMPLETE_MODEL", " "],
    ["S12_RECAP_TIMEOUT_MS", "-1"],
  ]) {
    assert.throws(
      () => readAuditCompleteConfig(env({ [name]: value })),
      (error: Error) => error.message.includes(name) && (value.trim() === "" || !error.message.includes(value)),
      name,
    );
  }
});

test("the recap target needs both an https URL and a secret, and never echoes them", () => {
  const url = "https://recap.example.test/webhook/recap";
  const secret = "recap-test-secret";
  for (const [values, name] of [
    [{ S12_RECAP_URL: url }, "S12_RECAP_SECRET"],
    [{ S12_RECAP_SECRET: secret }, "S12_RECAP_URL"],
    [{ S12_RECAP_URL: url, S12_RECAP_SECRET: " " }, "S12_RECAP_SECRET"],
    [{ S12_RECAP_URL: "http://recap.example.test/webhook/recap", S12_RECAP_SECRET: secret }, "S12_RECAP_URL"],
    [{ S12_RECAP_URL: "not a url", S12_RECAP_SECRET: secret }, "S12_RECAP_URL"],
  ] as const) {
    assert.throws(
      () => readAuditCompleteConfig(env(values)),
      (error: Error) => error.message.includes(name) && !error.message.includes(secret) &&
        !error.message.includes("recap.example.test"),
      name,
    );
  }
});
