import Anthropic from "npm:@anthropic-ai/sdk@0.128.0";
import { withSupabase } from "npm:@supabase/server@1.7.0";

import { readAuditCompleteConfig } from "./config.ts";
import { type CompletionRow, createPricingAuditCompleteHandler } from "./handler.ts";

// Reads ANTHROPIC_API_KEY (and ANTHROPIC_BASE_URL, if set) from the environment.
const anthropic = new Anthropic({ maxRetries: 1 });

export default {
  fetch: withSupabase({ auth: "user" }, async (request, context) => {
    const handler = createPricingAuditCompleteHandler({
      authenticate: async () => {
        const userId = context.userClaims?.id;
        return userId ? { userId } : null;
      },
      createMessage: (params, timeoutMs) => anthropic.messages.create(params, { timeout: timeoutMs }),
      // Only the service role can execute the Completion RPC.
      completeAudit: async ({ userId, sessionId, transcript, auditIntake, verdict, baseline }) => {
        const { data, error } = await context.supabaseAdmin
          .rpc("complete_pricing_audit", {
            p_user_id: userId,
            p_session_id: sessionId,
            p_transcript: transcript,
            p_audit_intake: auditIntake,
            p_verdict_action: verdict.action,
            p_verdict_number: verdict.number,
            p_verdict_deadline: verdict.deadline,
            p_verdict_reasoning: verdict.reasoning,
            p_baseline: baseline,
          })
          .single<CompletionRow>();
        if (error) throw error;
        return data;
      },
      loadConfig: () => readAuditCompleteConfig((name) => Deno.env.get(name)),
      now: () => new Date(),
      logError: (label, detail) => console.error(label, detail),
    });

    return handler(request);
  }),
};
