import type Anthropic from "npm:@anthropic-ai/sdk@0.128.0";

import { readTextReply } from "../_shared/anthropic-response.ts";
import { type AuditIntake, parseAuditRequest } from "../_shared/audit-request.ts";
import { json, methodNotAllowed, preflight, refuse } from "../_shared/http.ts";
import type { AuditCompleteConfig } from "./config.ts";
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

// One row from complete_pricing_audit. Dates arrive as YYYY-MM-DD strings.
export interface CompletionRow {
  audit_id: string;
  status: "completed";
  is_welcome_audit: boolean;
  verdict_action: VerdictAction;
  verdict_number: string | null;
  verdict_deadline: string;
  verdict_reasoning: string;
  next_eligible_date: string;
}

export interface AuditCompleteDependencies {
  authenticate(request: Request): Promise<AuthenticatedUser | null>;
  createMessage(params: Anthropic.MessageCreateParamsNonStreaming, timeoutMs: number): Promise<Anthropic.Message>;
  completeAudit(input: CompletionInput): Promise<CompletionRow>;
  loadConfig(): AuditCompleteConfig;
  now(): Date;
  logError(context: string, detail: unknown): void;
}

export function createPricingAuditCompleteHandler(
  dependencies: AuditCompleteDependencies,
): (request: Request) => Promise<Response> {
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
      dependencies.logError("pricing-audit-complete: configuration", error);
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
      dependencies.logError("pricing-audit-complete: request", parsed.detail);
      return refuse(parsed.reason);
    }
    const { sessionId, auditIntake, messages } = parsed.value;
    const transcript = formatTranscript(messages);
    const completionDate = dependencies.now().toISOString().slice(0, 10);

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
      dependencies.logError("pricing-audit-complete: extraction call", error);
      return refuse("ai_unavailable");
    }

    const reply = readTextReply(message);
    if (!reply.ok) {
      dependencies.logError("pricing-audit-complete: extraction reply", reply.detail);
      return refuse("ai_unavailable");
    }
    let extracted: unknown;
    try {
      extracted = JSON.parse(reply.text);
    } catch {
      dependencies.logError("pricing-audit-complete: extraction", "reply is not JSON");
      return refuse("extraction_incomplete");
    }
    const result = validateExtraction(extracted, completionDate);
    if (!result.ok) {
      dependencies.logError("pricing-audit-complete: extraction", result.detail);
      return refuse("extraction_incomplete");
    }

    let row: CompletionRow;
    try {
      row = await dependencies.completeAudit({
        userId: user.userId,
        sessionId,
        transcript,
        auditIntake,
        verdict: result.verdict,
        baseline: result.baseline,
      });
    } catch (error) {
      dependencies.logError("pricing-audit-complete: completion", error);
      // The RPC re-checks the deadline against its own completion date (invalid_parameter_value).
      const deadlineRejected = (error as { code?: unknown } | null)?.code === "22023";
      return refuse(deadlineRejected ? "extraction_incomplete" : "internal_error");
    }

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
  };
}
