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

export type EligibilityDecision =
  | { state: "eligible"; isWelcomeAudit: boolean }
  | { state: "gated"; nextEligibleDate: string }
  | { state: "not_entitled" };

const COOLDOWN_DAYS = 90;

// Decides whether a customer can start a Pricing audit from their trusted `users` fields.
// Throws when the record claims a used Welcome audit without a Completion timestamp.
export function decidePricingAuditEligibility(
  record: EligibilityRecord,
  now: Date,
): EligibilityDecision {
  const hasActivePlan = record.status === "active" &&
    (record.plan === "operator" || record.plan === "lifetime");
  const hasActiveOperatorTrial = record.plan === "operator" &&
    record.status === "trialing" &&
    record.trial_end !== null &&
    new Date(record.trial_end) > now;

  if (!hasActivePlan && !hasActiveOperatorTrial) return { state: "not_entitled" };
  if (!record.welcome_audit_used) return { state: "eligible", isWelcomeAudit: true };
  if (!record.last_audit_completed_at) {
    throw new Error("Completed audit timestamp is missing");
  }

  const nextEligibleAt = new Date(record.last_audit_completed_at);
  nextEligibleAt.setUTCDate(nextEligibleAt.getUTCDate() + COOLDOWN_DAYS);

  if (now < nextEligibleAt) {
    return {
      state: "gated",
      nextEligibleDate: nextEligibleAt.toISOString().slice(0, 10),
    };
  }
  return { state: "eligible", isWelcomeAudit: false };
}
