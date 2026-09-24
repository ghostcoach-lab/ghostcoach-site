# GhostCoach Pricing Audit

GhostCoach's AI coach, Marcus, runs a recurring pricing audit for entitled customers. Each audit ends in a verdict, and the verdicts form a record that accumulates quarter by quarter.

## Language

**Pricing audit**:
A guided Marcus conversation about a customer's pricing that ends in a Verdict. It is separate from a normal coaching session and never feeds goal progress.
_Avoid_: Audit session, pricing session, diagnostic

**Welcome audit**:
The first Pricing audit a customer is entitled to. It is available immediately on becoming entitled, with no Cooldown.
_Avoid_: First audit, onboarding audit

**Verdict**:
Marcus's closing recommendation for an audit: an action (raise, hold or restructure), a number where applicable, a deadline and the reasoning.
_Avoid_: Result, outcome, recommendation

**Baseline**:
The point-in-time pricing picture captured during an audit (value anchor, friction read, mix, churn window). The next audit compares against it.
_Avoid_: Snapshot, metrics

**Audit intake**:
The figures the customer states before an audit starts (MRR, customer count, churn, current pricing, last pricing change).
_Avoid_: Onboarding data, form data

**Completion**:
The moment a validated Verdict is persisted. It is the only event that records an audit and moves the Cooldown; opening or abandoning an audit is never a Completion.
_Avoid_: Audit end, submission, finish

**Cooldown**:
The 90 days after a Completion during which the customer cannot start another audit.
_Avoid_: Clock, lockout, gating window

**Entitled**:
The customer's trusted plan state allows audits: active Operator (including an unexpired trial) or Lifetime.
_Avoid_: Eligible (eligibility also accounts for the Cooldown), paid, premium

**Prior audit**:
One of the customer's two most recent completed Pricing audits. Both are given to Marcus when the next audit starts, so he can spot a verdict that failed more than once.
_Avoid_: Last quarter's audit, history
