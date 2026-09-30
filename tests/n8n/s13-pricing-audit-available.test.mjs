import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';

import {
  AUDIT_URL,
  S13_NAME,
  buildS13Candidate,
  candidateReport,
  prepareAvailabilityEmail,
  validateS13Candidate,
} from '../../scripts/n8n/s13-pricing-audit-available.mjs';

const options = {
  from: 'Marcus <marcus@example.test>',
  supabaseCredential: { id: 'supabase-fixture', name: 'Supabase fixture' },
};
const userId = '00000000-0000-4000-8000-000000000001';
const auditId = '10000000-0000-4000-8000-000000000001';
const candidate = {
  user_id: userId,
  email: 'founder@example.test',
  first_name: 'Sam',
  audit_id: null,
};
const node = (workflow, name) => workflow.nodes.find(item => item.name === name);
const targets = (workflow, name) => workflow.connections[name].main.map(output => output.map(item => item.node));

test('prepareAvailabilityEmail builds one escaped transactional email per opportunity', () => {
  const welcome = prepareAvailabilityEmail(candidate, options.from);
  assert.equal(welcome.ok, true);
  assert.equal(welcome.idempotency_key, `pricing-audit-available:${userId}:welcome`);
  assert.equal(welcome.user_id, userId);
  assert.equal(welcome.audit_id, null);
  assert.deepEqual(welcome.email.to, ['founder@example.test']);
  assert.match(welcome.email.subject, /pricing audit/i);
  assert.match(welcome.email.html, new RegExp(AUDIT_URL.replaceAll('/', '\\/')));
  assert.match(welcome.email.html, /Hi Sam,/);

  const returning = prepareAvailabilityEmail({ ...candidate, first_name: '<Sam>', audit_id: auditId }, options.from);
  assert.equal(returning.idempotency_key, `pricing-audit-available:${userId}:${auditId}`);
  assert.match(returning.email.html, /Hi &lt;Sam&gt;,/);
  assert.doesNotMatch(returning.email.html, /Hi <Sam>,/);
});

test('prepareAvailabilityEmail refuses malformed database rows without exposing their values', () => {
  const bad = [
    null,
    { ...candidate, user_id: 'no' },
    { ...candidate, email: 'not-an-email' },
    { ...candidate, first_name: 'x'.repeat(101) },
    { ...candidate, audit_id: 'no' },
    { ...candidate, extra: true },
  ];
  for (const value of bad) {
    const result = prepareAvailabilityEmail(value, options.from);
    assert.equal(result.ok, false);
    assert.ok(result.problems.length > 0);
    assert.doesNotMatch(JSON.stringify(result.problems), /founder@example\.test/);
  }
});

test('S13 is a daily Amsterdam workflow that lists, sends, then records accepted emails', () => {
  const workflow = buildS13Candidate(options);
  assert.equal(workflow.name, S13_NAME);
  assert.equal(workflow.settings.timezone, 'Europe/Amsterdam');
  assert.deepEqual(validateS13Candidate(workflow), []);
  assert.deepEqual(targets(workflow, 'Daily 07:00 Amsterdam'), [['List Unsent Audit Opportunities']]);
  assert.deepEqual(targets(workflow, 'List Unsent Audit Opportunities'), [['Prepare Availability Email']]);
  assert.deepEqual(targets(workflow, 'Prepare Availability Email'), [['Send via Resend']]);
  assert.deepEqual(targets(workflow, 'Send via Resend'), [['Record Accepted Send'], ['Stop — Send Failed']]);
  assert.deepEqual(targets(workflow, 'Record Accepted Send'), [[], ['Stop — Record Failed']]);

  const schedule = node(workflow, 'Daily 07:00 Amsterdam');
  assert.equal(schedule.parameters.rule.interval[0].expression, '0 7 * * *');
  const list = node(workflow, 'List Unsent Audit Opportunities');
  assert.match(list.parameters.url, /pricing_audit_availability_candidates/);
  assert.equal(list.credentials.supabaseApi.id, options.supabaseCredential.id);
  assert.match(list.parameters.jsonBody, /p_now/);

  const send = node(workflow, 'Send via Resend');
  const headers = Object.fromEntries(send.parameters.headerParameters.parameters.map(h => [h.name, h.value]));
  assert.equal(headers['Idempotency-Key'], '={{ $json.idempotency_key }}');
  assert.equal(send.onError, 'continueErrorOutput');

  const record = node(workflow, 'Record Accepted Send');
  assert.match(record.parameters.url, /record_pricing_audit_availability_email/);
  assert.equal(record.credentials.supabaseApi.id, options.supabaseCredential.id);
  assert.equal(record.onError, 'continueErrorOutput');
});

test('the embedded Prepare node has the same behavior as the exported email seam', () => {
  const workflow = buildS13Candidate(options);
  const code = node(workflow, 'Prepare Availability Email').parameters.jsCode;
  const output = vm.runInNewContext(`(function () { ${code} })()`, {
    $input: { all: () => [{ json: candidate }] },
  }, { timeout: 1000 });
  assert.equal(output.length, 1);
  assert.equal(output[0].json.idempotency_key, prepareAvailabilityEmail(candidate, options.from).idempotency_key);
  assert.deepEqual(Array.from(output[0].json.email.to), ['founder@example.test']);
  assert.deepEqual({ ...output[0].pairedItem }, { item: 0 });
});

test('validator rejects changes that could skip deduplication or leak a secret', () => {
  const mutations = {
    'records failures': workflow => { workflow.connections['Send via Resend'].main[1] = [{ node: 'Record Accepted Send', type: 'main', index: 0 }]; },
    'records before send': workflow => { workflow.connections['Prepare Availability Email'].main[0][0].node = 'Record Accepted Send'; },
    'missing service credential': workflow => { delete node(workflow, 'Record Accepted Send').credentials; },
    'wrong schedule': workflow => { node(workflow, 'Daily 07:00 Amsterdam').parameters.rule.interval[0].expression = '0 7 * * 1'; },
    'embedded Resend secret': workflow => { node(workflow, 'Send via Resend').parameters.headerParameters.parameters[0].value = 'Bearer re_secret123456'; },
  };
  for (const [label, mutate] of Object.entries(mutations)) {
    const workflow = buildS13Candidate(options);
    mutate(workflow);
    assert.ok(validateS13Candidate(workflow).length, label);
  }
});

test('candidate report is safe and calls out placeholder copy', () => {
  const report = candidateReport(buildS13Candidate(options));
  assert.equal(report.name, S13_NAME);
  assert.equal(report.placeholderCopy, true);
  assert.deepEqual(report.validationProblems, []);
  const text = JSON.stringify(report);
  assert.doesNotMatch(text, /founder@example\.test|supabase-fixture|marcus@example\.test/);
});

test('a temporary QA candidate scopes the database call to one private customer ID', () => {
  const qaUserId = '00000000-0000-4000-8000-000000000099';
  const workflow = buildS13Candidate({ ...options, onlyUserId: qaUserId });
  assert.match(workflow.name, /^TEMP QA — /);
  assert.match(node(workflow, 'List Unsent Audit Opportunities').parameters.jsonBody, new RegExp(qaUserId));
  assert.deepEqual(validateS13Candidate(workflow), []);
  const report = candidateReport(workflow);
  assert.equal(report.audience, 'one QA customer');
  assert.doesNotMatch(JSON.stringify(report), new RegExp(qaUserId));
});
