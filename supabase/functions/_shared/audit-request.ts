export interface AuditIntake {
  mrr: number;
  customer_count: number;
  churn_rate: number;
  current_pricing: string;
  last_pricing_change: string;
}

export interface AuditMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AuditRequest {
  sessionId: string;
  auditIntake: AuditIntake;
  messages: AuditMessage[];
}

export interface AuditRequestCaps {
  maxMessages: number;
  maxMessageChars: number;
  maxTranscriptChars: number;
}

export type AuditRequestResult =
  | { ok: true; value: AuditRequest }
  | { ok: false; reason: "invalid_request" | "audit_too_long"; detail: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INTAKE_NUMBERS = ["mrr", "customer_count", "churn_rate"] as const;
const INTAKE_TEXT = ["current_pricing", "last_pricing_change"] as const;
const INTAKE_TEXT_MAX_CHARS = 2000;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function intakeProblem(intake: unknown): string | null {
  if (!isObject(intake)) return "audit_intake must be an object";
  const keys = Object.keys(intake).sort();
  const expected = [...INTAKE_NUMBERS, ...INTAKE_TEXT].sort();
  if (keys.join() !== expected.join()) return "audit_intake must have exactly the five intake fields";
  for (const key of INTAKE_NUMBERS) {
    const value = intake[key];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      return `audit_intake.${key} must be a non-negative number`;
    }
  }
  if (!Number.isInteger(intake.customer_count)) return "audit_intake.customer_count must be a whole number";
  for (const key of INTAKE_TEXT) {
    const value = intake[key];
    if (typeof value !== "string" || !value.trim() || value.length > INTAKE_TEXT_MAX_CHARS) {
      return `audit_intake.${key} must be non-blank text of at most ${INTAKE_TEXT_MAX_CHARS} characters`;
    }
  }
  return null;
}

// The browser holds the visible turns only: Marcus's opener first, then alternating turns
// ending with the customer. The server adds its own opening user turn in front.
function messagesProblem(messages: unknown): string | null {
  if (!Array.isArray(messages)) return "messages must be an array";
  for (const [index, message] of messages.entries()) {
    if (!isObject(message) || (message.role !== "user" && message.role !== "assistant")) {
      return `messages[${index}] must have a user or assistant role`;
    }
    if (typeof message.content !== "string" || !message.content.trim()) {
      return `messages[${index}] must have non-blank text content`;
    }
    const expectedRole = index % 2 === 0 ? "assistant" : "user";
    if (message.role !== expectedRole) return `messages[${index}] must be from the ${expectedRole}`;
  }
  if (messages.length > 0 && messages.length % 2 !== 0) return "the last message must be from the user";
  return null;
}

// Validates an audit chat body. Details are for logs only.
export function parseAuditRequest(body: unknown, caps: AuditRequestCaps): AuditRequestResult {
  const invalid = (detail: string): AuditRequestResult => ({ ok: false, reason: "invalid_request", detail });
  const tooLong = (detail: string): AuditRequestResult => ({ ok: false, reason: "audit_too_long", detail });
  if (!isObject(body)) return invalid("body must be a JSON object");
  if (typeof body.session_id !== "string" || !UUID.test(body.session_id)) {
    return invalid("session_id must be a UUID");
  }
  const intake = intakeProblem(body.audit_intake);
  if (intake) return invalid(intake);
  const sequence = messagesProblem(body.messages);
  if (sequence) return invalid(sequence);

  const messages = (body.messages as AuditMessage[]).map(({ role, content }) => ({ role, content }));
  if (messages.length > caps.maxMessages) {
    return tooLong("message count cap exceeded");
  }
  if (messages.some((m) => m.content.length > caps.maxMessageChars)) {
    return tooLong("per-message length cap exceeded");
  }
  if (messages.reduce((total, m) => total + m.content.length, 0) > caps.maxTranscriptChars) {
    return tooLong("transcript length cap exceeded");
  }
  const { mrr, customer_count, churn_rate, current_pricing, last_pricing_change } =
    body.audit_intake as unknown as AuditIntake;
  return {
    ok: true,
    value: {
      sessionId: body.session_id.toLowerCase(),
      auditIntake: { mrr, customer_count, churn_rate, current_pricing, last_pricing_change },
      messages,
    },
  };
}
