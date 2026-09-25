// Pure, offline builder for S12, the pricing-audit recap workflow. This module never calls n8n,
// Supabase or Resend. S12 has no database access: the Completion endpoint sends everything the
// email needs, and records recap_sent_at itself when S12 answers 2xx.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const S12_NAME = 'S12 — Pricing Audit Recap';
export const S12_WEBHOOK_PATH = 'gc-s12-pricing-audit-recap';
const WEBHOOK = 'Webhook — Pricing Audit Recap';
const VALIDATE = 'Validate Recap Payload';
const VALID = 'Payload Valid?';
const SEND = 'Send Recap via Resend';
const SENT = 'Respond 200 Sent';
const INVALID = 'Respond 400 Invalid';
const NOT_SENT = 'Respond 502 Not Sent';
const RESEND_URL = 'https://api.resend.com/emails';
const SEND_TIMEOUT_MS = 8000;
const edge = (...names) => ({ main: names.map(name => name ? [{ node: name, type: 'main', index: 0 }] : []) });
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Runs inside the n8n Code node (it is embedded by source), so it must stay self-contained.
// Problems name the field only, never its value.
export function prepareRecap(body, from) {
  const problems = [];
  const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const exactKeys = (value, keys, label) => {
    const extra = Object.keys(value).filter(k => !keys.includes(k));
    if (extra.length) problems.push(label + ' has unexpected fields');
  };
  const isDate = v => {
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
    const d = new Date(v + 'T00:00:00Z');
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  };
  const text = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;

  if (!isObject(body)) return { ok: false, problems: ['body must be an object'] };
  exactKeys(body, ['audit_id', 'email', 'first_name', 'verdict', 'next_eligible_date'], 'body');
  if (typeof body.audit_id !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.audit_id))
    problems.push('audit_id must be a UUID');
  if (typeof body.email !== 'string' || body.email.length > 254 ||
      !/^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$/.test(body.email))
    problems.push('email must be one address');
  if (typeof body.first_name !== 'string' || body.first_name.length > 100)
    problems.push('first_name must be a string of at most 100 characters');
  const verdict = body.verdict;
  if (!isObject(verdict)) {
    problems.push('verdict must be an object');
  } else {
    exactKeys(verdict, ['action', 'number', 'deadline', 'reasoning'], 'verdict');
    if (!['raise', 'hold', 'restructure'].includes(verdict.action))
      problems.push('verdict.action must be raise, hold or restructure');
    else if (verdict.action === 'hold' ? verdict.number !== null : !text(verdict.number, 200))
      problems.push('verdict.number must be null for hold and set otherwise');
    if (!isDate(verdict.deadline)) problems.push('verdict.deadline must be a date');
    if (!text(verdict.reasoning, 4000)) problems.push('verdict.reasoning must be set');
  }
  if (!isDate(body.next_eligible_date)) problems.push('next_eligible_date must be a date');
  if (problems.length) return { ok: false, problems };

  const escape = v => String(v).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
    'September', 'October', 'November', 'December'];
  const longDate = v => {
    const [y, m, d] = v.split('-').map(Number);
    return d + ' ' + months[m - 1] + ' ' + y;
  };
  const name = body.first_name.trim();
  const decision = { raise: 'Raise', hold: 'Hold', restructure: 'Restructure' }[verdict.action] +
    (verdict.number === null ? '' : ': ' + verdict.number.trim());
  const deadline = longDate(verdict.deadline);
  const nextDate = longDate(body.next_eligible_date);

  // PLACEHOLDER copy: the client supplies the final wording before launch.
  const lines = [
    '[PLACEHOLDER COPY: final wording to come from GhostCoach]',
    name ? 'Hi ' + name + ',' : 'Hi,',
    'Here is the Verdict from your pricing audit with Marcus.',
    'Verdict: ' + decision,
    'Why: ' + verdict.reasoning.trim(),
    'Act by: ' + deadline,
    'Your next pricing audit opens on ' + nextDate + '. It will check what you did with this ' +
      'Verdict and what has changed in your pricing since.',
  ];
  return {
    ok: true,
    audit_id: body.audit_id,
    idempotency_key: body.audit_id,
    email: {
      from,
      to: [body.email],
      subject: '[PLACEHOLDER] Your pricing audit Verdict',
      html: lines.map(line => '<p>' + escape(line) + '</p>').join('\n'),
      text: lines.join('\n\n'),
    },
  };
}

