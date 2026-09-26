import {
  type Effort,
  effortSetting,
  modelSetting,
  positiveIntegerSetting,
  type ReadEnv,
} from "../_shared/settings.ts";

export interface AuditChatConfig {
  prompt: string;
  model: string;
  effort: Effort;
  maxTokens: number;
  timeoutMs: number;
  maxMessages: number;
  maxMessageChars: number;
  maxTranscriptChars: number;
}

// Caps are starting values, to be tuned with full-length audits.
export const AUDIT_CHAT_DEFAULTS: Omit<AuditChatConfig, "prompt"> = {
  model: "claude-opus-5-5",
  effort: "low",
  maxTokens: 16000,
  timeoutMs: 60000,
  maxMessages: 80,
  maxMessageChars: 8000,
  maxTranscriptChars: 120000,
};

export function readAuditChatConfig(env: ReadEnv): AuditChatConfig {
  const defaults = AUDIT_CHAT_DEFAULTS;
  return {
    prompt: env("AUDIT_MARCUS_PROMPT") ?? "",
    model: modelSetting(env, "AUDIT_CHAT_MODEL", defaults.model),
    effort: effortSetting(env, "AUDIT_CHAT_EFFORT", defaults.effort),
    maxTokens: positiveIntegerSetting(env, "AUDIT_CHAT_MAX_TOKENS", defaults.maxTokens),
    timeoutMs: positiveIntegerSetting(env, "AUDIT_CHAT_TIMEOUT_MS", defaults.timeoutMs),
    maxMessages: positiveIntegerSetting(env, "AUDIT_CHAT_MAX_MESSAGES", defaults.maxMessages),
    maxMessageChars: positiveIntegerSetting(env, "AUDIT_CHAT_MAX_MESSAGE_CHARS", defaults.maxMessageChars),
    maxTranscriptChars: positiveIntegerSetting(env, "AUDIT_CHAT_MAX_TRANSCRIPT_CHARS", defaults.maxTranscriptChars),
  };
}
