// Integration tests against the disposable local PostgreSQL/PostgREST stack only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { repairS3Workflow } from '../../scripts/n8n/s3-session-end-repair.mjs';

const endpoint = 'http://127.0.0.1:55331';
const workflow = repairS3Workflow(JSON.parse(readFileSync(new URL('./fixtures/s3-published.json',import.meta.url))));
const getNode = name => workflow.nodes.find(n=>n.name===name);
const user = randomUUID();
const transcript = 'Founder: Local regression only. I will interview three customers.';
async function rest(path, method='GET', body) {
  const response = await fetch(endpoint+path,{method,headers:{'Content-Type':'application/json',Prefer:'return=representation'},body:body===undefined?undefined:JSON.stringify(body)});
  assert.ok(response.ok, 'local PostgREST HTTP '+response.status);
  return response.status===204 ? [] : response.json();
}
async function insert(overrides={}) {
  return (await rest('/sessions','POST',{id:randomUUID(),user_id:user,...overrides}))[0];
}
function evaluate(text, payload) {
  return runInNewContext(text.slice(3,-2),{
    $vars:{SUPABASE_URL:endpoint},$json:payload,
    $:()=>({first:()=>({json:payload})}),
  },{timeout:1000}).replace?.('/rest/v1/','/') ?? null;
}
async function patch(name,payload) {
  const node=getNode(name);
  const url=evaluate(node.parameters.url,payload);
  const json=evaluate(node.parameters.jsonBody,payload);
  const response=await fetch(url,{method:node.parameters.method,headers:{'Content-Type':'application/json',Prefer:'return=representation'},body:json});
  assert.ok(response.ok,'local PATCH HTTP '+response.status);
  return response.json();
}
function guard(name, rows, parsed) {
  // HTTP Request splits array responses into n8n items; alwaysOutputData emits {} for [].
  return runInNewContext('(function(){'+getNode(name).parameters.jsCode+'})()',{
    $input:{all:()=> (rows.length?rows:[{}]).map(json=>({json}))},
    $:()=>({first:()=>({json:parsed})}),
  },{timeout:1000});
}

test('concurrent requests claim exactly one existing row; repeated completion does not rerun',async()=>{
  const original=await insert();
  const payload={session_id:original.id,user_id:user,transcript};
  const responses=await Promise.all(Array.from({length:8},()=>patch('CLAIM existing session transcript',payload)));
  assert.equal(responses.filter(rows=>rows.length===1).length,1);
  assert.equal(responses.filter(rows=>rows.length===0).length,7);
  let downstreamRuns=0;
  for(const rows of responses) {
    if(!rows.length) assert.throws(()=>guard('Validate Claimed Session',rows,payload));
    else { guard('Validate Claimed Session',rows,payload); downstreamRuns++; }
  }
  assert.equal(downstreamRuns,1);
  const updated=await patch('UPDATE session (summary + score)',{...payload,summary:'QA summary',new_score:5,action_committed:'QA action'});
  guard('Validate Completed Session',updated,payload);
  const [persisted]=await rest('/sessions?id=eq.'+original.id);
  assert.equal(persisted.id,original.id);
  assert.equal(persisted.processing_status,'complete');
  assert.equal(persisted.created_at,original.created_at);
  assert.equal(persisted.retry_count,original.retry_count);
  assert.equal(persisted.is_pricing_audit,false);
  assert.equal(persisted.audit_intake,null);
  assert.equal(persisted.summary,'QA summary');
  assert.equal((await patch('CLAIM existing session transcript',payload)).length,0);
  assert.equal((await patch('UPDATE session (summary + score)',{...payload,summary:'again',new_score:10})).length,0);
  assert.equal((await rest('/sessions?id=eq.'+original.id)).length,1);
});

test('unknown ID, wrong owner, audit, complete and nonempty transcript cannot claim',async()=>{
  const normal=await insert();
  const cases=[
    {session_id:randomUUID(),user_id:user},
    {session_id:normal.id,user_id:randomUUID()},
  ];
  for(const overrides of [{is_pricing_audit:true,audit_intake:{qa:true}},
    {processing_status:'complete'},{transcript:'already claimed'}]) {
    const session=await insert(overrides);
    cases.push({session_id:session.id,user_id:user});
  }
  const before=await rest('/sessions?order=id');
  for(const identity of cases) {
    const rows=await patch('CLAIM existing session transcript',{...identity,transcript});
    assert.equal(rows.length,0);
    assert.throws(()=>guard('Validate Claimed Session',rows,{...identity,transcript}));
  }
  assert.deepEqual(await rest('/sessions?order=id'),before);
});

test('null transcript can be claimed and a downstream failure leaves it for inspected recovery',async()=>{
  const original=await insert({transcript:null});
  const payload={session_id:original.id,user_id:user,transcript};
  const claimed=await patch('CLAIM existing session transcript',payload);
  guard('Validate Claimed Session',claimed,payload);
  // No completion call: simulate failure before AI/summary persistence.
  const [pending]=await rest('/sessions?id=eq.'+original.id);
  assert.equal(pending.transcript,transcript);
  assert.equal(pending.processing_status,'pending');
  assert.equal((await patch('CLAIM existing session transcript',payload)).length,0);
});

test('wrong owner cannot complete a claimed row',async()=>{
  const original=await insert();
  const payload={session_id:original.id,user_id:user,transcript};
  await patch('CLAIM existing session transcript',payload);
  const wrong={...payload,user_id:randomUUID(),summary:'wrong',new_score:99};
  const result=await patch('UPDATE session (summary + score)',wrong);
  assert.equal(result.length,0);
  assert.throws(()=>guard('Validate Completed Session',result,wrong));
  assert.equal((await rest('/sessions?id=eq.'+original.id))[0].summary,null);
});

