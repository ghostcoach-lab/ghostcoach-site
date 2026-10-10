// The only columns read from pricing_audits. The Verdict reasoning and Baseline are never read.
export interface LatestAuditRow {
  verdict_action: string;
  verdict_number: string | null;
  completed_at: string;
  verdict_deadline: string | null;
}

export function latestAudit(rows: LatestAuditRow[]): LatestAuditRow | null {
  let newest: LatestAuditRow | null = null;
  for (const row of rows) {
    if (!newest || Date.parse(row.completed_at) > Date.parse(newest.completed_at)) newest = row;
  }
  return newest;
}

// The block for the {{audit_block}} placeholder: empty without an audit, otherwise a short data
// block. Dates are UTC (YYYY-MM-DD), and "(passed)" is decided here, never left to the model.
export function renderAuditBlock(audit: LatestAuditRow | null, now: Date): string {
  if (!audit) return "";
  const completed = new Date(audit.completed_at).toISOString().slice(0, 10);
  // Shown as stored; only a null or blank number reads "no number".
  const number = audit.verdict_number?.trim() ? audit.verdict_number : "no number";
  let actBy = "no act-by date";
  if (audit.verdict_deadline) {
    const today = now.toISOString().slice(0, 10);
    actBy = today > audit.verdict_deadline ? `${audit.verdict_deadline} (passed)` : audit.verdict_deadline;
  }
  return `\n\nLATEST PRICING AUDIT (completed ${completed}):\nVerdict: ${audit.verdict_action}\nNumber: ${number}\nAct by: ${actBy}`;
}
