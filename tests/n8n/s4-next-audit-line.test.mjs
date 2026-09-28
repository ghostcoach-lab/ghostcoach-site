import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { keepCompletedSessionsInS4 } from '../../scripts/n8n/session-lookups-completed-only.mjs';
import {
  AUDIT_URL, DECIDE, ADD_LINE, USERS, TRIGGER, nextAuditLine, addNextAuditLineToS4, validateNextAuditLine, diffWorkflows,
  prepareCandidate,
} from '../../scripts/n8n/s4-next-audit-line.mjs';

const fixture = name => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));
// The candidate starts from S4 with the #9 filters (#19).
const s4 = keepCompletedSessionsInS4(fixture('s4-published.json'));
const node = (wf, name) => wf.nodes.find(n => n.name === name);
const targets = (wf, name) => wf.connections[name].main.map(out => out.map(c => c.node));
const SUMMER_RUN = '2026-09-28T07:00:00.007+02:00';
const userId = '00000000-0000-4000-8000-00000000abcd';

test('nextAuditLine: the five states', () => {
  const gated = next_eligible_date => ({ state: 'gated', is_welcome_audit: null, next_eligible_date });
  const cases = [
    [{ state: 'eligible', is_welcome_audit: true, next_eligible_date: null }, 'available', 'Your pricing audit is available now.'],
    [{ state: 'eligible', is_welcome_audit: false, next_eligible_date: null }, 'available', 'Your pricing audit is available now.'],
    [gated('2026-09-28'), 'today', 'Your next pricing audit opens today.'],
    [gated('2026-09-29'), 'tomorrow', 'Your next pricing audit opens tomorrow.'],
    [gated('2026-09-30'), 'in_days', 'Your next pricing audit opens in 2 days.'],
    [gated('2026-12-26'), 'in_days', 'Your next pricing audit opens in 89 days.'],
  ];
  for (const [decision, state, text] of cases)
    assert.deepEqual(nextAuditLine(decision, SUMMER_RUN), { state, text }, JSON.stringify(decision));
});

test('nextAuditLine: no line when not Entitled, on a failed call or on an unexpected response', () => {
  const noLine = {
    'not Entitled': { state: 'not_entitled', is_welcome_audit: null, next_eligible_date: null },
    'failed call': { error: 'Completed audit timestamp is missing' },
    'empty response': {},
    'missing decision': undefined,
    'unknown state': { state: 'open' },
    'eligible without the Welcome flag': { state: 'eligible' },
    'gated without a date': { state: 'gated', next_eligible_date: null },
    'gated with a non-date': { state: 'gated', next_eligible_date: 'soon' },
    'gated with an impossible date': { state: 'gated', next_eligible_date: '2026-02-30' },
    'gated in the past': { state: 'gated', next_eligible_date: '2026-09-27' },
  };
  for (const [label, decision] of Object.entries(noLine))
    assert.equal(nextAuditLine(decision, SUMMER_RUN), null, label);
  assert.equal(nextAuditLine({ state: 'eligible', is_welcome_audit: true }, undefined), null, 'no run time');
});

test('the users query also selects the eligibility fields, and nothing else changes in it', () => {
  const before = node(s4, USERS).parameters.url;
  const after = node(addNextAuditLineToS4(s4), USERS).parameters.url;
  assert.equal(after, before.replace('&select=id,email&',
    '&select=id,email,plan,status,trial_end,welcome_audit_used,last_audit_completed_at&'));
});

test('the diff: two new nodes after Build Digest Email, one changed query, nothing else', () => {
  const before = JSON.stringify(s4);
  const candidate = addNextAuditLineToS4(s4);
  assert.equal(JSON.stringify(s4), before, 'the input is not mutated');
  assert.deepEqual(diffWorkflows(s4, candidate), {
    addedNodes: [DECIDE, ADD_LINE],
    removedNodes: [],
    changedNodes: [USERS],
    changedConnections: ['Build Digest Email', DECIDE, ADD_LINE],
    otherChanges: [],
  });
  // Every existing node keeps the input it has today.
  assert.deepEqual(targets(candidate, 'INSERT digest record'), [['Build Digest Email']]);
  assert.deepEqual(targets(candidate, 'Build Digest Email'), [[DECIDE]]);
  assert.deepEqual(targets(candidate, DECIDE), [[ADD_LINE]]);
  assert.deepEqual(targets(candidate, ADD_LINE), [['Send Digest via Resend']]);
  assert.deepEqual(validateNextAuditLine(candidate), []);
  assert.ok(validateNextAuditLine(s4).length);
});

