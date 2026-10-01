// Pure, offline builder for S13, the Pricing audit availability email workflow. This module
// never calls n8n, Supabase or Resend. Production credentials are attached by ID at import time.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const S13_NAME = 'S13 — Pricing Audit Available';
const S13_QA_NAME = 'TEMP QA — S13 — Pricing Audit Available';
export const AUDIT_URL = 'https://getghostcoach.com/account/audit/';
const TRIGGER = 'Daily 07:00 Amsterdam';
const LIST = 'List Unsent Audit Opportunities';
const PREPARE = 'Prepare Availability Email';
const SEND = 'Send via Resend';
const RECORD = 'Record Accepted Send';
const SEND_FAILED = 'Stop — Send Failed';
const RECORD_FAILED = 'Stop — Record Failed';
const RESEND_URL = 'https://api.resend.com/emails';
const SEND_TIMEOUT_MS = 8000;
const edge = (...names) => ({ main: names.map(name => name ? [{ node: name, type: 'main', index: 0 }] : []) });
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Runs both in Node tests and, embedded by source, inside the n8n Code node.
export function prepareAvailabilityEmail(row, from) {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const auditUrl = 'https://getghostcoach.com/account/audit/';
  const problems = [];
  const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  if (!isObject(row)) return { ok: false, problems: ['candidate must be an object'] };
  const expected = ['user_id', 'email', 'first_name', 'audit_id'];
  if (Object.keys(row).some(key => !expected.includes(key))) problems.push('candidate has unexpected fields');
  if (typeof row.user_id !== 'string' || !uuid.test(row.user_id)) problems.push('user_id must be a UUID');
  if (typeof row.email !== 'string' || row.email.length > 254 ||
      !/^[^\s@<>\",;]+@[^\s@<>\",;]+\.[^\s@<>\",;]+$/.test(row.email))
    problems.push('email must be one address');
  if (typeof row.first_name !== 'string' || row.first_name.length > 100)
    problems.push('first_name must be a string of at most 100 characters');
  if (row.audit_id !== null && (typeof row.audit_id !== 'string' || !uuid.test(row.audit_id)))
    problems.push('audit_id must be null or a UUID');
  if (problems.length) return { ok: false, problems };

  const escape = value => String(value).replace(/[&<>"']/g, character =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  const name = row.first_name.trim();
  // PLACEHOLDER copy: GhostCoach reviews the final wording before S13 is activated.
  const greeting = name ? `Hi ${name},` : 'Hi,';
  const lines = [
    '[PLACEHOLDER COPY: final wording to come from GhostCoach]',
    greeting,
    'Your Pricing audit with Marcus is available now.',
    'Start your audit',
  ];
  const html = [
    ...lines.slice(0, 3).map(line => `<p>${escape(line)}</p>`),
    `<p><a href="${auditUrl}">${escape(lines[3])}</a></p>`,
  ].join('\n');
  const opportunity = row.audit_id ?? 'welcome';
  return {
    ok: true,
    user_id: row.user_id,
    audit_id: row.audit_id,
    idempotency_key: `pricing-audit-available:${row.user_id}:${opportunity}`,
    email: {
      from,
      to: [row.email],
      subject: '[PLACEHOLDER] Your Pricing audit is available',
      html,
      text: lines.join('\n\n') + `\n\n${auditUrl}`,
    },
  };
}

function checkOptions({ from, supabaseCredential, onlyUserId } = {}) {
  if (typeof from !== 'string' || !/^([^<>\r\n]+ )?<?[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+>?$/.test(from.trim()))
    throw new Error('from must be a sender address');
  if (typeof supabaseCredential?.id !== 'string' || !supabaseCredential.id ||
      typeof supabaseCredential?.name !== 'string' || !supabaseCredential.name)
    throw new Error('supabaseCredential needs an id and a name');
  if (onlyUserId !== undefined &&
      (typeof onlyUserId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(onlyUserId)))
    throw new Error('onlyUserId must be a UUID');
}

export function buildS13Candidate(options) {
  checkOptions(options);
  const { from, supabaseCredential, onlyUserId = null } = options;
  const credential = { supabaseApi: structuredClone(supabaseCredential) };
  const prepareCode = [
    `const FROM = ${JSON.stringify(from.trim())};`,
    `const prepareAvailabilityEmail = ${prepareAvailabilityEmail.toString()};`,
    'return $input.all().map((item, index) => {',
    '  const prepared = prepareAvailabilityEmail(item.json, FROM);',
    "  if (!prepared.ok) throw new Error('Invalid S13 candidate: ' + prepared.problems.join('; '));",
    '  return { json: prepared, pairedItem: { item: index } };',
    '});',
  ].join('\n');
  const stop = (id, name, message, position) => ({
    id, name, type: 'n8n-nodes-base.stopAndError', typeVersion: 1, position,
    parameters: { errorMessage: message },
  });
  const workflow = {
    name: onlyUserId ? S13_QA_NAME : S13_NAME,
    nodes: [
      {
        id: '13000000-0000-4000-8000-000000000001', name: TRIGGER,
        type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.2, position: [0, 0],
        parameters: { rule: { interval: [{ field: 'cronExpression', expression: '0 7 * * *' }] } },
      },
      {
        id: '13000000-0000-4000-8000-000000000002', name: LIST,
        type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [220, 0],
        parameters: {
          method: 'POST',
          url: '={{ `${$vars.SUPABASE_URL}/rest/v1/rpc/pricing_audit_availability_candidates` }}',
          authentication: 'predefinedCredentialType', nodeCredentialType: 'supabaseApi',
          sendBody: true, specifyBody: 'json',
          jsonBody: `={{ JSON.stringify({ p_now: $('${TRIGGER}').first().json.timestamp, p_only_user_id: ${JSON.stringify(onlyUserId)} }) }}`,
          options: { timeout: SEND_TIMEOUT_MS },
        },
        credentials: structuredClone(credential),
      },
      {
        id: '13000000-0000-4000-8000-000000000003', name: PREPARE,
        type: 'n8n-nodes-base.code', typeVersion: 2, position: [440, 0],
        parameters: { jsCode: prepareCode },
      },
      {
        id: '13000000-0000-4000-8000-000000000004', name: SEND,
        type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [660, 0],
        onError: 'continueErrorOutput',
        parameters: {
          method: 'POST', url: RESEND_URL, sendHeaders: true,
          headerParameters: { parameters: [
            { name: 'Authorization', value: '=Bearer {{ $vars.RESEND_API_KEY }}' },
            { name: 'Content-Type', value: 'application/json' },
            { name: 'Idempotency-Key', value: '={{ $json.idempotency_key }}' },
          ] },
          sendBody: true, specifyBody: 'json', jsonBody: '={{ JSON.stringify($json.email) }}',
          options: { timeout: SEND_TIMEOUT_MS },
        },
      },
      {
        id: '13000000-0000-4000-8000-000000000005', name: RECORD,
        type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [880, -100],
        onError: 'continueErrorOutput',
        parameters: {
          method: 'POST',
          url: '={{ `${$vars.SUPABASE_URL}/rest/v1/rpc/record_pricing_audit_availability_email` }}',
          authentication: 'predefinedCredentialType', nodeCredentialType: 'supabaseApi',
          sendBody: true, specifyBody: 'json',
          jsonBody: `={{ (() => { const opportunity = $('${PREPARE}').item.json; return JSON.stringify({ p_user_id: opportunity.user_id, p_audit_id: opportunity.audit_id, p_sent_at: $now.toISO(), p_provider_message_id: $json.id ?? null }); })() }}`,
          options: { timeout: SEND_TIMEOUT_MS },
        },
        credentials: structuredClone(credential),
      },
      stop('13000000-0000-4000-8000-000000000006', SEND_FAILED,
        'Resend did not accept an S13 email; the opportunity remains unsent.', [880, 100]),
      stop('13000000-0000-4000-8000-000000000007', RECORD_FAILED,
        'Resend accepted an S13 email but its delivery row was not recorded.', [1100, 0]),
    ],
    connections: {
      [TRIGGER]: edge(LIST),
      [LIST]: edge(PREPARE),
      [PREPARE]: edge(SEND),
      [SEND]: edge(RECORD, SEND_FAILED),
      [RECORD]: edge(null, RECORD_FAILED),
    },
    settings: { executionOrder: 'v1', timezone: 'Europe/Amsterdam', saveDataSuccessExecution: 'all' },
  };
  const problems = validateS13Candidate(workflow);
  if (problems.length) throw new Error('candidate validation: ' + problems.join('; '));
  return workflow;
}

export function validateS13Candidate(workflow) {
  const problems = [];
  const check = (condition, message) => { if (!condition) problems.push(message); };
  const nodes = workflow.nodes ?? [];
  const byName = name => nodes.filter(node => node.name === name);
  for (const name of [TRIGGER, LIST, PREPARE, SEND, RECORD, SEND_FAILED, RECORD_FAILED])
    check(byName(name).length === 1, name + ' must exist exactly once');
  if (problems.length) return problems;
  const listBody = byName(LIST)[0].parameters.jsonBody ?? '';
  const qaScoped = /p_only_user_id:\s*"[0-9a-f-]{36}"/i.test(listBody);
  check(workflow.name === (qaScoped ? S13_QA_NAME : S13_NAME), 'workflow name does not match its audience');
  check(workflow.settings?.timezone === 'Europe/Amsterdam', 'S13 timezone must be Europe/Amsterdam');
  check(workflow.settings?.saveDataSuccessExecution === 'all', 'S13 must save successful executions');
  check(byName(TRIGGER)[0].parameters.rule?.interval?.[0]?.expression === '0 7 * * *', 'S13 must run daily at 07:00');
  for (const name of [LIST, RECORD]) {
    const current = byName(name)[0];
    check(current.parameters.authentication === 'predefinedCredentialType' &&
      current.parameters.nodeCredentialType === 'supabaseApi' && !!current.credentials?.supabaseApi?.id,
    name + ' must use a Supabase credential');
  }
  check(byName(SEND)[0].onError === 'continueErrorOutput', SEND + ' must route failures separately');
  check(byName(RECORD)[0].onError === 'continueErrorOutput', RECORD + ' must route failures separately');
  const expected = {
    [TRIGGER]: edge(LIST), [LIST]: edge(PREPARE), [PREPARE]: edge(SEND),
    [SEND]: edge(RECORD, SEND_FAILED), [RECORD]: edge(null, RECORD_FAILED),
  };
  for (const [from, connection] of Object.entries(expected))
    check(same(workflow.connections?.[from], connection), from + ' has an unsafe connection');
  check(Object.keys(workflow.connections ?? {}).length === Object.keys(expected).length, 'unexpected connections');
  const headers = Object.fromEntries((byName(SEND)[0].parameters.headerParameters?.parameters ?? [])
    .map(header => [header.name, header.value]));
  check(headers['Idempotency-Key'] === '={{ $json.idempotency_key }}', SEND + ' must use the opportunity key');
  check(headers.Authorization === '=Bearer {{ $vars.RESEND_API_KEY }}', SEND + ' must read the Resend key from n8n');
  const source = JSON.stringify(workflow);
  check(!/re_[A-Za-z0-9_]{8,}/.test(source), 'S13 must not contain a Resend key');
  check(!/https:\/\/[a-z]{15,}\.supabase\.co/i.test(source), 'S13 must not contain a production Supabase URL');
  return problems;
}

export function candidateReport(workflow) {
  return {
    name: workflow.name,
    schedule: 'daily 07:00 Europe/Amsterdam',
    audience: workflow.name === S13_QA_NAME ? 'one QA customer' : 'all Entitled customers',
    nodes: workflow.nodes.map(node => ({ name: node.name, type: node.type })),
    placeholderCopy: JSON.stringify(workflow).includes('PLACEHOLDER'),
    validationProblems: validateS13Candidate(workflow),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [mode, input] = process.argv.slice(2);
    if (!['--report', '--emit-private-json'].includes(mode) || !input)
      throw new Error('usage: --report|--emit-private-json <private options>');
    const workflow = buildS13Candidate(JSON.parse(await readFile(input, 'utf8')));
    process.stdout.write(JSON.stringify(mode === '--report' ? candidateReport(workflow) : workflow));
  } catch {
    process.stderr.write('S13 candidate build failed; inspect the options privately.\n');
    process.exitCode = 1;
  }
}