function checkOptions({ from, webhookCredential } = {}) {
  if (typeof from !== 'string' || !/^([^<>\r\n]+ )?<?[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+>?$/.test(from.trim()))
    throw new Error('from must be a sender address');
  if (typeof webhookCredential?.id !== 'string' || !webhookCredential.id ||
      typeof webhookCredential?.name !== 'string' || !webhookCredential.name)
    throw new Error('webhookCredential needs an id and a name');
}

export function buildS12Candidate(options) {
  checkOptions(options);
  const { from, webhookCredential } = options;
  const jsCode = [
    `const FROM = ${JSON.stringify(from.trim())};`,
    `const prepareRecap = ${prepareRecap.toString()};`,
    'return [{ json: prepareRecap($input.first().json.body, FROM) }];',
  ].join('\n');
  const respond = (id, name, body, code, position) => ({
    id, name, type: 'n8n-nodes-base.respondToWebhook', typeVersion: 1, position,
    parameters: { respondWith: 'json', responseBody: '=' + JSON.stringify(body), options: { responseCode: code } },
  });
  const workflow = {
    name: S12_NAME,
    nodes: [
      {
        id: '5b0e6f0e-1c8a-4d3e-9f52-7a1c2e3d4b01', name: WEBHOOK, type: 'n8n-nodes-base.webhook',
        typeVersion: 2, position: [0, 0], webhookId: '0f6a9c3e-2b7d-4e81-a5c4-9d2e1f3b6a02',
        // n8n rejects a request without the dedicated header before the workflow runs.
        parameters: { httpMethod: 'POST', path: S12_WEBHOOK_PATH, authentication: 'headerAuth',
          responseMode: 'responseNode', options: {} },
        credentials: { httpHeaderAuth: { id: webhookCredential.id, name: webhookCredential.name } },
      },
      {
        id: '8c2d4e6f-3a5b-4c7d-8e9f-0a1b2c3d4e03', name: VALIDATE, type: 'n8n-nodes-base.code',
        typeVersion: 2, position: [220, 0], parameters: { jsCode },
      },
      {
        id: '1a3c5e7f-9b2d-4f6a-8c0e-2d4f6a8c0e04', name: VALID, type: 'n8n-nodes-base.if',
        typeVersion: 2, position: [440, 0],
        parameters: {
          conditions: {
            options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
            conditions: [{
              id: '6d8f0a2c-4e6b-4d8f-9a1c-3e5b7d9f1a05', leftValue: '={{ $json.ok }}', rightValue: '',
              operator: { type: 'boolean', operation: 'true', singleValue: true },
            }],
            combinator: 'and',
          },
          options: {},
        },
      },
      {
        id: '2b4d6f8a-0c1e-4a3b-9d5f-7b9d1f3a5c06', name: SEND, type: 'n8n-nodes-base.httpRequest',
        typeVersion: 4.2, position: [660, -100],
        // A non-2xx answer or a timeout takes the error output, so S12 never reports a failed send as sent.
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
      respond('3c5e7a9b-1d2f-4b4c-8e6a-8c0e2a4b6d07', SENT, { sent: true }, 200, [880, -200]),
      respond('4d6f8b0c-2e3a-4c5d-9f7b-9d1f3b5c7e08', NOT_SENT, { sent: false }, 502, [880, 0]),
      respond('7e9a1c3d-5f6b-4e8d-a0c2-0e2a4c6e8f09', INVALID, { reason: 'invalid_request' }, 400, [660, 100]),
    ],
    connections: {
      [WEBHOOK]: edge(VALIDATE),
      [VALIDATE]: edge(VALID),
      [VALID]: edge(SEND, INVALID),
      [SEND]: edge(SENT, NOT_SENT),
    },
    settings: { executionOrder: 'v1' },
  };
  const problems = validateS12Candidate(workflow);
  if (problems.length) throw new Error('candidate validation: ' + problems.join('; '));
  return workflow;
}

export function validateS12Candidate(workflow) {
  const problems = [];
  const check = (ok, message) => { if (!ok) problems.push(message); };
  const nodes = workflow.nodes ?? [];
  const byName = name => nodes.filter(n => n.name === name);
  for (const name of [WEBHOOK, VALIDATE, VALID, SEND, SENT, NOT_SENT, INVALID])
    check(byName(name).length === 1, name + ' must exist exactly once');
  check(new Set(nodes.map(n => n.name)).size === nodes.length, 'duplicate node names');

  const triggers = nodes.filter(n => /trigger|webhook/i.test(n.type) && n.type !== 'n8n-nodes-base.respondToWebhook');
  check(triggers.length === 1 && triggers[0].name === WEBHOOK, WEBHOOK + ' must be the only trigger');
  const [hook] = byName(WEBHOOK);
  if (hook) {
    check(hook.parameters.httpMethod === 'POST' && hook.parameters.path === S12_WEBHOOK_PATH,
      WEBHOOK + ' must be POST ' + S12_WEBHOOK_PATH);
    check(hook.parameters.authentication === 'headerAuth' && !!hook.credentials?.httpHeaderAuth?.id,
      WEBHOOK + ' must require its own header credential');
    check(hook.parameters.responseMode === 'responseNode', WEBHOOK + ' must answer from a respond node');
  }
  const [send] = byName(SEND);
  if (send) {
    const headers = Object.fromEntries((send.parameters.headerParameters?.parameters ?? []).map(h => [h.name, h.value]));
    check(send.parameters.method === 'POST' && send.parameters.url === RESEND_URL, SEND + ' must POST to Resend');
    check(headers['Idempotency-Key'] === '={{ $json.idempotency_key }}', SEND + ' must key the send by audit ID');
    check(headers.Authorization === '=Bearer {{ $vars.RESEND_API_KEY }}', SEND + ' must read the Resend key from n8n');
    check(send.onError === 'continueErrorOutput', SEND + ' must route failures to its error output');
  }
  check(same(workflow.connections?.[WEBHOOK], edge(VALIDATE)), WEBHOOK + ' must feed only ' + VALIDATE);
  check(same(workflow.connections?.[VALIDATE], edge(VALID)), VALIDATE + ' must feed only ' + VALID);
  check(same(workflow.connections?.[VALID], edge(SEND, INVALID)), VALID + ' must send only a valid payload');
  check(same(workflow.connections?.[SEND], edge(SENT, NOT_SENT)), SEND + ' must answer 2xx only after a send');
  check(Object.keys(workflow.connections ?? {}).length === 4, 'unexpected connections');

  // No database access, and no secret written into the workflow.
  const source = JSON.stringify(workflow);
  check(!/supabase|\/rest\/v1\//i.test(source), 'S12 must not touch the database');
  check(!/re_[A-Za-z0-9_]{8,}/.test(source), 'S12 must not contain a Resend key');
  return problems;
}

export function candidateReport(workflow) {
  return {
    name: workflow.name,
    webhookPath: S12_WEBHOOK_PATH,
    nodes: workflow.nodes.map(n => ({ name: n.name, type: n.type })),
    placeholderCopy: JSON.stringify(workflow).includes('PLACEHOLDER'),
    validationProblems: validateS12Candidate(workflow),
  };
}

// Options come from a private JSON file: { from, webhookCredential: { id, name } }. The sender
// address and the credential ID stay out of git, so --report prints neither.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [mode, input] = process.argv.slice(2);
    if (!['--report', '--emit-private-json'].includes(mode) || !input)
      throw new Error('usage: --report|--emit-private-json <private options>');
    const workflow = buildS12Candidate(JSON.parse(await readFile(input, 'utf8')));
    process.stdout.write(JSON.stringify(mode === '--report' ? candidateReport(workflow) : workflow));
  } catch {
    process.stderr.write('S12 candidate build failed; inspect the options privately.\n');
    process.exitCode = 1;
  }
}
