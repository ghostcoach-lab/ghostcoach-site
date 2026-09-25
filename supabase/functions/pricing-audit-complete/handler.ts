import type Anthropic from "npm:@anthropic-ai/sdk@0.128.0";

import { readTextReply } from "../_shared/anthropic-response.ts";
import { type AuditIntake, parseAuditRequest } from "../_shared/audit-request.ts";
import { json, methodNotAllowed, preflight, refuse } from "../_shared/http.ts";
import {
  decidePricingAuditEligibility,
  type EligibilityRecord,
} from "../_shared/pricing-audit-eligibility.ts";
import type { AuditCompleteConfig, RecapTarget } from "./config.ts";
import {
  type Baseline,
  EXTRACTION_SCHEMA,
  EXTRACTION_SYSTEM_PROMPT,
  extractionRequestText,
  formatTranscript,
  validateExtraction,
  type Verdict,
  type VerdictAction,
} from "./extraction.ts";

export interface AuthenticatedUser {
  userId: string;
}

export interface CompletionInput {
  userId: string;
  sessionId: string;
  transcript: string;
  auditIntake: AuditIntake;
  verdict: Verdict;
  baseline: Baseline;
}

// A row from pricing_audit_session_state or complete_pricing_audit. Only completed and
// already_completed carry an audit; gated carries the next eligible date. Dates are YYYY-MM-DD.
export type CompletionStatus =
  | "new"
  | "completed"
  | "already_completed"
  | "session_conflict"
  | "plan_lapsed"
  | "gated";

export interface CompletionRow {
  audit_id: string | null;
  status: CompletionStatus;
  is_welcome_audit: boolean | null;
  verdict_action: VerdictAction | null;
  verdict_number: string | null;
  verdict_deadline: string | null;
  verdict_reasoning: string | null;
  next_eligible_date: string | null;
}

// The customer's own trusted details for the recap email.
export interface Recipient {
  email: string;
  firstName: string;
}

// Everything S12 needs to send the recap. S12 has no database access.
export interface RecapPayload {
  audit_id: string;
  email: string;
  first_name: string;
  verdict: Verdict;
  next_eligible_date: string;
}

// S12 refuses a longer name. The name is the customer's own editable field, so a long one is
// dropped and the email greets without it.
const MAX_FIRST_NAME_CHARS = 100;

export interface AuditCompleteDependencies {
  authenticate(request: Request): Promise<AuthenticatedUser | null>;
  lookupSession(userId: string, sessionId: string): Promise<CompletionRow>;
  readEligibilityRecord(userId: string): Promise<EligibilityRecord | null>;
  createMessage(params: Anthropic.MessageCreateParamsNonStreaming, timeoutMs: number): Promise<Anthropic.Message>;
  completeAudit(input: CompletionInput): Promise<CompletionRow>;
  readRecipient(userId: string): Promise<Recipient>;
  postRecap(target: RecapTarget, payload: RecapPayload, signal: AbortSignal): Promise<Response>;
  recordRecapSent(userId: string, auditId: string, sentAt: string): Promise<void>;
  loadConfig(): AuditCompleteConfig;
  now(): Date;
  logError(context: string, detail: unknown): void;
}

const EXTRACTION_ATTEMPTS = 2;

type Extracted = { ok: true; verdict: Verdict; baseline: Baseline } | { ok: false; response: Response };

// The response for a row that settles the request, or null for a new session. Anything
// unexpected in the row is an internal error.
function settle(row: CompletionRow, logError: AuditCompleteDependencies["logError"]): Response | null {
  switch (row.status) {
    case "new":
      return null;
    case "completed":
    case "already_completed":
      if (row.audit_id && row.verdict_action && row.verdict_deadline && row.verdict_reasoning &&
          row.next_eligible_date && typeof row.is_welcome_audit === "boolean") {
        return json({
          status: row.status,
          audit_id: row.audit_id,
          is_welcome_audit: row.is_welcome_audit,
          verdict: {
            action: row.verdict_action,
            number: row.verdict_number,
            deadline: row.verdict_deadline,
            reasoning: row.verdict_reasoning,
          },
          next_eligible_date: row.next_eligible_date,
        }, 200);
      }
      break;
    case "session_conflict":
    case "plan_lapsed":
      return refuse(row.status);
    case "gated":
      if (row.next_eligible_date) return refuse("gated", { next_eligible_date: row.next_eligible_date });
      break;
  }
  logError("pricing-audit-complete: unexpected completion row", { status: row.status });
  return refuse("internal_error");
}

