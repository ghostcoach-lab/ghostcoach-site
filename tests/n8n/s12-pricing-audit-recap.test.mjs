import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';

import { buildS12Candidate, candidateReport, validateS12Candidate } from '../../scripts/n8n/s12-pricing-audit-recap.mjs';

const options = {
  from: 'Marcus <marcus@example.test>',
  webhookCredential: { id: 'credential-fixture', name: 'S12 recap caller' },
};
const auditId = '9d1f7a52-6a0e-4b8e-9d0c-1a2b3c4d5e6f';
const payload = {
  audit_id: auditId,
  email: 'founder@example.test',
  first_name: 'Sam',
  verdict: {
    action: 'raise',
    number: '59 per month',
    deadline: '2026-11-01',
    reasoning: 'Customers buy it for the time it saves.',
  },
  next_eligible_date: '2026-12-23',
};

const node = (workflow, name) => workflow.nodes.find(n => n.name === name);

// Runs the candidate's own Code node the way n8n does: the webhook item carries the body.
function runValidation(body, workflow = buildS12Candidate(options)) {
  const code = node(workflow, 'Validate Recap Payload').parameters.jsCode;
  const input = { first: () => ({ json: { headers: {}, body } }) };
  const items = vm.runInNewContext(`(function () {\n${code}\n})()`, { $input: input });
  assert.equal(items.length, 1);
  // n8n passes item JSON on serialized; this also drops the sandbox's own prototypes.
  return JSON.parse(JSON.stringify(items[0].json));
}

test('a valid payload becomes one email keyed by the audit ID', () => {
  const result = runValidation(payload);
  assert.equal(result.ok, true);
  assert.equal(result.idempotency_key, auditId);
  assert.equal(result.email.from, 'Marcus <marcus@example.test>');
  assert.deepEqual(result.email.to, ['founder@example.test']);
  assert.ok(result.email.subject.length > 0);
  for (const body of [result.email.html, result.email.text]) {
    assert.match(body, /Sam/);
    assert.match(body, /Raise/);
    assert.match(body, /59 per month/);
    assert.match(body, /Customers buy it for the time it saves\./);
    assert.match(body, /1 November 2026/, 'the Verdict deadline');
    assert.match(body, /23 December 2026/, 'the next eligible date');
    assert.match(body, /next pricing audit/i, 'the forward-looking line');
    assert.match(body, /PLACEHOLDER/, 'the draft wording is clearly marked');
  }
});

test('a hold Verdict has no number and says so without "null"', () => {
  const result = runValidation({ ...payload, verdict: { ...payload.verdict, action: 'hold', number: null } });
  assert.equal(result.ok, true);
  assert.match(result.email.text, /Verdict: Hold\n/);
  assert.doesNotMatch(result.email.text, /null/);
});

test('a missing first name still greets the customer', () => {
  const result = runValidation({ ...payload, first_name: '  ' });
  assert.equal(result.ok, true);
  assert.match(result.email.text, /^Hi,$/m);
});

test('an invalid payload is refused, and the problems never echo its values', () => {
  const verdict = changes => ({ ...payload, verdict: { ...payload.verdict, ...changes } });
  const cases = {
    'not an object': 'just text',
    'an array': [payload],
    'a missing field': (({ first_name, ...rest }) => rest)(payload),
    'an extra field': { ...payload, user_id: 'someone-else' },
    'a non-UUID audit ID': { ...payload, audit_id: 'audit-secret-value' },
    'two addresses': { ...payload, email: 'a@example.test, b@example.test' },
    'no address': { ...payload, email: 'nobody' },
    'an unknown action': verdict({ action: 'double' }),
    'a hold with a number': verdict({ action: 'hold' }),
    'a raise without a number': verdict({ number: null }),
    'a blank number': verdict({ number: '  ' }),
    'an impossible deadline': verdict({ deadline: '2026-02-30' }),
    'blank reasoning': verdict({ reasoning: '   ' }),
    'an extra Verdict field': verdict({ baseline: {} }),
    'a missing Verdict': { ...payload, verdict: null },
    'a timestamp as next date': { ...payload, next_eligible_date: '2026-12-23T00:00:00Z' },
  };
  for (const [label, body] of Object.entries(cases)) {
    const result = runValidation(body);
    assert.equal(result.ok, false, label);
    assert.ok(result.problems.length > 0, label);
    const problems = JSON.stringify(result.problems);
    for (const secret of ['audit-secret-value', 'someone-else', 'example.test', 'double'])
      assert.ok(!problems.includes(secret), label + ' echoes a value');
  }
});

