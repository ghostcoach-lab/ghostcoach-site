import assert from "node:assert/strict";
import test from "node:test";

import { readMarcusChatConfig } from "../../supabase/functions/marcus-chat/config.ts";

function setup(extra: Record<string, string> = {}) {
  const values: Record<string, string> = {
    ANTHROPIC_API_KEY: "dummy-anthropic",
    SUPABASE_URL: "https://example.test",
    SUPABASE_SERVICE_ROLE_KEY: "dummy-legacy",
    ...extra,
  };
  const logs: unknown[][] = [];
  return { env: (name: string) => values[name], logs, log: (...args: unknown[]) => logs.push(args) };
}

test("prefers the named secret key and does not expose it in logs", () => {
  const fixture = setup({ SUPABASE_SECRET_KEYS: JSON.stringify({ default: "other", marcus_chat_prod: "dummy-new" }) });
  const config = readMarcusChatConfig(fixture.env, fixture.log);
  assert.equal(config.supabaseServiceRoleKey, "dummy-new");
  assert.deepEqual(fixture.logs, [["marcus-chat: key path", { path: "secret_keys" }]]);
  assert.ok(!JSON.stringify(fixture.logs).includes("dummy-new"));
});

test("the named secret works when the legacy key is absent", () => {
  const values: Record<string, string> = {
    ANTHROPIC_API_KEY: "dummy-anthropic",
    SUPABASE_URL: "https://example.test",
    SUPABASE_SECRET_KEYS: JSON.stringify({ marcus_chat_prod: "dummy-new" }),
  };
  const config = readMarcusChatConfig(name => values[name], () => {});
  assert.equal(config.supabaseServiceRoleKey, "dummy-new");
});

for (const [label, raw, reason] of [
  ["absent", undefined, "absent"],
  ["invalid JSON", "{", "invalid_json"],
  ["missing named key", '{}', "no_key"],
  ["empty named key", '{"marcus_chat_prod":""}', "empty_key"],
  ["non-string key", '{"marcus_chat_prod":42}', "empty_key"],
] as const) {
  test(`falls back to the legacy key when the secret is ${label}`, () => {
    const fixture = setup(raw === undefined ? {} : { SUPABASE_SECRET_KEYS: raw });
    const config = readMarcusChatConfig(fixture.env, fixture.log);
    assert.equal(config.supabaseServiceRoleKey, "dummy-legacy");
    assert.deepEqual(fixture.logs, [["marcus-chat: key path", { path: "legacy_service_role", reason }]]);
    assert.ok(!JSON.stringify(fixture.logs).includes("dummy-legacy"));
  });
}
