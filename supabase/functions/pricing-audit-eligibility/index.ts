import { withSupabase } from "npm:@supabase/server@1.7.0";

import { createPricingAuditEligibilityHandler } from "./handler.ts";

export default {
  fetch: withSupabase({ auth: "user" }, async (request, context) => {
    const handler = createPricingAuditEligibilityHandler({
      authenticate: async () => {
        const userId = context.userClaims?.id;
        return userId ? { userId } : null;
      },
      readEligibilityRecord: async (userId) => {
        const { data, error } = await context.supabase
          .from("users")
          .select(
            "plan, status, trial_end, welcome_audit_used, last_audit_completed_at",
          )
          .eq("id", userId)
          .single();

        if (error) throw error;
        return data;
      },
      now: () => new Date(),
    });

    return handler(request);
  }),
};
