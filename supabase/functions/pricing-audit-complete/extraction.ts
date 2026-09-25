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
  | { ok: false; detail: string };

const ACTIONS: readonly VerdictAction[] = ["raise", "hold", "restructure"];
const BASELINE_KEYS = ["value_anchor", "friction_read", "mix", "churn_window"] as const;
const nullable = (schema: object) => ({ anyOf: [schema, { type: "null" }] });

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
- number: for raise or restructure, the new price or figure Marcus named, as he wrote it (with currency or unit). null for hold.
- deadline: the date by which the customer must act, as YYYY-MM-DD. Resolve a relative phrase ("in 30 days", "by the end of next month") from the completion date given, in UTC.
- reasoning: Marcus's reasoning for the Verdict, briefly, in his words.
- baseline: what Marcus recorded for value_anchor (what customers pay for), friction_read (friction in buying or paying), mix (who the customers are) and churn_window (when customers leave).

If Marcus gave no Verdict, gave more than one without settling on one, or left the action, number, deadline, reasoning or any part of the Baseline missing or unclear, set verdict_found to false and every other field to null.`;

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
  const fail = (detail: string): ExtractionResult => ({ ok: false, detail });
  if (!isObject(raw)) return fail("extraction is not an object");
  if (raw.verdict_found !== true) return fail("no verdict");

  const action = raw.action as VerdictAction;
  if (!ACTIONS.includes(action)) return fail("action is not raise, hold or restructure");
  if (action === "hold" ? raw.number !== null : !nonBlank(raw.number)) {
    return fail(action === "hold" ? "a hold must have no number" : `a ${action} needs a number`);
  }
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
      number: action === "hold" ? null : (raw.number as string).trim(),
      deadline: raw.deadline,
      reasoning: raw.reasoning.trim(),
    },
    baseline: Object.fromEntries(
      BASELINE_KEYS.map((key) => [key, (baseline[key] as string).trim()]),
    ) as unknown as Baseline,
  };
}
