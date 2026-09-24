import {
  decidePricingAuditEligibility,
  type EligibilityRecord,
} from "../_shared/pricing-audit-eligibility.ts";

export type {
  EligibilityRecord,
  Plan,
  UserStatus,
} from "../_shared/pricing-audit-eligibility.ts";

export interface AuthenticatedUser {
  userId: string;
}

export interface HandlerDependencies {
  authenticate(request: Request): Promise<AuthenticatedUser | null>;
  readEligibilityRecord(userId: string): Promise<EligibilityRecord | null>;
  now(): Date;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-retry-count, traceparent, tracestate, baggage",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: corsHeaders });
}

export function createPricingAuditEligibilityHandler(
  dependencies: HandlerDependencies,
): (request: Request) => Promise<Response> {
  return async (request: Request) => {
    if (request.method === "OPTIONS") {
      return new Response("ok", { status: 200, headers: corsHeaders });
    }
    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }

    const user = await dependencies.authenticate(request);
    if (!user) return json({ error: "Unauthorized" }, 401);

    try {
      const record = await dependencies.readEligibilityRecord(user.userId);
      if (!record) throw new Error("Application user record is missing");

      const decision = decidePricingAuditEligibility(record, dependencies.now());

      if (decision.state === "not_entitled") {
        return json({
          state: "not_entitled",
          is_welcome_audit: false,
          next_eligible_date: null,
          last_completed_at: record.last_audit_completed_at,
        }, 200);
      }

      if (decision.state === "gated") {
        return json({
          state: "gated",
          is_welcome_audit: false,
          next_eligible_date: decision.nextEligibleDate,
          last_completed_at: record.last_audit_completed_at,
        }, 200);
      }

      return json({
        state: "eligible",
        is_welcome_audit: decision.isWelcomeAudit,
        next_eligible_date: null,
        last_completed_at: decision.isWelcomeAudit
          ? null
          : record.last_audit_completed_at,
      }, 200);
    } catch (error) {
      console.error("pricing-audit-eligibility:", error);
      return json({ error: "Unable to determine pricing audit eligibility" }, 500);
    }
  };
}
