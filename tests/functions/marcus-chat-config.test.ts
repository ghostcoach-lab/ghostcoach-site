import assert from "node:assert/strict";
import test from "node:test";

import { readMarcusChatConfig } from "../../supabase/functions/marcus-chat/config.ts";
import { createMarcusChatEntryHandler } from "../../supabase/functions/marcus-chat/entry.ts";
import { createMarcusChatHandler } from "../../supabase/functions/marcus-chat/handler.ts";

const DUMMY_SECRET = "dummy-default-secret";

const env = (values: Record<string, string>) => (name: string) => values[name];

function baseEnv(overrides: Record<string, string> = {}) {
  return env({
    ANTHROPIC_API_KEY: "dummy-anthropic",
    MARCUS_CHAT_PROMPT_TEMPLATE: "dummy template",
    SUPABASE_URL: "http://localhost:54321",
    SUPABASE_SECRET_KEYS: JSON.stringify({ default: DUMMY_SECRET }),
    ...overrides,
  });
}

test("the default secret key is the Supabase key", () => {
  assert.equal(readMarcusChatConfig(baseEnv()).supabaseSecretKey, DUMMY_SECRET);
});

test("the default key is used even when other secret keys are listed first", () => {
  const keys = JSON.stringify({ dummy_other: "dummy-other-secret", default: DUMMY_SECRET });
  const config = readMarcusChatConfig(baseEnv({ SUPABASE_SECRET_KEYS: keys }));
  assert.equal(config.supabaseSecretKey, DUMMY_SECRET);
});

test("the default key is trimmed, like the other required settings", () => {
  const keys = JSON.stringify({ default: ` ${DUMMY_SECRET}
` });
  assert.equal(readMarcusChatConfig(baseEnv({ SUPABASE_SECRET_KEYS: keys })).supabaseSecretKey, DUMMY_SECRET);
});

test("the legacy service-role key is never a fallback", () => {
  const read: string[] = [];
  const legacyOnly = (name: string) => {
    read.push(name);
    return {
      ANTHROPIC_API_KEY: "dummy-anthropic",
      SUPABASE_URL: "http://localhost:54321",
      SUPABASE_SERVICE_ROLE_KEY: "dummy-legacy-service-role",
    }[name];
  };

  assert.throws(() => readMarcusChatConfig(legacyOnly), {
    message: "SUPABASE_SECRET_KEYS is missing or blank",
  });
  assert.equal(read.includes("SUPABASE_SERVICE_ROLE_KEY"), false);
});

for (const [label, raw, message] of [
  ["blank", " \n ", "SUPABASE_SECRET_KEYS is missing or blank"],
  ["invalid JSON", `{"default": "${DUMMY_SECRET}"`, "SUPABASE_SECRET_KEYS is not valid JSON"],
  ["the bare key instead of JSON", DUMMY_SECRET, "SUPABASE_SECRET_KEYS is not valid JSON"],
  ["a JSON array", `["${DUMMY_SECRET}"]`, "SUPABASE_SECRET_KEYS must be a JSON object"],
  ["a JSON string", `"${DUMMY_SECRET}"`, "SUPABASE_SECRET_KEYS must be a JSON object"],
  ["JSON null", "null", "SUPABASE_SECRET_KEYS must be a JSON object"],
  ["without a default key", `{"dummy_other": "${DUMMY_SECRET}"}`, "SUPABASE_SECRET_KEYS has no default key"],
  ["with a blank default key", `{"default": "  "}`, "SUPABASE_SECRET_KEYS default key must be a non-blank string"],
  ["with a numeric default key", `{"default": 123456}`, "SUPABASE_SECRET_KEYS default key must be a non-blank string"],
] as const) {
  test(`secret keys ${label} fail closed without echoing the value`, () => {
    assert.throws(
      () => readMarcusChatConfig(baseEnv({ SUPABASE_SECRET_KEYS: raw })),
      (error: Error) => {
        assert.equal(error.message, message);
        assert.equal(error.cause, undefined);
        return true;
      },
    );
  });
}

test("malformed secret keys return 500 and keep the key out of the response and logs", async () => {
  const logs: string[] = [];
  const entry = createMarcusChatEntryHandler({
    createHandler: () => {
      readMarcusChatConfig(baseEnv({ SUPABASE_SECRET_KEYS: DUMMY_SECRET }));
      return createMarcusChatHandler({} as any);
    },
    logError: (label, detail) => {
      logs.push(label, String(detail), (detail as Error)?.stack ?? "");
    },
  });

  const response = await entry(new Request("http://localhost/functions/v1/marcus-chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  }));
  const body = await response.text();

  assert.equal(response.status, 500);
  assert.deepEqual(JSON.parse(body), { error: "Configuration error" });
  assert.equal(logs[0], "marcus-chat: setup");
  assert.ok(logs.join("\n").includes("SUPABASE_SECRET_KEYS is not valid JSON"));
  assert.equal(body.includes(DUMMY_SECRET), false);
  assert.equal(logs.join("\n").includes(DUMMY_SECRET), false);
});
