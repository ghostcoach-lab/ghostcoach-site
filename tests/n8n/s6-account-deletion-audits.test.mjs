import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import {
  addAuditDeleteToS6, validateS6Candidate, diffWorkflows, prepareCandidate,
} from '../../scripts/n8n/s6-account-deletion-audits.mjs';

const source = JSON.parse(readFileSync(new URL('./fixtures/s6-published.json', import.meta.url)));
const PREP = 'GDPR — Prep Supabase Delete';
const AUDITS = 'DELETE pricing_audits';
const SESSIONS = 'DELETE sessions';
const userId = '00000000-0000-4000-8000-00000000abcd';
const node = (wf, name) => wf.nodes.find(n => n.name === name);
const targets = (wf, name) => (wf.connections[name]?.main ?? []).map(branch => branch.map(e => e.node));
const expression = (text, context) => runInNewContext(text.slice(3, -2), context, { timeout: 1000 });
const context = {
  $json: { user_id: 'not-the-deleting-customer' },
  $vars: { SUPABASE_URL: 'https://fixture.example' },
  $: name => ({ first: () => ({ json: name === PREP ? { user_id: userId } : {} }) }),
};

test('audits are deleted immediately before the sessions delete', () => {
  const wf = addAuditDeleteToS6(source);
  assert.deepEqual(targets(wf, PREP), [['DELETE profiles', AUDITS, 'DELETE subscriptions']]);
  assert.deepEqual(targets(wf, AUDITS), [[SESSIONS]]);
  assert.deepEqual(targets(wf, SESSIONS), [['Prep Auth Delete']]);
  const into = name => Object.entries(wf.connections)
    .filter(([, outputs]) => outputs.main.some(branch => branch.some(e => e.node === name)))
    .map(([from]) => from);
  assert.deepEqual(into(SESSIONS), [AUDITS]);
  assert.deepEqual(into(AUDITS), [PREP]);
});

test('the prep branches keep their execution order under executionOrder v1', () => {
  // v1 runs sibling branches one at a time, ordered by canvas position (top first).
  const wf = addAuditDeleteToS6(source);
  assert.equal(wf.settings.executionOrder, 'v1');
  const order = workflow => workflow.connections[PREP].main[0]
    .map(e => node(workflow, e.node))
    .sort((a, b) => a.position[1] - b.position[1] || a.position[0] - b.position[0])
    .map(n => n.name === AUDITS ? SESSIONS : n.name);
  assert.deepEqual(order(wf), order(source));
});

test('the audit delete targets only the deleting customer', () => {
  const wf = addAuditDeleteToS6(source);
  const audits = node(wf, AUDITS);
  assert.equal(audits.parameters.method, 'DELETE');
  const url = new URL(expression(audits.parameters.url, context));
  assert.equal(url.origin + url.pathname, 'https://fixture.example/rest/v1/pricing_audits');
  assert.equal(url.searchParams.get('user_id'), 'eq.' + userId);
  assert.deepEqual([...url.searchParams.keys()].sort(), ['apikey', 'user_id']);
  const sessionsUrl = new URL(expression(node(wf, SESSIONS).parameters.url, context));
  assert.equal(url.search, sessionsUrl.search);
});

test('the audit delete matches the sessions delete in credential and error handling', () => {
  const wf = addAuditDeleteToS6(source);
  const audits = node(wf, AUDITS);
  const sessions = node(source, SESSIONS);
  assert.equal(audits.type, sessions.type);
  assert.equal(audits.typeVersion, sessions.typeVersion);
  assert.deepEqual(audits.credentials, sessions.credentials);
  for (const key of ['authentication', 'nodeCredentialType', 'options'])
    assert.deepEqual(audits.parameters[key], sessions.parameters[key]);
  for (const key of ['onError', 'continueOnFail', 'retryOnFail', 'maxTries', 'waitBetweenTries'])
    assert.equal(audits[key], sessions[key], key);
  assert.equal(audits.alwaysOutputData, true);
  assert.notEqual(audits.id, sessions.id);
  assert.ok(!source.nodes.some(n => n.id === audits.id));
});

