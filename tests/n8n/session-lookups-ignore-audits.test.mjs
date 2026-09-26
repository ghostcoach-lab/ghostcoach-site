import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { repairS3Workflow, validateS3Repair } from '../../scripts/n8n/s3-session-end-repair.mjs';
import {
  excludeAuditsFromS3, excludeAuditsFromS4, validateAuditFilter, diffWorkflows, prepareCandidate,
} from '../../scripts/n8n/session-lookups-ignore-audits.mjs';

const fixture = name => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));
const s4 = fixture('s4-published.json');
// The published S3 is the #4 repair applied to the pre-repair fixture.
const s3 = repairS3Workflow(fixture('s3-published.json'));
const S4_LOOKUP = 'Fetch 3 Recent Sessions1';
const S3_LOOKUP = 'Fetch Previous Session';
const userId = '00000000-0000-4000-8000-00000000abcd';
const sessionId = '00000000-0000-4000-8000-00000000dcba';
const node = (wf, name) => wf.nodes.find(n => n.name === name);
const lookupUrl = (wf, name) => new URL(runInNewContext(node(wf, name).parameters.url.slice(3, -2), {
  $json: { user_id: userId },
  $vars: { SUPABASE_URL: 'https://fixture.example' },
  $: () => ({ first: () => ({ json: { user_id: userId, session_id: sessionId } }) }),
}, { timeout: 1000 }));
const params = url => Object.fromEntries([...url.searchParams].filter(([k]) => k !== 'apikey'));

test('the S4 recent-sessions lookup excludes audit sessions and nothing else changes in it', () => {
  const before = lookupUrl(s4, S4_LOOKUP);
  const after = lookupUrl(excludeAuditsFromS4(s4), S4_LOOKUP);
  assert.equal(after.pathname, '/rest/v1/sessions');
  assert.deepEqual(params(after), { ...params(before), is_pricing_audit: 'is.false' });
  assert.deepEqual(params(before), {
    user_id: 'eq.' + userId,
    select: 'summary,action_committed,goal_progress_score,created_at',
    order: 'created_at.desc',
    limit: '3',
  });
  assert.equal(after.searchParams.get('apikey'), before.searchParams.get('apikey'));
});

test('the S3 previous-session lookup excludes audit sessions and nothing else changes in it', () => {
  const before = lookupUrl(s3, S3_LOOKUP);
  const after = lookupUrl(excludeAuditsFromS3(s3), S3_LOOKUP);
  assert.equal(after.pathname, '/rest/v1/sessions');
  assert.deepEqual(params(after), { ...params(before), is_pricing_audit: 'is.false' });
  assert.deepEqual(params(before), {
    user_id: 'eq.' + userId,
    id: 'neq.' + sessionId,
    select: 'action_committed,session_number',
    order: 'created_at.desc',
    limit: '1',
  });
});

for (const [label, transform, source, lookup] of [
  ['S4', excludeAuditsFromS4, s4, S4_LOOKUP],
  ['S3', excludeAuditsFromS3, s3, S3_LOOKUP],
]) {
  test(`${label}: the diff shows only the lookup URL change`, () => {
    const before = JSON.stringify(source);
    const candidate = transform(source);
    assert.equal(JSON.stringify(source), before);
    assert.deepEqual(diffWorkflows(source, candidate), {
      addedNodes: [], removedNodes: [], changedNodes: [lookup], changedConnections: [], otherChanges: [],
    });
    const { url: _after, ...rest } = node(candidate, lookup).parameters;
    const { url: _before, ...original } = node(source, lookup).parameters;
    assert.deepEqual(rest, original);
    assert.deepEqual({ ...node(candidate, lookup), parameters: null }, { ...node(source, lookup), parameters: null });
    assert.deepEqual(validateAuditFilter(candidate, label.toLowerCase()), []);
    assert.ok(validateAuditFilter(source, label.toLowerCase()).length);
  });

  test(`${label}: input that does not match the expected shape is refused`, () => {
    const variants = {
      'missing lookup': wf => { wf.nodes = wf.nodes.filter(n => n.name !== lookup); },
      'duplicate lookup': wf => { wf.nodes.push({ ...node(wf, lookup), id: 'dup' }); },
      'lookup already filtered': wf => { node(wf, lookup).parameters.url = node(wf, lookup).parameters.url.replace('&select=', '&is_pricing_audit=is.false&select='); },
      'lookup query changed': wf => { node(wf, lookup).parameters.url = node(wf, lookup).parameters.url.replace('order=created_at.desc', 'order=id.desc'); },
      'lookup table changed': wf => { node(wf, lookup).parameters.url = node(wf, lookup).parameters.url.replace('/sessions?', '/digests?'); },
      'lookup is not a read': wf => { node(wf, lookup).parameters.method = 'DELETE'; },
      'lookup credential missing': wf => { delete node(wf, lookup).credentials; },
    };
    for (const [variant, mutate] of Object.entries(variants)) {
      const bad = structuredClone(source);
      mutate(bad);
      assert.throws(() => transform(bad), undefined, variant);
    }
  });
}

test('S3: the #4 repair is preserved, and an unrepaired S3 is refused', () => {
  const candidate = excludeAuditsFromS3(s3);
  assert.deepEqual(validateS3Repair(s3), []);
  assert.deepEqual(validateS3Repair(candidate), []);
  assert.throws(() => excludeAuditsFromS3(fixture('s3-published.json')), /repair/);
});

test('S3 repair code is generated with LF line endings on any checkout', () => {
  for (const name of ['Parse Session Payload', 'Validate Claimed Session', 'Validate Completed Session'])
    assert.ok(!node(s3, name).parameters.jsCode.includes('\r'), name);
});

test('candidates are based on the published version, never the unrelated draft', () => {
  for (const [which, source] of [['s4', s4], ['s3', s3]]) {
    const draft = structuredClone(source);
    draft.nodes[0].parameters = { draft: 'UNPUBLISHED' };
    const snapshot = { ...draft, versionId: 'draft-version', activeVersionId: 'published-version',
      activeVersion: { ...structuredClone(source), versionId: 'published-version' } };
    const { candidate, report } = prepareCandidate(snapshot, which);
    assert.deepEqual(candidate.nodes[0], source.nodes[0]);
    assert.equal(report.workflow, which);
    assert.equal(report.sourceActiveVersionId, 'published-version');
    assert.equal(report.sourceDraftVersionId, 'draft-version');
    assert.deepEqual(report.validationProblems, []);
    assert.throws(() => prepareCandidate({ ...snapshot, activeVersionId: 'changed' }, which), /matching published/);
  }
  assert.throws(() => prepareCandidate({}, 's6'), /unknown workflow/);
});