test('customer text is HTML-escaped in the email', () => {
  const result = runValidation({ ...payload, first_name: '<img src=x onerror=alert(1)>' });
  assert.equal(result.ok, true);
  assert.doesNotMatch(result.email.html, /<img/);
  assert.match(result.email.html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

// Resolves where an item leaving a node's output goes.
const next = (workflow, name, output = 0) =>
  (workflow.connections[name]?.main?.[output] ?? []).map(e => e.node);

test('an unauthenticated caller is refused: the webhook requires its own header credential', () => {
  const workflow = buildS12Candidate(options);
  const hook = node(workflow, 'Webhook — Pricing Audit Recap');
  assert.equal(hook.parameters.authentication, 'headerAuth');
  assert.deepEqual(hook.credentials, { httpHeaderAuth: options.webhookCredential });
  assert.equal(hook.parameters.httpMethod, 'POST');
  assert.equal(hook.parameters.responseMode, 'responseNode');
  // It never falls back to the browser's shared secret.
  assert.doesNotMatch(JSON.stringify(workflow), /x-gc-secret/i);
  assert.deepEqual(validateS12Candidate(workflow), []);
  for (const authentication of ['none', 'basicAuth']) {
    const open = structuredClone(workflow);
    node(open, 'Webhook — Pricing Audit Recap').parameters.authentication = authentication;
    assert.ok(validateS12Candidate(open).some(p => /header credential/.test(p)), authentication);
  }
});

test('the email goes to Resend once, keyed by the audit ID', () => {
  const workflow = buildS12Candidate(options);
  const send = node(workflow, 'Send Recap via Resend');
  assert.equal(send.parameters.method, 'POST');
  assert.equal(send.parameters.url, 'https://api.resend.com/emails');
  const headers = Object.fromEntries(send.parameters.headerParameters.parameters.map(h => [h.name, h.value]));
  assert.equal(headers['Idempotency-Key'], '={{ $json.idempotency_key }}');
  assert.equal(headers.Authorization, '=Bearer {{ $vars.RESEND_API_KEY }}');
  assert.equal(send.parameters.jsonBody, '={{ JSON.stringify($json.email) }}');
  assert.ok(!send.retryOnFail, 'n8n does not resend on its own');
  const keyed = structuredClone(workflow);
  node(keyed, 'Send Recap via Resend').parameters.headerParameters.parameters[2].value = '={{ $now }}';
  assert.ok(validateS12Candidate(keyed).some(p => /audit ID/.test(p)));
});

test('S12 answers 2xx only after Resend accepts the email', () => {
  const workflow = buildS12Candidate(options);
  const params = n => node(workflow, n).parameters;
  assert.deepEqual(next(workflow, 'Webhook — Pricing Audit Recap'), ['Validate Recap Payload']);
  assert.deepEqual(next(workflow, 'Validate Recap Payload'), ['Payload Valid?']);
  assert.deepEqual(next(workflow, 'Payload Valid?', 0), ['Send Recap via Resend']);
  assert.deepEqual(next(workflow, 'Payload Valid?', 1), ['Respond 400 Invalid']);
  assert.deepEqual(next(workflow, 'Send Recap via Resend', 0), ['Respond 200 Sent']);
  assert.deepEqual(next(workflow, 'Send Recap via Resend', 1), ['Respond 502 Not Sent']);
  assert.equal(node(workflow, 'Send Recap via Resend').onError, 'continueErrorOutput');
  assert.equal(params('Respond 200 Sent').options.responseCode, 200);
  assert.equal(params('Respond 502 Not Sent').options.responseCode, 502);
  assert.equal(params('Respond 400 Invalid').options.responseCode, 400);
  const leaky = structuredClone(workflow);
  leaky.connections['Payload Valid?'].main[1] = [{ node: 'Respond 200 Sent', type: 'main', index: 0 }];
  assert.ok(validateS12Candidate(leaky).length > 0, 'an invalid payload must not answer 200');
});

test('S12 saves successful executions, so the live QA can count exactly one recap run', () => {
  const workflow = buildS12Candidate(options);
  assert.equal(workflow.settings.saveDataSuccessExecution, 'all');
  assert.deepEqual(validateS12Candidate(workflow), []);
  const unsaved = structuredClone(workflow);
  unsaved.settings.saveDataSuccessExecution = 'none';
  assert.ok(validateS12Candidate(unsaved).some(p => /successful executions/.test(p)));
  delete unsaved.settings.saveDataSuccessExecution;
  assert.ok(validateS12Candidate(unsaved).some(p => /successful executions/.test(p)), 'the instance default is not enough');
});

test('S12 has no database access and no secret in its JSON', () => {
  const source = JSON.stringify(buildS12Candidate(options));
  assert.doesNotMatch(source, /supabase|\/rest\/v1\//i);
  assert.doesNotMatch(source, /re_[A-Za-z0-9_]{8,}/);
  assert.doesNotMatch(source, /Bearer [A-Za-z0-9]/, 'only $vars supplies the Resend key');
});

test('the build needs a sender address and a webhook credential', () => {
  for (const bad of [
    { ...options, from: undefined },
    { ...options, from: 'Marcus' },
    { ...options, from: 'a@example.test\r\nBcc: b@example.test' },
    { ...options, webhookCredential: undefined },
    { ...options, webhookCredential: { id: '', name: 'x' } },
  ]) assert.throws(() => buildS12Candidate(bad));
});

test('the report shows neither the sender address nor the credential ID', () => {
  const report = JSON.stringify(candidateReport(buildS12Candidate(options)));
  assert.doesNotMatch(report, /example\.test|credential-fixture/);
  assert.match(report, /"placeholderCopy":true/);
  assert.match(report, /"validationProblems":\[\]/);
});