test('Decide Audit Eligibility calls the shared rule with the loop user and the trigger time', () => {
  const candidate = addNextAuditLineToS4(s4);
  const decide = node(candidate, DECIDE);
  const users = node(candidate, USERS);
  assert.equal(decide.type, 'n8n-nodes-base.httpRequest');
  assert.equal(decide.parameters.method, 'POST');
  assert.deepEqual(decide.credentials, users.credentials);
  assert.equal(decide.parameters.nodeCredentialType, 'supabaseApi');
  assert.equal(decide.onError, 'continueRegularOutput');
  assert.equal(decide.alwaysOutputData, true);
  const row = { id: userId, email: 'qa@example.test', plan: 'operator', status: 'active', trial_end: null,
    welcome_audit_used: true, last_audit_completed_at: '2026-07-01T09:00:00+00:00' };
  const other = { ...row, id: '00000000-0000-4000-8000-00000000ffff', plan: 'lifetime' };
  const scope = loopUser => ({
    $vars: { SUPABASE_URL: 'https://fixture.example' },
    $: name => ({
      [USERS]: { all: () => [{ json: other }, { json: row }] },
      'Loop — One User at a Time': { first: () => ({ json: { user_id: loopUser } }) },
      [TRIGGER]: { first: () => ({ json: { timestamp: SUMMER_RUN } }) },
    })[name],
  });
  const evaluate = (expr, loopUser = userId) => runInNewContext(expr.slice(3, -2), scope(loopUser), { timeout: 1000 });
  const url = new URL(evaluate(decide.parameters.url));
  assert.equal(url.pathname, '/rest/v1/rpc/pricing_audit_decide_eligibility');
  assert.equal(url.searchParams.get('apikey'), new URL(evaluate(users.parameters.url)).searchParams.get('apikey'));
  assert.deepEqual(JSON.parse(evaluate(decide.parameters.jsonBody)), {
    p_plan: 'operator', p_status: 'active', p_trial_end: null, p_welcome_audit_used: true,
    p_last_audit_completed_at: '2026-07-01T09:00:00+00:00', p_now: SUMMER_RUN,
  });
  const missing = JSON.parse(evaluate(decide.parameters.jsonBody, 'not-in-the-list'));
  assert.equal(missing.p_plan, null, 'an unknown user sends nulls, which the rule refuses');
});

const SIGN_OFF = "<p style='font-size:12px;color:#444'>Marcus — GhostCoach</p>";
const digestHtml = `<div><h1>Your 3 actions this week.</h1><div>Goal progress</div>${SIGN_OFF}</div></div>`;
const digestItem = { user_id: userId, email: 'qa@example.test',
  email_payload: { from: 'Marcus <marcus@example.test>', to: ['qa@example.test'], subject: 'Digest', html: digestHtml } };

function runAddLine(candidate, decision, options = {}) {
  const item = options.item ?? digestItem;
  const timestamp = 'timestamp' in options ? options.timestamp : SUMMER_RUN;
  const code = node(candidate, ADD_LINE).parameters.jsCode;
  // As in the chain: the input is the Decide Audit Eligibility result; the email comes by name.
  const out = runInNewContext(`(function () { ${code} })()`, {
    $input: { first: () => ({ json: decision }) },
    $: name => ({
      'Build Digest Email': { first: () => ({ json: structuredClone(item) }) },
      [TRIGGER]: { first: () => ({ json: { timestamp } }) },
    })[name],
  }, { timeout: 1000 });
  assert.equal(out.length, 1);
  return out[0].json;
}

