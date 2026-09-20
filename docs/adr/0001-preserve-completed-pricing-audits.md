# Preserve completed pricing audits as session-owned history

Completed pricing-audit verdicts are stored as durable `pricing_audits` rows owned by a user and tied one-to-one to the session that produced them. The migration removes the legacy profile timestamp only when it contains no data; this trades a simpler single-source model for a deliberate deployment stop when legacy history would otherwise be discarded, while preserving idempotency, ownership, and deletion behavior in database constraints.
