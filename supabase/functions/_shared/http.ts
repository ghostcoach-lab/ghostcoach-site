export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-retry-count, traceparent, tracestate, baggage",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Reason codes shared by the audit chat and completion functions (spec #5).
export const REASON_STATUS = {
  invalid_request: 400,
  unauthorized: 401,
  plan_lapsed: 403,
  gated: 403,
  session_conflict: 409,
  audit_too_long: 413,
  extraction_incomplete: 422,
  ai_unavailable: 503,
  internal_error: 500,
} as const;
export type Reason = keyof typeof REASON_STATUS;

export function json(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: corsHeaders });
}

export function preflight(): Response {
  return new Response("ok", { status: 200, headers: corsHeaders });
}

// A failure body is the reason code only, plus the next eligible date when gated.
export function refuse(reason: Reason, extra: Record<string, string> = {}): Response {
  return json({ reason, ...extra }, REASON_STATUS[reason]);
}

export function methodNotAllowed(): Response {
  return json({ reason: "invalid_request" }, 405);
}