test('Add Next Audit Line puts the line before the sign-off and changes nothing else in the payload', () => {
  const candidate = addNextAuditLineToS4(s4);
  const gated = runAddLine(candidate, { state: 'gated', is_welcome_audit: null, next_eligible_date: '2026-10-02' });
  const [before, after] = gated.email_payload.html.split(SIGN_OFF);
  assert.ok(before.startsWith(digestHtml.split(SIGN_OFF)[0]));
  assert.match(before, /Your next pricing audit opens in 4 days\.<\/p><\/div>$/);
  assert.equal(after, '</div></div>');
  assert.ok(!gated.email_payload.html.includes('<a '), 'only "available now" links');
  assert.deepEqual({ ...gated, email_payload: { ...gated.email_payload, html: null } },
    { ...digestItem, email_payload: { ...digestItem.email_payload, html: null } });

  const available = runAddLine(candidate, { state: 'eligible', is_welcome_audit: true, next_eligible_date: null });
  assert.ok(available.email_payload.html.includes(`<a href='${AUDIT_URL}'`));
  assert.ok(available.email_payload.html.includes('Your pricing audit is available now.</a>'));
  assert.equal(AUDIT_URL, 'https://getghostcoach.com/account/audit/');
});

test('Add Next Audit Line leaves the email unchanged when there is no line or no sign-off', () => {
  const candidate = addNextAuditLineToS4(s4);
  const unchanged = [
    ['not Entitled', { state: 'not_entitled', is_welcome_audit: null, next_eligible_date: null }, {}],
    ['failed call', { error: 'Bad Request' }, {}],
    ['no trigger time', { state: 'eligible', is_welcome_audit: true }, { timestamp: undefined }],
    ['no sign-off', { state: 'eligible', is_welcome_audit: true },
      { item: { ...digestItem, email_payload: { ...digestItem.email_payload, html: '<p>Plain</p>' } } }],
    ['no html', { state: 'eligible', is_welcome_audit: true },
      { item: { ...digestItem, email_payload: { ...digestItem.email_payload, html: undefined } } }],
  ];
  for (const [label, decision, options] of unchanged) {
    const item = options.item ?? digestItem;
    assert.deepEqual(runAddLine(candidate, decision, options), item, label);
  }
});

test('input that does not match the expected S4 shape is refused', () => {
  const variants = {
    'S4 without the #9 filters': () => fixture('s4-published.json'),
    'users query changed': wf => { node(wf, USERS).parameters.url = node(wf, USERS).parameters.url.replace('status=eq.active', 'status=eq.trialing'); },
    'users query already widened': wf => { node(wf, USERS).parameters.url = node(wf, USERS).parameters.url.replace('select=id,email', 'select=id,email,plan'); },
    'users query credential missing': wf => { delete node(wf, USERS).credentials; },
    'trigger renamed': wf => { node(wf, TRIGGER).name = 'Cron'; },
    'Build Digest Email missing': wf => { wf.nodes = wf.nodes.filter(n => n.name !== 'Build Digest Email'); },
    'chain rewired': wf => { wf.connections['INSERT digest record'].main = [[{ node: 'Send Digest via Resend', type: 'main', index: 0 }]]; },
    'Resend no longer follows the email': wf => { wf.connections['Build Digest Email'].main = [[{ node: 'Wait 30 Seconds', type: 'main', index: 0 }]]; },
    'candidate already applied': wf => addNextAuditLineToS4(wf),
  };
  for (const [variant, mutate] of Object.entries(variants)) {
    const bad = structuredClone(s4);
    const input = mutate(bad) ?? bad;
    assert.throws(() => addNextAuditLineToS4(input), undefined, variant);
  }
});

test('Add Next Audit Line code is generated with LF line endings on any checkout', () => {
  assert.ok(!node(addNextAuditLineToS4(s4), ADD_LINE).parameters.jsCode.includes('\r'));
});

test('the candidate is based on the published version, never the unrelated draft', () => {
  const draft = structuredClone(s4);
  draft.nodes[0].parameters = { draft: 'UNPUBLISHED' };
  const snapshot = { ...draft, versionId: 'draft-version', activeVersionId: 'published-version',
    activeVersion: { ...structuredClone(s4), versionId: 'published-version' } };
  const { candidate, report } = prepareCandidate(snapshot);
  assert.deepEqual(candidate.nodes[0], s4.nodes[0]);
  assert.equal(report.sourceActiveVersionId, 'published-version');
  assert.equal(report.sourceDraftVersionId, 'draft-version');
  assert.deepEqual(report.validationProblems, []);
  assert.deepEqual(report.diff.addedNodes, [DECIDE, ADD_LINE]);
  assert.throws(() => prepareCandidate({ ...snapshot, activeVersionId: 'changed' }), /matching published/);
});
