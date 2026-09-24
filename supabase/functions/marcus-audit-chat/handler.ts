import type Anthropic from "npm:@anthropic-ai/sdk@0.128.0";

import { readTextReply } from "../_shared/anthropic-response.ts";
import { type AuditIntake, parseAuditRequest } from "../_shared/audit-request.ts";
import {
  decidePricingAuditEligibility,
  type EligibilityRecord,
} from "../_shared/pricing-audit-eligibility.ts";
import type { AuditChatConfig } from "./config.ts";

export interface AuthenticatedUser {
  userId: string;
}

export interface PriorAuditRow {
  completed_at: string;
  verdict_action: string;
  verdict_number: string | null;
  verdict_deadline: string | null;
  verdict_reasoning: string;
  baseline: unknown;
}

export interface AuditChatDependencies {
  authenticate(request: Request): Promise<AuthenticatedUser | null>;
  readEligibilityRecord(userId: string): Promise<EligibilityRecord | null>;
  sessionExists(sessionId: string): Promise<boolean>;
  readPriorAudits(userId: string, limit: number): Promise<PriorAuditRow[]>;
  createMessage(params: Anthropic.MessageCreateParamsNonStreaming, timeoutMs: number): Promise<Anthropic.Message>;
  loadConfig(): AuditChatConfig;
  now(): Date;
  logError(context: string, detail: unknown): void;
}

// Stands in for the founder's first turn, since a conversation must start with a user turn.
export const AUDIT_OPENING_TURN =
  "(Pricing audit starting. My audit intake is in the audit data. Open the audit, per your instructions.)";
const PRIOR_AUDIT_LIMIT = 2;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-retry-count, traceparent, tracestate, baggage",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const STATUS = {
  invalid_request: 400,
  unauthorized: 401,
  plan_lapsed: 403,
  gated: 403,
  session_conflict: 409,
  audit_too_long: 413,
  ai_unavailable: 503,
  internal_error: 500,
} as const;
type Reason = keyof typeof STATUS;

function json(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: corsHeaders });
}

function refuse(reason: Reason, extra: Record<string, string> = {}): Response {
  return json({ reason, ...extra }, STATUS[reason]);
}

function auditDataBlock(priorAudits: PriorAuditRow[], intake: AuditIntake, now: Date): string {
  const today = now.toISOString().slice(0, 10);
  const data = {
    today,
    welcome_audit: priorAudits.length === 0,
    prior_audits: priorAudits.map((audit) => ({
      completed_on: audit.completed_at.slice(0, 10),
      verdict: {
        action: audit.verdict_action,
        number: audit.verdict_number,
        deadline: audit.verdict_deadline,
        reasoning: audit.verdict_reasoning,
      },
      baseline: audit.baseline,
      deadline_passed: audit.verdict_deadline === null ? null : today > audit.verdict_deadline,
    })),
    audit_intake: intake,
  };
  return `<audit_data>\n${JSON.stringify(data, null, 2)}\n</audit_data>`;
}

export function createMarcusAuditChatHandler(
  dependencies: AuditChatDependencies,
): (request: Request) => Promise<Response> {
  return async (request: Request) => {
    if (request.method === "OPTIONS") {
      return new Response("ok", { status: 200, headers: corsHeaders });
    }
    if (request.method !== "POST") return json({ reason: "invalid_request" }, 405);

    const user = await dependencies.authenticate(request);
    if (!user) return refuse("unauthorized");

    let config: AuditChatConfig;
    try {
      config = dependencies.loadConfig();
    } catch (error) {
      dependencies.logError("marcus-audit-chat: configuration", error);
      return refuse("internal_error");
    }
    if (!config.prompt.trim()) {
      dependencies.logError("marcus-audit-chat: configuration", "audit prompt is not configured");
      return refuse("internal_error");
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return refuse("invalid_request");
    }
    const parsed = parseAuditRequest(body, config);
    if (!parsed.ok) {
      dependencies.logError("marcus-audit-chat: request", parsed.detail);
      return refuse(parsed.reason);
    }
    const { sessionId, auditIntake, messages } = parsed.value;

    let system: Anthropic.TextBlockParam[];
    try {
      const record = await dependencies.readEligibilityRecord(user.userId);
      if (!record) throw new Error("Application user record is missing");
      const decision = decidePricingAuditEligibility(record, dependencies.now());
      if (decision.state === "not_entitled") return refuse("plan_lapsed");
      if (decision.state === "gated") return refuse("gated", { next_eligible_date: decision.nextEligibleDate });
      if (await dependencies.sessionExists(sessionId)) return refuse("session_conflict");

      const priorAudits = await dependencies.readPriorAudits(user.userId, PRIOR_AUDIT_LIMIT);
      system = [
        // The prompt is identical for every caller, so it is cached separately from the data.
        { type: "text", text: config.prompt, cache_control: { type: "ephemeral" } },
        { type: "text", text: auditDataBlock(priorAudits, auditIntake, dependencies.now()) },
      ];
    } catch (error) {
      dependencies.logError("marcus-audit-chat: data access", error);
      return refuse("internal_error");
    }

    let message: Anthropic.Message;
    try {
      message = await dependencies.createMessage({
        model: config.model,
        max_tokens: config.maxTokens,
        output_config: { effort: config.effort },
        system,
        messages: [{ role: "user", content: AUDIT_OPENING_TURN }, ...messages],
      }, config.timeoutMs);
    } catch (error) {
      dependencies.logError("marcus-audit-chat: model call", error);
      return refuse("ai_unavailable");
    }

    const reply = readTextReply(message);
    if (!reply.ok) {
      dependencies.logError("marcus-audit-chat: model reply", reply.detail);
      return refuse("ai_unavailable");
    }
    return json({ reply: reply.text }, 200);
  };
}