export function createPricingAuditCompleteHandler(
  dependencies: AuditCompleteDependencies,
): (request: Request) => Promise<Response> {
  const { logError } = dependencies;

  async function extract(transcript: string, completionDate: string, config: AuditCompleteConfig): Promise<Extracted> {
    // An invalid result is retried once; "no verdict" and an AI failure are not.
    for (let attempt = 1; attempt <= EXTRACTION_ATTEMPTS; attempt++) {
      let message: Anthropic.Message;
      try {
        message = await dependencies.createMessage({
          model: config.model,
          max_tokens: config.maxTokens,
          output_config: {
            effort: config.effort,
            format: { type: "json_schema", schema: EXTRACTION_SCHEMA },
          },
          system: EXTRACTION_SYSTEM_PROMPT,
          messages: [{ role: "user", content: extractionRequestText(transcript, completionDate) }],
        }, config.timeoutMs);
      } catch (error) {
        logError("pricing-audit-complete: extraction call", error);
        return { ok: false, response: refuse("ai_unavailable") };
      }
      const reply = readTextReply(message);
      if (!reply.ok) {
        logError("pricing-audit-complete: extraction reply", reply.detail);
        return { ok: false, response: refuse("ai_unavailable") };
      }
      let result;
      try {
        result = validateExtraction(JSON.parse(reply.text), completionDate);
      } catch {
        result = { ok: false as const, detail: "reply is not JSON", retry: true };
      }
      if (result.ok) return result;
      logError("pricing-audit-complete: extraction", `attempt ${attempt}: ${result.detail}`);
      if (!result.retry) break;
    }
    return { ok: false, response: refuse("extraction_incomplete") };
  }

  return async (request: Request) => {
    if (request.method === "OPTIONS") return preflight();
    if (request.method !== "POST") return methodNotAllowed();

    // The customer's ID comes only from the verified JWT, never from the body.
    const user = await dependencies.authenticate(request);
    if (!user) return refuse("unauthorized");

    let config: AuditCompleteConfig;
    try {
      config = dependencies.loadConfig();
    } catch (error) {
      logError("pricing-audit-complete: configuration", error);
      return refuse("internal_error");
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return refuse("invalid_request");
    }
    const parsed = parseAuditRequest(body, { maxTranscriptChars: config.maxTranscriptChars }, "completion");
    if (!parsed.ok) {
      logError("pricing-audit-complete: request", parsed.detail);
      return refuse(parsed.reason);
    }
    const { sessionId, auditIntake, messages } = parsed.value;

    // Idempotency and the eligibility pre-check come before any AI call.
    try {
      const settled = settle(await dependencies.lookupSession(user.userId, sessionId), logError);
      if (settled) return settled;

      const record = await dependencies.readEligibilityRecord(user.userId);
      if (!record) throw new Error("Application user record is missing");
      const decision = decidePricingAuditEligibility(record, dependencies.now());
      if (decision.state === "not_entitled") return refuse("plan_lapsed");
      if (decision.state === "gated") return refuse("gated", { next_eligible_date: decision.nextEligibleDate });
    } catch (error) {
      logError("pricing-audit-complete: pre-checks", error);
      return refuse("internal_error");
    }

    const transcript = formatTranscript(messages);
    const completionDate = dependencies.now().toISOString().slice(0, 10);
    const extracted = await extract(transcript, completionDate, config);
    if (!extracted.ok) return extracted.response;

    // The RPC re-checks idempotency, Entitlement and the Cooldown under the customer's row lock.
    let row: CompletionRow;
    try {
      row = await dependencies.completeAudit({
        userId: user.userId,
        sessionId,
        transcript,
        auditIntake,
        verdict: extracted.verdict,
        baseline: extracted.baseline,
      });
    } catch (error) {
      logError("pricing-audit-complete: completion", error);
      // The RPC re-checks the deadline against its own completion date (invalid_parameter_value).
      const deadlineRejected = (error as { code?: unknown } | null)?.code === "22023";
      return refuse(deadlineRejected ? "extraction_incomplete" : "internal_error");
    }
    const settled = settle(row, logError);
    if (!settled) {
      logError("pricing-audit-complete: completion", "the RPC returned new");
      return refuse("internal_error");
    }
    // Only a new Completion sends a recap; already_completed never does.
    if (row.status === "completed" && settled.ok) await sendRecap(user.userId, row, config);
    return settled;
  };

  // A failed recap is logged and leaves recap_sent_at null for the manual resend; it never undoes
  // the Completion. settle() has already checked that the row carries the audit and its Verdict.
  async function sendRecap(userId: string, row: CompletionRow, config: AuditCompleteConfig): Promise<void> {
    const auditId = row.audit_id!;
    if (!config.recap) {
      logError("pricing-audit-complete: recap", { audit_id: auditId, error: "S12 is not configured" });
      return;
    }
    const target = config.recap;
    try {
      const recipient = await dependencies.readRecipient(userId);
      const payload: RecapPayload = {
        audit_id: auditId,
        email: recipient.email,
        first_name: recipient.firstName.length > MAX_FIRST_NAME_CHARS ? "" : recipient.firstName,
        verdict: {
          action: row.verdict_action!,
          number: row.verdict_number,
          deadline: row.verdict_deadline!,
          reasoning: row.verdict_reasoning!,
        },
        next_eligible_date: row.next_eligible_date!,
      };
      // The timeout covers only the S12 call, which includes S12's own wait for Resend.
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(new Error("recap timed out")), config.recapTimeoutMs);
      let response: Response;
      try {
        response = await dependencies.postRecap(target, payload, controller.signal);
      } finally {
        clearTimeout(timer);
      }
      if (!response.ok) {
        logError("pricing-audit-complete: recap", { audit_id: auditId, status: response.status });
        return;
      }
      await dependencies.recordRecapSent(userId, auditId, dependencies.now().toISOString());
    } catch (error) {
      logError("pricing-audit-complete: recap", { audit_id: auditId, error });
    }
  }
}
