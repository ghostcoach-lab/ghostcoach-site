import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { repairS3Workflow, validateS3Repair, prepareCandidate } from '../../scripts/n8n/s3-session-end-repair.mjs';

const source = JSON.parse(readFileSync(new URL('./fixtures/s3-published.json', import.meta.url)));
const sessionId = '7835879c-65c0-4420-bae9-8a9faaa90cfa';
const userId = 'b4638b4b-e6c3-4168-aabb-d07e0a00f31f';
const body = { session_id: sessionId, user_id: userId, transcript: 'Founder: QA transcript' };
const row = { id: sessionId, user_id: userId, transcript: body.transcript, is_pricing_audit: false, processing_status: 'pending' };
const node = (wf, name) => wf.nodes.find(n => n.name === name);
const expression = (text, context) => runInNewContext(text.slice(3, -2), context, { timeout: 1000 });
const reference = parsed => name => ({ first: () => ({json: name === 'Parse Session Payload' ? parsed : { ...parsed, summary: 'Summary', new_score: 5, action_committed: 'QA action' } }) });
function code(wf, name, items, parsed = body) {
  return runInNewContext('(function(){'+node(wf, name).parameters.jsCode+'})()', {
    $input: { all: () => items.map(json => ({json})), first: () => ({json: items[0]}) },
    $: reference(parsed),
  }, {timeout: 1000});
}

test('parser requires valid identifiers, transcript and normal-session type', () => {
  const wf = repairS3Workflow(source);
  assert.equal(code(wf, 'Parse Session Payload', [{body}])[0].json.session_id, sessionId);
  for (const bad of [
    {...body, session_id: undefined}, {...body, user_id: 'bad&or=true'},
    {...body, transcript: ''}, {...body, transcript: '  '}, {...body, transcript: {}},
    {...body, is_pricing_audit: true}, {...body, is_pricing_audit: 'true'},
  ]) assert.throws(() => code(wf, 'Parse Session Payload', [{body: bad}]));
});

test('claim targets existing owned normal pending empty row and writes only transcript', () => {
  const wf = repairS3Workflow(source);
  const claim = node(wf, 'CLAIM existing session transcript');
  const context = {$json: body, $vars: {SUPABASE_URL:'https://fixture.example'}, $: reference(body)};
  const url = new URL(expression(claim.parameters.url, context));
  assert.equal(claim.parameters.method, 'PATCH');
  for (const [key, value] of Object.entries({id:'eq.'+sessionId, user_id:'eq.'+userId,
    is_pricing_audit:'is.false', processing_status:'eq.pending', or:'(transcript.is.null,transcript.eq.)'}))
    assert.equal(url.searchParams.get(key), value);
  assert.deepEqual(JSON.parse(expression(claim.parameters.jsonBody, context)), {transcript: body.transcript});
  assert.equal(claim.alwaysOutputData, true);
});

test('claim guard handles split items, arrays, zero rows and identity mismatch', () => {
  const wf = repairS3Workflow(source);
  for (const input of [[row], [[row]]])
    assert.equal(code(wf, 'Validate Claimed Session', input)[0].json.session_id, sessionId);
  for (const input of [[], [{}], [[]], [row,row], [[row,row]],
    [{...row,id:userId}], [{...row,user_id:sessionId}], [{...row,is_pricing_audit:true}],
    [{...row,processing_status:'complete'}], [{...row,transcript:'other'}]])
    assert.throws(() => code(wf, 'Validate Claimed Session', input));
});

