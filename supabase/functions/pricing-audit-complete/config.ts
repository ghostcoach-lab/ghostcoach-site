import {
  type Effort,
  effortSetting,
  modelSetting,
  positiveIntegerSetting,
  type ReadEnv,
} from "../_shared/settings.ts";

// Where the S12 recap workflow listens, and the server-only secret it expects.
export interface RecapTarget {
  url: string;
  secret: string;
}

export interface AuditCompleteConfig {
  model: string;
  effort: Effort;
  maxTokens: number;
  timeoutMs: number;
  maxTranscriptChars: number;
  recap: RecapTarget | null;
  recapTimeoutMs: number;
}

// The transcript cap sits above the audit chat's, which excludes Marcus's closing Verdict.
export const AUDIT_COMPLETE_DEFAULTS: AuditCompleteConfig = {
  model: "claude-opus-5-5",
  effort: "low",
  maxTokens: 16000,
  timeoutMs: 60000,
  maxTranscriptChars: 140000,
  recap: null,
  recapTimeoutMs: 10000,
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
    recap: recapTarget(env),
    recapTimeoutMs: positiveIntegerSetting(env, "S12_RECAP_TIMEOUT_MS", defaults.recapTimeoutMs),
  };
}

// Neither set means S12 is not configured: each Completion logs that and sends no recap.
function recapTarget(env: ReadEnv): RecapTarget | null {
  const url = env("S12_RECAP_URL")?.trim();
  const secret = env("S12_RECAP_SECRET")?.trim();
  if (!url && !secret) return null;
  if (!url) throw new Error("S12_RECAP_URL must be set with S12_RECAP_SECRET");
  if (!secret) throw new Error("S12_RECAP_SECRET must be set with S12_RECAP_URL");
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("S12_RECAP_URL must be an https URL");
  }
  if (parsed.protocol !== "https:") throw new Error("S12_RECAP_URL must be an https URL");
  return { url, secret };
}
