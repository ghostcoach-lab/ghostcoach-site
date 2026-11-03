import type { ReadEnv } from "../_shared/settings.ts";

export interface MarcusChatConfig {
  anthropicKey: string;
  promptTemplate: string;
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
}

function requiredSetting(env: ReadEnv, name: string): string {
  const value = env(name)?.trim();
  if (!value) throw new Error(`${name} is missing or blank`);
  return value;
}

function serviceKey(env: ReadEnv, log: (...args: unknown[]) => void): string {
  const raw = env("SUPABASE_SECRET_KEYS");
  let reason = "absent";
  if (raw) {
    try {
      const key = JSON.parse(raw)?.marcus_chat_prod;
      if (typeof key === "string" && key !== "") {
        log("marcus-chat: key path", { path: "secret_keys" });
        return key;
      }
      reason = key === undefined ? "no_key" : "empty_key";
    } catch {
      reason = "invalid_json";
    }
  }
  log("marcus-chat: key path", { path: "legacy_service_role", reason });
  return requiredSetting(env, "SUPABASE_SERVICE_ROLE_KEY");
}

export function readMarcusChatConfig(
  env: ReadEnv,
  log: (...args: unknown[]) => void = console.log,
): MarcusChatConfig {
  return {
    anthropicKey: requiredSetting(env, "ANTHROPIC_API_KEY"),
    promptTemplate: env("MARCUS_CHAT_PROMPT_TEMPLATE") ?? "",
    supabaseUrl: requiredSetting(env, "SUPABASE_URL"),
    supabaseServiceRoleKey: serviceKey(env, log),
  };
}
