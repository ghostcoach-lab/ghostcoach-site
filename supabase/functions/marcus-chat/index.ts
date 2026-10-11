import { createClient } from "npm:@supabase/supabase-js@2";

import { readMarcusChatConfig } from "./config.ts";
import { createMarcusChatEntryHandler } from "./entry.ts";
import { createMarcusChatHandler } from "./handler.ts";

function sha256(value: string): Promise<string> {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
    .then((digest) => Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join(""));
}

Deno.serve(createMarcusChatEntryHandler({
  createHandler: () => {
    const config = readMarcusChatConfig((name) => Deno.env.get(name));
    const supabase = createClient(config.supabaseUrl, config.supabaseServiceRoleKey);
    return createMarcusChatHandler({
      authenticate: async (incomingRequest) => {
        const authHeader = incomingRequest.headers.get("Authorization") ?? "";
        const { data: { user }, error } = await supabase.auth.getUser(
          authHeader.replace("Bearer ", ""),
        );
        return error || !user ? null : { userId: user.id };
      },
      readRecentSessions: async (userId) => {
        const { data, error } = await supabase
          .from("sessions")
          .select("session_number, summary, action_committed, created_at, is_pricing_audit")
          .eq("user_id", userId)
          .eq("processing_status", "complete")
          .eq("is_pricing_audit", false)
          .not("summary", "is", null)
          .order("created_at", { ascending: false })
          .limit(3);
        if (error) {
          console.error("marcus-chat: history", error);
          return [];
        }
        return data;
      },
      // Only these four columns: the Verdict reasoning and Baseline are never read.
      readAudits: async (userId) => {
        const { data, error } = await supabase
          .from("pricing_audits")
          .select("verdict_action, verdict_number, completed_at, verdict_deadline")
          .eq("user_id", userId);
        if (error) throw error;
        return data;
      },
      loadPromptTemplate: () => config.promptTemplate,
      createMessage: async (params) => {
        const response = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": config.anthropicKey,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
          body: JSON.stringify(params),
        });
        if (!response.ok) {
          throw new Error(`Anthropic error: ${await response.text()}`);
        }
        return await response.json();
      },
      hashPrompt: sha256,
      now: () => new Date(),
      log: (label, detail) => console.log(label, detail),
    });
  },
  logError: (label, detail) => console.error(label, detail),
}));