test('completion verifies all rows before profile/email and preserves audit metadata', () => {
  const wf = repairS3Workflow(source);
  const complete = {...row,processing_status:'complete'};
  assert.equal(code(wf,'Validate Completed Session',[complete])[0].json.id, sessionId);
  for (const input of [[{}],[],[complete,complete],[{...complete,user_id:sessionId}],[row]])
    assert.throws(() => code(wf,'Validate Completed Session',input));
  const update = node(wf,'UPDATE session (summary + score)');
  const context = {$json:{...body,summary:'Summary',new_score:5,action_committed:'QA'}, $:reference(body),$vars:{SUPABASE_URL:'https://fixture.example'}};
  const url = new URL(expression(update.parameters.url,context));
  assert.equal(url.searchParams.get('id'),'eq.'+sessionId);
  assert.equal(url.searchParams.get('user_id'),'eq.'+userId);
  const payload = JSON.parse(expression(update.parameters.jsonBody,context));
  assert.equal(payload.processing_status,'complete');
  for(const field of ['is_pricing_audit','audit_intake','created_at','retry_count']) assert.equal(field in payload,false);
  assert.equal(update.alwaysOutputData,true);
  assert.equal(wf.connections[update.name].main[0][0].node,'Validate Completed Session');
  assert.equal(wf.connections['Validate Completed Session'].main[0][0].node,'UPDATE profiles.goal_progress');
});

test('provider key is stable, recap and credentials preserved, source not mutated', () => {
  const before = JSON.stringify(source);
  const wf = repairS3Workflow(source);
  assert.equal(JSON.stringify(source),before);
  assert.deepEqual(node(wf,'Build Recap Email'),node(source,'Build Recap Email'));
  for(const n of source.nodes) assert.deepEqual(wf.nodes.find(x=>x.id===n.id).credentials,n.credentials);
  const header = node(wf,'Send Recap via Resend').parameters.headerParameters.parameters.find(x=>x.name==='Idempotency-Key');
  const key = expression(header.value,{$:reference(body)});
  assert.equal(key,'ghostcoach/session-recap/'+sessionId);
  assert.equal(expression(header.value,{$:reference(body)}),key);
  assert.deepEqual(validateS3Repair(wf),[]);
});

test('unexpected source and candidate drift are rejected', () => {
  const bad = structuredClone(source);
  bad.nodes = bad.nodes.filter(n=>n.name!=='Extract Session ID');
  assert.throws(()=>repairS3Workflow(bad),/expected exactly one/);
  assert.ok(validateS3Repair(source).length);
  const wf=repairS3Workflow(source);
  node(wf,'CLAIM existing session transcript').parameters.url='https://fixture.example/rest/v1/sessions';
  assert.ok(validateS3Repair(wf).length);
});

test('candidate is based on the published version, never the unrelated draft', () => {
  const published = structuredClone(source);
  const draft = structuredClone(source);
  node(draft,'Build Recap Email').parameters.jsCode = 'UNPUBLISHED DRAFT';
  const snapshot = {...draft,versionId:'draft-version',activeVersionId:'published-version',
    activeVersion:{...published,versionId:'published-version'}};
  const {candidate,report} = prepareCandidate(snapshot);
  assert.deepEqual(node(candidate,'Build Recap Email'),node(published,'Build Recap Email'));
  assert.equal(report.sourceDraftVersionId,'draft-version');
  assert.equal(report.sourceActiveVersionId,'published-version');
  assert.deepEqual(report.validationProblems,[]);
  assert.throws(()=>prepareCandidate({...snapshot,activeVersionId:'changed'}),/matching published/);
});

test('all nonrepair node fields stay unchanged except renamed node references', () => {
  const wf=repairS3Workflow(source);
  const changed=new Set(['Parse Session Payload','INSERT session (transcript first)','Extract Session ID',
    'UPDATE session (summary + score)','Send Recap via Resend']);
  for(const before of source.nodes) {
    if(changed.has(before.name)) continue;
    const expected=JSON.parse(JSON.stringify(before).replaceAll('Extract Session ID','Validate Claimed Session'));
    assert.deepEqual(wf.nodes.find(n=>n.id===before.id),expected);
  }
  assert.deepEqual(wf.settings,source.settings);
  const broken=structuredClone(wf);
  node(broken,'Validate Claimed Session').onError='continueRegularOutput';
  assert.ok(validateS3Repair(broken).some(message=>message.includes('stop on error')));
});
