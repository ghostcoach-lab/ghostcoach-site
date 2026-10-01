import type { AuditMessage } from "../_shared/audit-request.ts";

export type VerdictAction = "raise" | "hold" | "restructure";

export interface Verdict {
  action: VerdictAction;
  number: string | null;
  deadline: string;
  reasoning: string;
}

export interface Baseline {
  value_anchor: string;
  friction_read: string;
  mix: string;
  churn_window: string;
}

export type ExtractionResult =
  | { ok: true; verdict: Verdict; baseline: Baseline }
  | { ok: false; detail: string; retry: boolean };

const ACTIONS: readonly VerdictAction[] = ["raise", "hold", "restructure"];
const BASELINE_KEYS = ["value_anchor", "friction_read", "mix", "churn_window"] as const;
const nullable = (schema: object) => ({ anyOf: [schema, { type: "null" }] });
// A figure, never a sentence.
export const VERDICT_NUMBER_MAX_CHARS = 60;

export const EXTRACTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["verdict_found", "action", "number", "deadline", "reasoning", "baseline"],
  properties: {
    verdict_found: { type: "boolean" },
    action: nullable({ type: "string", enum: ACTIONS }),
    number: nullable({ type: "string" }),
    deadline: nullable({ type: "string", format: "date" }),
    reasoning: nullable({ type: "string" }),
    baseline: nullable({
      type: "object",
      additionalProperties: false,
      required: BASELINE_KEYS,
      properties: Object.fromEntries(BASELINE_KEYS.map((key) => [key, { type: "string" }])),
    }),
  },
};

export const EXTRACTION_SYSTEM_PROMPT = `You read the transcript of a completed GhostCoach pricing audit and report the Verdict and Baseline that Marcus, the coach, stated in it.

Report only what Marcus actually said. Never infer, guess or fill a gap. The customer's own turns are context, not a Verdict.

- action: the Verdict Marcus gave: raise, hold or restructure.
- number: the figure only, as Marcus wrote it (with currency or unit), at most 60 characters and never a sentence. For raise, the new price Marcus named. For restructure, the figure Marcus named, or null if he named none. Always null for hold, even when Marcus mentions the price being held.
- deadline: the date by which the customer must act, as YYYY-MM-DD. Resolve a relative phrase ("in 30 days", "by the end of next month") from the completion date given, in UTC.
- reasoning: Marcus's reasoning for the Verdict, briefly, in his words.
- baseline: what Marcus recorded for value_anchor (what the product replaces for the customer, and what that alternative costs them), friction_read (friction in buying or paying), mix (the billing mix across monthly, annual and one-time, and where revenue is concentrated) and churn_window (when customers leave).

If Marcus gave no Verdict, gave more than one without settling on one, gave a raise without naming the new price, or left the action, deadline, reasoning or any part of the Baseline missing or unclear, set verdict_found to false and every other field to null. A restructure without a figure, or a hold that mentions a price, is still a Verdict.`;

// The existing sessions.transcript format, shared with normal coaching sessions, labels the
// customer's turns "Founder".
export function formatTranscript(messages: AuditMessage[]): string {
  return messages
    .map(({ role, content }) => `${role === "assistant" ? "Marcus" : "Founder"}: ${content}`)
    .join("\n\n");
}

export function extractionRequestText(transcript: string, completionDate: string): string {
  return `Completion date (UTC): ${completionDate}\n\n<transcript>\n${transcript}\n</transcript>`;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const nonBlank = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

// Spec #5 (#30): a raise needs a number, a restructure may have one, a hold never keeps one.
function verdictNumber(action: VerdictAction, raw: unknown): { ok: true; number: string | null } | { ok: false; detail: string } {
  if (action === "hold") return { ok: true, number: null };
  if (raw !== null && typeof raw !== "string") return { ok: false, detail: "the number is not text" };
  const number = typeof raw === "string" ? raw.trim() || null : null;
  if (number === null) {
    return action === "raise" ? { ok: false, detail: "a raise needs a number" } : { ok: true, number: null };
  }
  if (number.length > VERDICT_NUMBER_MAX_CHARS) {
    return { ok: false, detail: `the number is over ${VERDICT_NUMBER_MAX_CHARS} characters` };
  }
  return { ok: true, number };
}

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

// The same month and day a year later; from 29 February, 28 February.
function oneYearAfter(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  const later = new Date(Date.UTC(year + 1, month - 1, day));
  if (later.getUTCMonth() !== month - 1) later.setUTCDate(0);
  return later.toISOString().slice(0, 10);
}

// Checks the extraction against the field rules in spec #5. Details are for logs only.
export function validateExtraction(raw: unknown, completionDate: string): ExtractionResult {
  const fail = (detail: string): ExtractionResult => ({ ok: false, detail, retry: true });
  if (!isObject(raw)) return fail("extraction is not an object");
  // "No verdict" is not retried: the page offers completion before the Verdict (spec #5).
  if (raw.verdict_found !== true) return { ok: false, detail: "no verdict", retry: false };

  const action = raw.action as VerdictAction;
  if (!ACTIONS.includes(action)) return fail("action is not raise, hold or restructure");
  const number = verdictNumber(action, raw.number);
  if (!number.ok) return fail(number.detail);
  if (typeof raw.deadline !== "string" || !isCalendarDate(raw.deadline)) {
    return fail("deadline is not a calendar date");
  }
  if (raw.deadline <= completionDate || raw.deadline > oneYearAfter(completionDate)) {
    return fail("deadline must be after the completion date and at most one year later");
  }
  if (!nonBlank(raw.reasoning)) return fail("reasoning is blank");

  const baseline = raw.baseline;
  if (!isObject(baseline)) return fail("baseline is not an object");
  if (Object.keys(baseline).sort().join() !== [...BASELINE_KEYS].sort().join()) {
    return fail("baseline must have exactly value_anchor, friction_read, mix and churn_window");
  }
  if (!BASELINE_KEYS.every((key) => nonBlank(baseline[key]))) return fail("a baseline value is blank");

  return {
    ok: true,
    verdict: {
      action,
      number: number.number,
      deadline: raw.deadline,
      reasoning: raw.reasoning.trim(),
    },
    baseline: Object.fromEntries(
      BASELINE_KEYS.map((key) => [key, (baseline[key] as string).trim()]),
    ) as unknown as Baseline,
  };
}
