import assert from "node:assert/strict";
import test from "node:test";

import {
  AUDIT_CHAT_DEFAULTS,
  readAuditChatConfig,
} from "../../supabase/functions/marcus-audit-chat/config.ts";

const env = (values: Record<string, string>) => (name: string) => values[name];

test("defaults apply when only the prompt is configured", () => {
  assert.deepEqual(readAuditChatConfig(env({ AUDIT_MARCUS_PROMPT: "prompt" })), {
    ...AUDIT_CHAT_DEFAULTS,
    prompt: "prompt",
  });
  assert.equal(AUDIT_CHAT_DEFAULTS.model, "claude-opus-5-5");
  assert.equal(AUDIT_CHAT_DEFAULTS.effort, "low");
});

test("a missing prompt reads as empty, so the handler can fail closed", () => {
  assert.equal(readAuditChatConfig(env({})).prompt, "");
});

test("every setting can be overridden", () => {
  const config = readAuditChatConfig(env({
    AUDIT_MARCUS_PROMPT: "prompt",
    AUDIT_CHAT_MODEL: "claude-opus-5",
    AUDIT_CHAT_EFFORT: "medium",
    AUDIT_CHAT_MAX_TOKENS: "8000",
    AUDIT_CHAT_TIMEOUT_MS: "30000",
    AUDIT_CHAT_MAX_MESSAGES: "40",
    AUDIT_CHAT_MAX_MESSAGE_CHARS: "4000",
    AUDIT_CHAT_MAX_TRANSCRIPT_CHARS: "60000",
  }));
  assert.deepEqual(config, {
    prompt: "prompt",
    model: "claude-opus-5",
    effort: "medium",
    maxTokens: 8000,
    timeoutMs: 30000,
    maxMessages: 40,
    maxMessageChars: 4000,
    maxTranscriptChars: 60000,
  });
});

test("invalid values are rejected without echoing them", () => {
  for (const [name, value] of [
    ["AUDIT_CHAT_EFFORT", "extreme"],
    ["AUDIT_CHAT_MAX_MESSAGES", "0"],
    ["AUDIT_CHAT_MAX_MESSAGE_CHARS", "12.5"],
    ["AUDIT_CHAT_MAX_TRANSCRIPT_CHARS", "lots"],
    ["AUDIT_CHAT_MAX_TOKENS", "-1"],
    ["AUDIT_CHAT_TIMEOUT_MS", ""],
    ["AUDIT_CHAT_MODEL", "  "],
  ]) {
    assert.throws(
      () => readAuditChatConfig(env({ AUDIT_MARCUS_PROMPT: "p", [name]: value })),
      (error: Error) => error.message.includes(name) && (value.trim() === "" || !error.message.includes(value)),
      name,
    );
  }
});
