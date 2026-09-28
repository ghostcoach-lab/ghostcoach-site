// Pure, offline transformer. This module never calls n8n, Supabase, Anthropic, or Resend.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { diffWorkflows, validateSessionFilters } from './session-lookups-completed-only.mjs';

export { diffWorkflows };
export const DECIDE = 'Decide Audit Eligibility';
export const ADD_LINE = 'Add Next Audit Line';
export const AUDIT_URL = 'https://getghostcoach.com/account/audit/';
export const TRIGGER = 'Cron — Monday 07:00 Amsterdam';
export const USERS = 'Query Operator Users';
const LOOP = 'Loop — One User at a Time';
const INSERT = 'INSERT digest record';
const EMAIL = 'Build Digest Email';
const SEND = 'Send Digest via Resend';
const API_KEY = /&apikey=([^`&$]+)(?=`)/;
// The users query as published, with the live apikey value replaced by KEY.
const USERS_URL = '={{ `${$vars.SUPABASE_URL}/rest/v1/users?plan=eq.operator&status=eq.active&select=id,email&apikey=KEY` }}';
const ELIGIBILITY_FIELDS = ['plan', 'status', 'trial_end', 'welcome_audit_used', 'last_audit_completed_at'];
const withEligibilityFields = url => url.replace('&select=id,email&', `&select=id,email,${ELIGIBILITY_FIELDS.join(',')}&`);
const withoutKey = url => (url ?? '').replace(API_KEY, '&apikey=KEY');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Self-contained, so it is embedded as-is in the Add Next Audit Line node. `decision` is a
// pricing_audit_decide_eligibility row; days count in UTC dates, like the account page.
export function nextAuditLine(decision, runTimestamp) {
  const run = new Date(runTimestamp ?? NaN);
  if (!decision || Number.isNaN(run.getTime())) return null;
  if (decision.state === 'eligible' && typeof decision.is_welcome_audit === 'boolean')
    return { state: 'available', text: 'Your pricing audit is available now.' };
  const date = decision.state === 'gated' ? decision.next_eligible_date : null;
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const opens = new Date(date + 'T00:00:00Z');
  if (Number.isNaN(opens.getTime()) || opens.toISOString().slice(0, 10) !== date) return null;
  const days = (opens.getTime() - Date.parse(run.toISOString().slice(0, 10) + 'T00:00:00Z')) / 86400000;
  if (days < 0) return null;
  if (days === 0) return { state: 'today', text: 'Your next pricing audit opens today.' };
  if (days === 1) return { state: 'tomorrow', text: 'Your next pricing audit opens tomorrow.' };
  return { state: 'in_days', text: `Your next pricing audit opens in ${days} days.` };
}

// Self-contained n8n Code node body. With no line, or no sign-off to anchor on, the email goes
// out unchanged. nextAuditLine is passed in because the node's code can't import it.
function addNextAuditLine(nextAuditLine, auditUrl) {
  // The email by name: this node's input is the Decide Audit Eligibility result.
  const item = $('Build Digest Email').first().json;
  let decision = null;
  let runTimestamp = null;
  try {
    decision = $input.first().json;
    runTimestamp = $('Cron — Monday 07:00 Amsterdam').first().json.timestamp;
  } catch (error) {
    return [{ json: item }];
  }
  const line = nextAuditLine(decision, runTimestamp);
  const html = item.email_payload?.html;
  const signOff = typeof html === 'string' ? html.lastIndexOf('Marcus — GhostCoach') : -1;
  const at = signOff < 0 ? -1 : html.lastIndexOf('<p', signOff);
  if (!line || at < 0) return [{ json: item }];
  const text = line.state === 'available'
    ? `<a href='${auditUrl}' style='color:#e5e5e5'>${line.text}</a>`
    : line.text;
  const block = `<div style='background:#111;border:1px solid #1a1a1a;border-radius:8px;padding:16px;margin-top:24px'><p style='font-size:12px;color:#666;margin:0 0 8px;text-transform:uppercase;letter-spacing:0.06em'>Pricing audit</p><p style='margin:0;color:#e5e5e5'>${text}</p></div>`;
  return [{ json: { ...item, email_payload: { ...item.email_payload, html: html.slice(0, at) + block + html.slice(at) } } }];
}

// LF regardless of checkout line endings, so candidates match what n8n stores.
const lf = fn => fn.toString().replaceAll('\r\n', '\n');
const addLineCode = `return (${lf(addNextAuditLine)})(${lf(nextAuditLine)}, ${JSON.stringify(AUDIT_URL)});`;
// Looks up the loop's user in the users query. An unknown user sends nulls, which the rule refuses.
const decideBody = `={{ (() => { const user = $('${USERS}').all().map(i => i.json).find(u => u.id === $('${LOOP}').first().json.user_id) ?? {}; return JSON.stringify({ ` +
  ELIGIBILITY_FIELDS.map(f => `p_${f}: user.${f} ?? null`).join(', ') +
  `, p_now: $('${TRIGGER}').first().json.timestamp ?? null }); })() }}`;
const link = node => ({ main: [[{ node, type: 'main', index: 0 }]] });

function onlyNode(workflow, name) {
  const nodes = workflow.nodes.filter(n => n.name === name);
  if (nodes.length !== 1) throw new Error('expected exactly one ' + name);
  return nodes[0];
}

function isSupabaseRead(n) {
  return n.type === 'n8n-nodes-base.httpRequest' && [undefined, 'GET'].includes(n.parameters.method) &&
    n.parameters.authentication === 'predefinedCredentialType' &&
    n.parameters.nodeCredentialType === 'supabaseApi' && !!n.credentials?.supabaseApi?.id;
}

function newNodes(workflow) {
  const users = onlyNode(workflow, USERS);
  const [, key] = users.parameters.url.match(API_KEY);
  // One row under the digest chain, so no existing node moves.
  const ROW_BELOW = 176;
  const below = (name, dx) => { const [x, y] = onlyNode(workflow, name).position; return [x + dx, y + ROW_BELOW]; };
  return [
    {
      id: '6f1d2c3b-4a5e-4f60-8b7c-9d0e1f2a3b41', name: DECIDE, type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2, position: below(EMAIL, 0),
      parameters: {
        method: 'POST',
        url: '={{ `${$vars.SUPABASE_URL}/rest/v1/rpc/pricing_audit_decide_eligibility?apikey=' + key + '` }}',
        authentication: 'predefinedCredentialType', nodeCredentialType: 'supabaseApi',
        sendBody: true, specifyBody: 'json', jsonBody: decideBody, options: {},
      },
      credentials: structuredClone(users.credentials),
      onError: 'continueRegularOutput', alwaysOutputData: true,
    },
    {
      id: '7a2e3d4c-5b6f-4a71-9c8d-0e1f2a3b4c52', name: ADD_LINE, type: 'n8n-nodes-base.code',
      typeVersion: 2, position: below(EMAIL, 224), parameters: { jsCode: addLineCode },
    },
  ];
}

export function addNextAuditLineToS4(source) {
  const problems = validateSessionFilters(source, 's4');
  if (problems.length) throw new Error('expected S4 with the #9 filters published: ' + problems.join('; '));
  const workflow = structuredClone(source);
  const users = onlyNode(workflow, USERS);
  if (!isSupabaseRead(users) || withoutKey(users.parameters.url) !== USERS_URL)
    throw new Error('unexpected ' + USERS + ' query');
  if (onlyNode(workflow, TRIGGER).type !== 'n8n-nodes-base.scheduleTrigger') throw new Error('unexpected ' + TRIGGER);
  if (onlyNode(workflow, EMAIL).type !== 'n8n-nodes-base.code') throw new Error('unexpected ' + EMAIL);
  onlyNode(workflow, SEND);
  if (workflow.nodes.some(n => [DECIDE, ADD_LINE].includes(n.name))) throw new Error('candidate already applied');
  if (!same(workflow.connections[INSERT], link(EMAIL)) || !same(workflow.connections[EMAIL], link(SEND)))
    throw new Error('unexpected digest chain');

  users.parameters.url = withEligibilityFields(users.parameters.url);
  workflow.nodes.push(...newNodes(source));
  // After Build Digest Email, so every existing node keeps the input it has today.
  workflow.connections[EMAIL] = link(DECIDE);
  workflow.connections[DECIDE] = link(ADD_LINE);
  workflow.connections[ADD_LINE] = link(SEND);

  const candidateProblems = validateNextAuditLine(workflow);
  if (candidateProblems.length) throw new Error('candidate validation: ' + candidateProblems.join('; '));
  return workflow;
}

export function validateNextAuditLine(workflow) {
  const problems = validateSessionFilters(workflow, 's4');
  const count = name => workflow.nodes?.filter(n => n.name === name).length ?? 0;
  for (const name of [USERS, INSERT, EMAIL, SEND, DECIDE, ADD_LINE])
    if (count(name) !== 1) problems.push(name + ' must exist exactly once');
  if (problems.length) return problems;
  const users = onlyNode(workflow, USERS);
  if (!isSupabaseRead(users) || withoutKey(users.parameters.url) !== withEligibilityFields(USERS_URL))
    problems.push(USERS + ' must select the eligibility fields and otherwise keep its query');
  if (problems.length) return problems;
  const expected = newNodes(workflow);
  for (const node of expected)
    if (!same(onlyNode(workflow, node.name), node)) problems.push(node.name + ' must match the reviewed node');
  const chain = [[INSERT, EMAIL], [EMAIL, DECIDE], [DECIDE, ADD_LINE], [ADD_LINE, SEND]];
  for (const [from, to] of chain)
    if (!same(workflow.connections?.[from], link(to))) problems.push(from + ' must lead to ' + to);
  return problems;
}

export function prepareCandidate(snapshot) {
  const wrapper = snapshot.workflow ?? snapshot;
  if (!wrapper.activeVersion?.nodes || wrapper.activeVersion.versionId !== wrapper.activeVersionId)
    throw new Error('expected snapshot with matching published activeVersion');
  const base = { name: wrapper.name, nodes: wrapper.activeVersion.nodes,
    connections: wrapper.activeVersion.connections, settings: wrapper.settings };
  const candidate = addNextAuditLineToS4(base);
  return { candidate, report: { workflow: 's4', sourceActiveVersionId: wrapper.activeVersionId,
    sourceDraftVersionId: wrapper.versionId, diff: diffWorkflows(base, candidate),
    validationProblems: validateNextAuditLine(candidate) } };
}

// Default CLI prints a safe report; --emit-private-json output holds live credentials and must never be logged.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [mode, input] = process.argv.slice(2);
    if (!['--report', '--emit-private-json'].includes(mode) || !input)
      throw new Error('usage: --report|--emit-private-json <private S4 snapshot>');
    const result = prepareCandidate(JSON.parse(await readFile(input, 'utf8')));
    process.stdout.write(JSON.stringify(mode === '--report' ? result.report : result.candidate));
  } catch {
    process.stderr.write('Candidate preparation failed; inspect the input privately.\n');
    process.exitCode = 1;
  }
}
