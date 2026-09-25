import Anthropic from "npm:@anthropic-ai/sdk@0.128.0";
import { withSupabase } from "npm:@supabase/server@1.7.0";

import { readAuditChatConfig } from "./config.ts";
import { createMarcusAuditChatHandler } from "./handler.ts";

// Reads ANTHROPIC_API_KEY (and ANTHROPIC_BASE_URL, if set) from the environment.
const anthropic = new Anthropic({ maxRetries: 1 });

export default {
  fetch: withSupabase({ auth: "user" }, async (request, context) => {
    const handler = createMarcusAuditChatHandler({
      authenticate: async () => {
        const userId = context.userClaims?.id;
        return userId ? { userId } : null;
      },
      readEligibilityRecord: async (userId) => {
        const { data, error } = await context.supabase
          .from("users")
          .select("plan, status, trial_end, welcome_audit_used, last_audit_completed_at")
          .eq("id", userId)
          .single();
        if (error) throw error;
        return data;
      },
      // Caller-scoped, so RLS limits this to the caller's own sessions. The completion
      // function re-checks the ID against every session with privileged access.
      sessionExists: async (sessionId) => {
        const { data, error } = await context.supabase
          .from("sessions")
          .select("id")
          .eq("id", sessionId)
          .limit(1);
        if (error) throw error;
        return data.length > 0;
      },
      readPriorAudits: async (userId, limit) => {
        const { data, error } = await context.supabase
          .from("pricing_audits")
          .select("completed_at, verdict_action, verdict_number, verdict_deadline, verdict_reasoning, baseline")
          .eq("user_id", userId)
          .order("completed_at", { ascending: false })
          .limit(limit);
        if (error) throw error;
        return data;
      },
      createMessage: (params, timeoutMs) => anthropic.messages.create(params, { timeout: timeoutMs }),
      loadConfig: () => readAuditChatConfig((name) => Deno.env.get(name)),
      now: () => new Date(),
      logError: (label, detail) => console.error(label, detail),
    });

    return handler(request);
  }),
};