test('nothing else changes: the diff shows only the new node and its two edges', () => {
  const before = JSON.stringify(source);
  const wf = addAuditDeleteToS6(source);
  assert.equal(JSON.stringify(source), before);
  assert.deepEqual(diffWorkflows(source, wf), {
    addedNodes: [AUDITS],
    removedNodes: [],
    changedNodes: [],
    changedConnections: [PREP, AUDITS],
    otherChanges: [],
  });
  assert.deepEqual(validateS6Candidate(wf), []);
});

test('input that does not match the expected S6 shape is refused', () => {
  const variants = {
    'missing sessions delete': wf => { wf.nodes = wf.nodes.filter(n => n.name !== SESSIONS); },
    'duplicate prep node': wf => { wf.nodes.push({ ...node(wf, PREP), id: 'dup' }); },
    'already has the audit delete': wf => { wf.nodes.push({ ...node(wf, SESSIONS), name: AUDITS, id: 'x' }); },
    'sessions delete not fed by prep': wf => { wf.connections[PREP].main[0] = wf.connections[PREP].main[0].filter(e => e.node !== SESSIONS); },
    'sessions delete has another source': wf => { wf.connections['DELETE profiles'].main[0].push({ node: SESSIONS, type: 'main', index: 0 }); },
    'sessions delete not followed by auth prep': wf => { wf.connections[SESSIONS] = { main: [[{ node: 'Respond 200', type: 'main', index: 0 }]] }; },
    'sessions url changed': wf => { node(wf, SESSIONS).parameters.url = '={{ $vars.SUPABASE_URL }}/rest/v1/sessions'; },
    'sessions method changed': wf => { node(wf, SESSIONS).parameters.method = 'GET'; },
    'sessions credential missing': wf => { delete node(wf, SESSIONS).credentials; },
    'sessions continues on failure': wf => { node(wf, SESSIONS).onError = 'continueRegularOutput'; },
  };
  for (const [label, mutate] of Object.entries(variants)) {
    const bad = structuredClone(source);
    mutate(bad);
    assert.throws(() => addAuditDeleteToS6(bad), undefined, label);
  }
});

test('candidate drift is reported by the validator', () => {
  const wf = addAuditDeleteToS6(source);
  node(wf, AUDITS).parameters.url = node(wf, AUDITS).parameters.url.replace('user_id=eq.', 'id=eq.');
  assert.ok(validateS6Candidate(wf).length);
  const unlinked = addAuditDeleteToS6(source);
  unlinked.connections[PREP].main[0].push({ node: SESSIONS, type: 'main', index: 0 });
  assert.ok(validateS6Candidate(unlinked).length);
  assert.ok(validateS6Candidate(source).length);
});

test('candidate is based on the published version, never the unrelated draft', () => {
  const draft = structuredClone(source);
  node(draft, 'Build Cancellation Email').parameters.jsCode = 'UNPUBLISHED DRAFT';
  const snapshot = { ...draft, versionId: 'draft-version', activeVersionId: 'published-version',
    activeVersion: { ...structuredClone(source), versionId: 'published-version' } };
  const { candidate, report } = prepareCandidate(snapshot);
  assert.deepEqual(node(candidate, 'Build Cancellation Email'), node(source, 'Build Cancellation Email'));
  assert.equal(report.sourceActiveVersionId, 'published-version');
  assert.equal(report.sourceDraftVersionId, 'draft-version');
  assert.deepEqual(report.diff.addedNodes, [AUDITS]);
  assert.deepEqual(report.validationProblems, []);
  assert.throws(() => prepareCandidate({ ...snapshot, activeVersionId: 'changed' }), /matching published/);
});
