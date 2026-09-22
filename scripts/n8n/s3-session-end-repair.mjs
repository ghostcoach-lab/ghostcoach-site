// Pure, offline transformer. This module never calls n8n, Supabase, or Resend.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const CLAIM = 'CLAIM existing session transcript';
const CLAIM_GUARD = 'Validate Claimed Session';
const UPDATE = 'UPDATE session (summary + score)';
const COMPLETE_GUARD = 'Validate Completed Session';
const PROFILE = 'UPDATE profiles.goal_progress';
const PARSE = 'Parse Session Payload';
const SEND = 'Send Recap via Resend';

// Self-contained functions are embedded in existing n8n Code nodes.
function parsePayload() {
  const input = $input.first().json;
  const body = input?.body ?? input;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  for (const field of ['session_id', 'user_id']) {
    if (typeof body?.[field] !== 'string' || !uuid.test(body[field]))
      throw new Error('S3: invalid ' + field);
  }
  if (typeof body.transcript !== 'string' || !body.transcript.trim())
    throw new Error('S3: transcript must be a nonblank string');
  if (body.is_pricing_audit !== undefined && body.is_pricing_audit !== false)
    throw new Error('S3: this endpoint accepts normal sessions only');
  return [{json: {
    session_id: body.session_id.toLowerCase(),
    user_id: body.user_id.toLowerCase(),
    transcript: body.transcript,
    is_pricing_audit: false,
  }}];
}

function validateRows(expectedStatus, isClaim) {
  const items = $input.all();
  const rows = items.flatMap(item => Array.isArray(item.json) ? item.json : [item.json]);
  if (rows.length !== 1 || !rows[0]?.id)
    throw new Error('S3: expected exactly one session row');
  const session = rows[0];
  const parsed = $('Parse Session Payload').first().json;
  if (session.id !== parsed.session_id || session.user_id !== parsed.user_id)
    throw new Error('S3: session identity mismatch');
  if (session.is_pricing_audit !== false || session.processing_status !== expectedStatus)
    throw new Error('S3: session type/status mismatch');
  if (session.transcript !== parsed.transcript)
    throw new Error('S3: persisted transcript mismatch');
  if (isClaim) return [{json:{
    session_id: session.id, user_id: session.user_id,
    transcript: session.transcript, is_pricing_audit: false,
  }}];
  return [{json:session}];
}

const parseCode = 'return (' + parsePayload.toString() + ')();';
const claimCode = 'return (' + validateRows.toString() + ")('pending', true);";
const completeCode = 'return (' + validateRows.toString() + ")('complete', false);";
const baseUrl = "$vars.SUPABASE_URL + '/rest/v1/sessions?id=eq.' + encodeURIComponent($('Parse Session Payload').first().json.session_id) + '&user_id=eq.' + encodeURIComponent($('Parse Session Payload').first().json.user_id)";
const claimUrl = '={{ ' + baseUrl + " + '&is_pricing_audit=is.false&processing_status=eq.pending&or=(transcript.is.null,transcript.eq.)&select=id,user_id,is_pricing_audit,processing_status,transcript' }}";
const completeUrl = '={{ ' + baseUrl + " + '&is_pricing_audit=is.false&processing_status=eq.pending' }}";
const claimBody = '={{ JSON.stringify({ transcript: $json.transcript }) }}';
const completeBody = "={{ JSON.stringify({ summary: $json.summary, goal_progress_score: $json.new_score, action_committed: $json.action_committed, processing_status: 'complete' }) }}";
const idempotency = "={{ 'ghostcoach/session-recap/' + $('Parse Session Payload').first().json.session_id }}";
const edge = name => ({main:[[{node:name,type:'main',index:0}]]});

function onlyNode(workflow, name) {
  const nodes = workflow.nodes.filter(n => n.name === name);
  if (nodes.length !== 1) throw new Error('expected exactly one ' + name);
  return nodes[0];
}

function header(node, name, value) {
  node.parameters.sendHeaders = true;
  const headers = node.parameters.headerParameters ??= {parameters:[]};
  headers.parameters = headers.parameters.filter(h => h.name.toLowerCase() !== name.toLowerCase());
  headers.parameters.push({name,value});
}

