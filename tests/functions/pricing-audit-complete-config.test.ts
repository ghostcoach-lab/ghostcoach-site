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
  })), {
    model: "claude-opus-5",
    effort: "medium",
    maxTokens: 8000,
    timeoutMs: 30000,
    maxTranscriptChars: 200000,
  });
});

test("invalid values are rejected without echoing them", () => {
  for (const [name, value] of [
    ["AUDIT_COMPLETE_EFFORT", "extreme"],
    ["AUDIT_COMPLETE_MAX_TRANSCRIPT_CHARS", "0"],
    ["AUDIT_COMPLETE_MAX_TOKENS", "lots"],
    ["AUDIT_COMPLETE_MODEL", " "],
  ]) {
    assert.throws(
      () => readAuditCompleteConfig(env({ [name]: value })),
      (error: Error) => error.message.includes(name) && (value.trim() === "" || !error.message.includes(value)),
      name,
    );
  }
});
