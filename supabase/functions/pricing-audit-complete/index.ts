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
      // Privileged, so it sees every session: another customer's or a coaching session is a conflict.
      lookupSession: async (userId, sessionId) => {
        const { data, error } = await context.supabaseAdmin
          .rpc("pricing_audit_session_state", { p_user_id: userId, p_session_id: sessionId })
          .single<CompletionRow>();
        if (error) throw error;
        return data;
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
      // The caller's own trusted records, read under RLS. A missing first name is sent as "".
      readRecipient: async (userId) => {
        const [user, profile] = await Promise.all([
          context.supabase.from("users").select("email").eq("id", userId).single<{ email: string }>(),
          context.supabase.from("profiles").select("firstname").eq("user_id", userId)
            .maybeSingle<{ firstname: string | null }>(),
        ]);
        if (user.error) throw user.error;
        if (profile.error) throw profile.error;
        return { email: user.data.email, firstName: profile.data?.firstname?.trim() ?? "" };
      },
      postRecap: (target, payload, signal) =>
        fetch(target.url, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${target.secret}` },
          body: JSON.stringify(payload),
          signal,
        }),
      // Customers can only read their audits, so the service role records the send.
      recordRecapSent: async (userId, auditId, sentAt) => {
        const { error } = await context.supabaseAdmin
          .from("pricing_audits")
          .update({ recap_sent_at: sentAt })
          .eq("id", auditId)
          .eq("user_id", userId)
          .is("recap_sent_at", null);
        if (error) throw error;
      },
      loadConfig: () => readAuditCompleteConfig((name) => Deno.env.get(name)),
      now: () => new Date(),
      logError: (label, detail) => console.error(label, detail),
    });

    return handler(request);
  }),
};