function rename(workflow, oldName, newName) {
  onlyNode(workflow, oldName).name = newName;
  const remap = value => {
    if (typeof value === 'string') return value.replaceAll(oldName,newName);
    if (Array.isArray(value)) return value.map(remap);
    if (value && typeof value === 'object')
      return Object.fromEntries(Object.entries(value).map(([k,v]) => [k===oldName ? newName : k,remap(v)]));
    return value;
  };
  workflow.connections = remap(workflow.connections);
  for (const n of workflow.nodes) n.parameters = remap(n.parameters);
}

export function repairS3Workflow(source) {
  const workflow = structuredClone(source);
  for (const name of [PARSE,'INSERT session (transcript first)','Extract Session ID',UPDATE,PROFILE,SEND])
    onlyNode(workflow,name);
  if (workflow.nodes.some(n => [CLAIM,CLAIM_GUARD,COMPLETE_GUARD].includes(n.name)))
    throw new Error('source already contains repair nodes');
  if (JSON.stringify(workflow.connections[UPDATE]) !== JSON.stringify(edge(PROFILE)))
    throw new Error('unexpected completion edge');
  for (const name of ['INSERT session (transcript first)',UPDATE]) {
    const n = onlyNode(workflow,name);
    if (n.parameters.authentication !== 'predefinedCredentialType' ||
        n.parameters.nodeCredentialType !== 'supabaseApi' || !n.credentials?.supabaseApi?.id)
      throw new Error('expected existing Supabase credential');
  }
  rename(workflow,'INSERT session (transcript first)',CLAIM);
  rename(workflow,'Extract Session ID',CLAIM_GUARD);
  const parser = onlyNode(workflow,PARSE);
  parser.parameters = {...parser.parameters,mode:'runOnceForAllItems',jsCode:parseCode};
  const claim = onlyNode(workflow,CLAIM);
  claim.parameters = {...claim.parameters,method:'PATCH',url:claimUrl,jsonBody:claimBody,options:{}};
  claim.alwaysOutputData = true;
  header(claim,'Prefer','return=representation');
  const guard = onlyNode(workflow,CLAIM_GUARD);
  guard.parameters = {...guard.parameters,mode:'runOnceForAllItems',jsCode:claimCode};
  const complete = onlyNode(workflow,UPDATE);
  complete.parameters = {...complete.parameters,method:'PATCH',url:completeUrl,jsonBody:completeBody,options:{}};
  complete.alwaysOutputData = true;
  header(complete,'Prefer','return=representation');
  for (const n of [parser,claim,guard,complete]) {
    n.onError = 'stopWorkflow';
    n.continueOnFail = false;
    n.retryOnFail = false;
  }
  workflow.nodes.push({
    id:'eb3269ce-2d0c-4f95-850e-0204360768e9',
    name:COMPLETE_GUARD,type:'n8n-nodes-base.code',typeVersion:2,
    position:[complete.position[0]+110,complete.position[1]+180],
    parameters:{mode:'runOnceForAllItems',jsCode:completeCode},
    onError:'stopWorkflow',continueOnFail:false,retryOnFail:false,
  });
  workflow.connections[UPDATE] = edge(COMPLETE_GUARD);
  workflow.connections[COMPLETE_GUARD] = edge(PROFILE);
  header(onlyNode(workflow,SEND),'Idempotency-Key',idempotency);
  const problems = validateS3Repair(workflow);
  if (problems.length) throw new Error('candidate validation: '+problems.join('; '));
  return workflow;
}

