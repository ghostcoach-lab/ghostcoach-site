import {
  type Effort,
  effortSetting,
  modelSetting,
  positiveIntegerSetting,
  type ReadEnv,
} from "../_shared/settings.ts";

export interface AuditCompleteConfig {
  model: string;
  effort: Effort;
  maxTokens: number;
  timeoutMs: number;
  maxTranscriptChars: number;
}

// The transcript cap sits above the audit chat's, which excludes Marcus's closing Verdict.
export const AUDIT_COMPLETE_DEFAULTS: AuditCompleteConfig = {
  model: "claude-opus-5-5",
  effort: "low",
  maxTokens: 16000,
  timeoutMs: 60000,
  maxTranscriptChars: 140000,
};

export function readAuditCompleteConfig(env: ReadEnv): AuditCompleteConfig {
  const defaults = AUDIT_COMPLETE_DEFAULTS;
  return {
    model: modelSetting(env, "AUDIT_COMPLETE_MODEL", defaults.model),
    effort: effortSetting(env, "AUDIT_COMPLETE_EFFORT", defaults.effort),
    maxTokens: positiveIntegerSetting(env, "AUDIT_COMPLETE_MAX_TOKENS", defaults.maxTokens),
    timeoutMs: positiveIntegerSetting(env, "AUDIT_COMPLETE_TIMEOUT_MS", defaults.timeoutMs),
    maxTranscriptChars: positiveIntegerSetting(
      env,
      "AUDIT_COMPLETE_MAX_TRANSCRIPT_CHARS",
      defaults.maxTranscriptChars,
    ),
  };
}
