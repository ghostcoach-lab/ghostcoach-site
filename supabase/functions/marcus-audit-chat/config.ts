export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type Effort = typeof EFFORTS[number];

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

function positiveInteger(env: (name: string) => string | undefined, name: string, fallback: number): number {
  const raw = env(name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!/^\d+$/.test(raw.trim()) || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

// Reads the audit chat settings. Error messages name the setting, never its value.
export function readAuditChatConfig(env: (name: string) => string | undefined): AuditChatConfig {
  const model = env("AUDIT_CHAT_MODEL") ?? AUDIT_CHAT_DEFAULTS.model;
  if (!model.trim()) throw new Error("AUDIT_CHAT_MODEL must not be blank");
  const effort = env("AUDIT_CHAT_EFFORT") ?? AUDIT_CHAT_DEFAULTS.effort;
  if (!(EFFORTS as readonly string[]).includes(effort)) {
    throw new Error(`AUDIT_CHAT_EFFORT must be one of ${EFFORTS.join(", ")}`);
  }
  return {
    prompt: env("AUDIT_MARCUS_PROMPT") ?? "",
    model: model.trim(),
    effort: effort as Effort,
    maxTokens: positiveInteger(env, "AUDIT_CHAT_MAX_TOKENS", AUDIT_CHAT_DEFAULTS.maxTokens),
    timeoutMs: positiveInteger(env, "AUDIT_CHAT_TIMEOUT_MS", AUDIT_CHAT_DEFAULTS.timeoutMs),
    maxMessages: positiveInteger(env, "AUDIT_CHAT_MAX_MESSAGES", AUDIT_CHAT_DEFAULTS.maxMessages),
    maxMessageChars: positiveInteger(env, "AUDIT_CHAT_MAX_MESSAGE_CHARS", AUDIT_CHAT_DEFAULTS.maxMessageChars),
    maxTranscriptChars: positiveInteger(
      env,
      "AUDIT_CHAT_MAX_TRANSCRIPT_CHARS",
      AUDIT_CHAT_DEFAULTS.maxTranscriptChars,
    ),
  };
}
