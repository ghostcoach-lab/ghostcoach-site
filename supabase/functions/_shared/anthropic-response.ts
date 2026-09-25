import type Anthropic from "npm:@anthropic-ai/sdk@0.128.0";

export type TextReply =
  | { ok: true; text: string }
  | { ok: false; problem: "refusal" | "incomplete" | "no_text"; detail: string };

// Reads a Messages API response by block type. Thinking blocks come first and are skipped;
// nothing assumes the first block is text.
export function readTextReply(message: Anthropic.Message): TextReply {
  if (message.stop_reason === "refusal") {
    return { ok: false, problem: "refusal", detail: `refusal: ${message.stop_details?.category ?? "uncategorized"}` };
  }
  if (message.stop_reason !== "end_turn" && message.stop_reason !== "stop_sequence") {
    return { ok: false, problem: "incomplete", detail: `stop_reason: ${message.stop_reason}` };
  }
  const text = message.content
    .flatMap((block) => block.type === "text" ? [block.text] : [])
    .join("")
    .trim();
  if (!text) return { ok: false, problem: "no_text", detail: "response has no text blocks" };
  return { ok: true, text };
}
