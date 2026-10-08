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

export function readMarcusChatConfig(env: ReadEnv): MarcusChatConfig {
  return {
    anthropicKey: requiredSetting(env, "ANTHROPIC_API_KEY"),
    promptTemplate: env("MARCUS_CHAT_PROMPT_TEMPLATE") ?? "",
    supabaseUrl: requiredSetting(env, "SUPABASE_URL"),
    supabaseServiceRoleKey: requiredSetting(env, "SUPABASE_SERVICE_ROLE_KEY"),
  };
}
