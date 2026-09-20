export interface AuthenticatedUser {
  userId: string;
}

export type Plan = "builder" | "operator" | "lifetime";
export type UserStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "pending"
  | "deleted";

export interface EligibilityRecord {
  plan: Plan;
  status: UserStatus;
  trial_end: string | null;
  welcome_audit_used: boolean;
  last_audit_completed_at: string | null;
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

      const hasActivePlan = record.status === "active" &&
        (record.plan === "operator" || record.plan === "lifetime");
      const hasActiveOperatorTrial = record.plan === "operator" &&
        record.status === "trialing" &&
        record.trial_end !== null &&
        new Date(record.trial_end) > dependencies.now();
      const isEntitled = hasActivePlan || hasActiveOperatorTrial;

      if (isEntitled && !record.welcome_audit_used) {
        return json({
          state: "eligible",
          is_welcome_audit: true,
          next_eligible_date: null,
          last_completed_at: null,
        }, 200);
      }

      if (!isEntitled) {
        return json({
          state: "not_entitled",
          is_welcome_audit: false,
          next_eligible_date: null,
          last_completed_at: record.last_audit_completed_at,
        }, 200);
      }

      if (
        isEntitled &&
        record.welcome_audit_used &&
        !record.last_audit_completed_at
      ) {
        throw new Error("Completed audit timestamp is missing");
      }

      if (
        isEntitled &&
        record.welcome_audit_used &&
        record.last_audit_completed_at
      ) {
        const nextEligibleAt = new Date(record.last_audit_completed_at);
        nextEligibleAt.setUTCDate(nextEligibleAt.getUTCDate() + 90);

        if (dependencies.now() < nextEligibleAt) {
          return json({
            state: "gated",
            is_welcome_audit: false,
            next_eligible_date: nextEligibleAt.toISOString().slice(0, 10),
            last_completed_at: record.last_audit_completed_at,
          }, 200);
        }

        return json({
          state: "eligible",
          is_welcome_audit: false,
          next_eligible_date: null,
          last_completed_at: record.last_audit_completed_at,
        }, 200);
      }
    } catch (error) {
      console.error("pricing-audit-eligibility:", error);
      return json({ error: "Unable to determine pricing audit eligibility" }, 500);
    }

    return json({ error: "Unable to determine pricing audit eligibility" }, 500);
  };
}
