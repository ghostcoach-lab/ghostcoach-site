import type { ReadEnv } from "../_shared/settings.ts";

export interface MarcusChatConfig {
  anthropicKey: string;
  promptTemplate: string;
  supabaseUrl: string;
  supabaseSecretKey: string;
}

// The runtime injects the project's secret keys as one JSON object keyed by name.
// No fallback to the legacy service-role key. Errors name the problem, never the value.
const SECRET_KEY_NAME = "edgefunctions";

function defaultSecretKeySetting(env: ReadEnv): string {
  let keys: unknown;
  try {
    keys = JSON.parse(requiredSetting(env, "SUPABASE_SECRET_KEYS"));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error("SUPABASE_SECRET_KEYS is not valid JSON");
    throw error;
  }
  if (typeof keys !== "object" || keys === null || Array.isArray(keys)) {
    throw new Error("SUPABASE_SECRET_KEYS must be a JSON object");
  }
  if (!Object.hasOwn(keys, SECRET_KEY_NAME)) {
    throw new Error(`SUPABASE_SECRET_KEYS has no ${SECRET_KEY_NAME} key`);
  }
  const key = (keys as Record<string, unknown>)[SECRET_KEY_NAME];
  if (typeof key !== "string" || !key.trim()) {
    throw new Error(`SUPABASE_SECRET_KEYS ${SECRET_KEY_NAME} key must be a non-blank string`);
  }
  return key.trim();
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
    supabaseSecretKey: defaultSecretKeySetting(env),
  };
}