export function validateS3Repair(workflow) {
  const problems = [];
  const check = (ok, message) => {if (!ok) problems.push(message);};
  const find = name => workflow.nodes?.find(n=>n.name===name);
  const claim = find(CLAIM);
  check(claim?.parameters.method==='PATCH','POST/INSERT is not an owned session claim');
  check(claim?.parameters.url===claimUrl,'claim owner/type/status/transcript predicates differ');
  check(claim?.parameters.jsonBody===claimBody,'claim must write only transcript');
  const complete = find(UPDATE);
  check(complete?.parameters.method==='PATCH' && complete?.parameters.url===completeUrl,'completion owner/type/status predicates differ');
  check(complete?.parameters.jsonBody===completeBody,'completion body changes protected metadata');
  for(const [name, code] of [[PARSE,parseCode],[CLAIM_GUARD,claimCode],[COMPLETE_GUARD,completeCode]]) {
    const n=find(name);
    check(n?.parameters.jsCode===code && n?.parameters.mode==='runOnceForAllItems',name+' code differs');
  }
  for(const name of [PARSE,CLAIM,CLAIM_GUARD,UPDATE,COMPLETE_GUARD]) {
    const n=find(name);
    check(n && n.onError==='stopWorkflow' && n.continueOnFail===false && n.retryOnFail===false,name+' must stop on error without automatic retry');
  }
  for(const name of [CLAIM,UPDATE]) {
    const n=find(name);
    check(n?.alwaysOutputData===true,name+' must surface empty rows');
    check(n?.parameters.headerParameters?.parameters?.some(h=>h.name==='Prefer'&&h.value==='return=representation'),name+' must return changed rows');
    check(n?.parameters.authentication==='predefinedCredentialType' &&
      n?.parameters.nodeCredentialType==='supabaseApi' && !!n?.credentials?.supabaseApi?.id,name+' credential missing');
  }
  for(const [from,to] of [[PARSE,CLAIM],[CLAIM,CLAIM_GUARD],[CLAIM_GUARD,'Fetch User Email'],[UPDATE,COMPLETE_GUARD],[COMPLETE_GUARD,PROFILE]])
    check(JSON.stringify(workflow.connections?.[from])===JSON.stringify(edge(to)),from+' unexpected edge');
  check(find(SEND)?.parameters.headerParameters?.parameters?.some(h=>h.name==='Idempotency-Key'&&h.value===idempotency),'stable email key missing');
  check(!JSON.stringify(workflow).includes('Extract Session ID'),'stale session reference');
  check(!JSON.stringify(workflow).includes('INSERT session (transcript first)'),'stale insert reference');
  const names=new Set(workflow.nodes?.map(n=>n.name));
  check(names.size===workflow.nodes?.length,'duplicate node names');
  for(const [from,outputs] of Object.entries(workflow.connections??{})) {
    check(names.has(from),'missing connection source');
    for(const branches of Object.values(outputs)) for(const branch of branches) for(const e of branch)
      check(names.has(e.node),'missing connection target');
  }
  return problems;
}

export function prepareCandidate(snapshot) {
  const wrapper = snapshot.workflow ?? snapshot;
  if (!wrapper.activeVersion?.nodes || wrapper.activeVersion.versionId !== wrapper.activeVersionId)
    throw new Error('expected snapshot with matching published activeVersion');
  const base = {name:wrapper.name,nodes:wrapper.activeVersion.nodes,
    connections:wrapper.activeVersion.connections,settings:wrapper.settings};
  const candidate = repairS3Workflow(base);
  const changed = candidate.nodes.filter(n => JSON.stringify(n)!==JSON.stringify(base.nodes.find(b=>b.id===n.id))).map(n=>n.name);
  return {candidate,report:{sourceActiveVersionId:wrapper.activeVersionId,sourceDraftVersionId:wrapper.versionId,
    changedNodes:changed,validationProblems:validateS3Repair(candidate)}};
}

// Output is captured privately by the caller and written with apply_patch.
// Default CLI prints a safe report; --emit-private-json must never be logged.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [mode,input] = process.argv.slice(2);
    if (!['--report','--emit-private-json'].includes(mode) || !input)
      throw new Error('usage: --report|--emit-private-json <private snapshot>');
    const result = prepareCandidate(JSON.parse(await readFile(input,'utf8')));
    process.stdout.write(JSON.stringify(mode==='--report' ? result.report : result.candidate));
  } catch {
    process.stderr.write('S3 candidate preparation failed; inspect the input privately.\n');
    process.exitCode=1;
  }
}

