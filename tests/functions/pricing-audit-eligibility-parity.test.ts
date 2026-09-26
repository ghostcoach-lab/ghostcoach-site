import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { decidePricingAuditEligibility } from "../../supabase/functions/_shared/pricing-audit-eligibility.ts";

// The same table is asserted against pricing_audit_decide_eligibility in
// tests/migrations/pricing-audit-completion.sql, so the SQL and TypeScript rules agree.
const cases = JSON.parse(
  readFileSync(new URL("../fixtures/pricing-audit-eligibility-cases.json", import.meta.url), "utf8"),
);

for (const { name, record, now, expected } of cases) {
  test(`parity: ${name}`, () => {
    if (expected.error) {
      assert.throws(() => decidePricingAuditEligibility(record, new Date(now)));
      return;
    }
    const decision = decidePricingAuditEligibility(record, new Date(now));
    const actual = decision.state === "eligible"
      ? { state: "eligible", is_welcome_audit: decision.isWelcomeAudit }
      : decision.state === "gated"
      ? { state: "gated", next_eligible_date: decision.nextEligibleDate }
      : { state: "not_entitled" };
    assert.deepEqual(actual, expected);
  });
}
