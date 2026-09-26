// Pure, offline transformer. This module never calls n8n, Supabase, Stripe, Beehiiv, or Resend.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const PREP = 'GDPR — Prep Supabase Delete';
const SESSIONS = 'DELETE sessions';
const AUDITS = 'DELETE pricing_audits';
const AUTH_PREP = 'Prep Auth Delete';
const AUDITS_ID = 'c7e4b2a9-5d31-4f6e-9a08-2b1d6f3e8a47';
const ERROR_FIELDS = ['onError', 'continueOnFail', 'retryOnFail', 'maxTries', 'waitBetweenTries'];
// The apikey value comes from the input; it is never written by this module.
const sessionsUrl = /^=\{\{ `\$\{\$vars\.SUPABASE_URL\}\/rest\/v1\/sessions\?user_id=eq\.\$\{\$\('GDPR — Prep Supabase Delete'\)\.first\(\)\.json\.user_id\}&apikey=[^`&$]+` \}\}$/;
const toAuditsUrl = url => url.replace('/rest/v1/sessions?', '/rest/v1/pricing_audits?');
const edge = name => ({ main: [[{ node: name, type: 'main', index: 0 }]] });
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function onlyNode(workflow, name) {
  const nodes = workflow.nodes.filter(n => n.name === name);
  if (nodes.length !== 1) throw new Error('expected exactly one ' + name);
  return nodes[0];
}

function sources(workflow, name) {
  return Object.entries(workflow.connections ?? {})
    .filter(([, outputs]) => Object.values(outputs).some(branches =>
      branches.some(branch => branch?.some(e => e.node === name))))
    .map(([from]) => from);
}

function stopsOnError(n) {
  return (n.onError === undefined || n.onError === 'stopWorkflow') && !n.continueOnFail;
}

export function addAuditDeleteToS6(source) {
  const workflow = structuredClone(source);
  for (const name of [PREP, AUTH_PREP]) onlyNode(workflow, name);
  const sessions = onlyNode(workflow, SESSIONS);
  if (workflow.nodes.some(n => n.name === AUDITS || n.id === AUDITS_ID))
    throw new Error('source already contains ' + AUDITS);
  if (sessions.type !== 'n8n-nodes-base.httpRequest' || sessions.parameters.method !== 'DELETE')
    throw new Error('expected ' + SESSIONS + ' to be an HTTP DELETE');
  if (!sessionsUrl.test(sessions.parameters.url ?? ''))
    throw new Error('unexpected ' + SESSIONS + ' target');
  if (sessions.parameters.authentication !== 'predefinedCredentialType' ||
      sessions.parameters.nodeCredentialType !== 'supabaseApi' || !sessions.credentials?.supabaseApi?.id)
    throw new Error('expected existing Supabase credential');
  if (!stopsOnError(sessions)) throw new Error('expected ' + SESSIONS + ' to stop on error');
  const prepBranch = workflow.connections[PREP]?.main?.[0] ?? [];
  if (prepBranch.filter(e => e.node === SESSIONS).length !== 1 || !same(sources(workflow, SESSIONS), [PREP]))
    throw new Error('expected ' + SESSIONS + ' to be fed only by ' + PREP);
  if (!same(workflow.connections[SESSIONS], edge(AUTH_PREP)))
    throw new Error('unexpected ' + SESSIONS + ' edge');

  const audits = structuredClone(sessions);
  audits.id = AUDITS_ID;
  audits.name = AUDITS;
  audits.parameters.url = toAuditsUrl(sessions.parameters.url);
  audits.position = [sessions.position[0] - 80, sessions.position[1] + 128];
  // A 204 with no rows must still hand one item on, so the sessions delete always runs.
  audits.alwaysOutputData = true;
  workflow.nodes.push(audits);
  workflow.connections[PREP].main[0] = prepBranch.map(e => e.node === SESSIONS ? { ...e, node: AUDITS } : e);
  workflow.connections[AUDITS] = edge(SESSIONS);

  const problems = validateS6Candidate(workflow);
  if (problems.length) throw new Error('candidate validation: ' + problems.join('; '));
  return workflow;
}

export function validateS6Candidate(workflow) {
  const problems = [];
  const check = (ok, message) => { if (!ok) problems.push(message); };
  const matches = name => workflow.nodes?.filter(n => n.name === name) ?? [];
  check(matches(AUDITS).length === 1, AUDITS + ' must exist exactly once');
  check(matches(SESSIONS).length === 1, SESSIONS + ' must exist exactly once');
  const [audits] = matches(AUDITS);
  const [sessions] = matches(SESSIONS);
  if (audits && sessions) {
    check(audits.type === sessions.type && audits.typeVersion === sessions.typeVersion, AUDITS + ' node type differs');
    check(audits.parameters.method === 'DELETE', AUDITS + ' must be a DELETE');
    check(sessionsUrl.test(sessions.parameters.url) &&
      audits.parameters.url === toAuditsUrl(sessions.parameters.url), AUDITS + ' must target only the deleting customer');
    for (const key of ['authentication', 'nodeCredentialType', 'options'])
      check(same(audits.parameters[key], sessions.parameters[key]), AUDITS + ' ' + key + ' differs');
    check(same(audits.credentials, sessions.credentials), AUDITS + ' credential differs');
    for (const key of ERROR_FIELDS)
      check(audits[key] === sessions[key], AUDITS + ' ' + key + ' differs from ' + SESSIONS);
    check(stopsOnError(audits), AUDITS + ' must stop on error');
    check(audits.alwaysOutputData === true, AUDITS + ' must pass an item on when no rows exist');
  }
  const prepBranch = workflow.connections?.[PREP]?.main?.[0] ?? [];
  check(prepBranch.some(e => e.node === AUDITS), PREP + ' must feed ' + AUDITS);
  check(same(sources(workflow, AUDITS), [PREP]), AUDITS + ' must be fed only by ' + PREP);
  check(same(workflow.connections?.[AUDITS], edge(SESSIONS)), AUDITS + ' must feed ' + SESSIONS);
  check(same(sources(workflow, SESSIONS), [AUDITS]), SESSIONS + ' must be fed only by ' + AUDITS);
  check(same(workflow.connections?.[SESSIONS], edge(AUTH_PREP)), SESSIONS + ' unexpected edge');
  const names = new Set(workflow.nodes?.map(n => n.name));
  check(names.size === workflow.nodes?.length, 'duplicate node names');
  for (const [from, outputs] of Object.entries(workflow.connections ?? {})) {
    check(names.has(from), 'missing connection source');
    for (const branches of Object.values(outputs)) for (const branch of branches) for (const e of branch ?? [])
      check(names.has(e.node), 'missing connection target');
  }
  return problems;
}

export function diffWorkflows(base, candidate) {
  const byId = nodes => new Map(nodes.map(n => [n.id, n]));
  const before = byId(base.nodes);
  const after = byId(candidate.nodes);
  const keys = (a, b) => [...new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])];
  return {
    addedNodes: candidate.nodes.filter(n => !before.has(n.id)).map(n => n.name),
    removedNodes: base.nodes.filter(n => !after.has(n.id)).map(n => n.name),
    changedNodes: candidate.nodes.filter(n => before.has(n.id) && !same(n, before.get(n.id))).map(n => n.name),
    changedConnections: keys(base.connections, candidate.connections)
      .filter(k => !same(base.connections[k], candidate.connections[k])),
    otherChanges: keys(base, candidate)
      .filter(k => !['nodes', 'connections'].includes(k) && !same(base[k], candidate[k])),
  };
}

export function prepareCandidate(snapshot) {
  const wrapper = snapshot.workflow ?? snapshot;
  if (!wrapper.activeVersion?.nodes || wrapper.activeVersion.versionId !== wrapper.activeVersionId)
    throw new Error('expected snapshot with matching published activeVersion');
  const base = { name: wrapper.name, nodes: wrapper.activeVersion.nodes,
    connections: wrapper.activeVersion.connections, settings: wrapper.settings };
  const candidate = addAuditDeleteToS6(base);
  return { candidate, report: { sourceActiveVersionId: wrapper.activeVersionId,
    sourceDraftVersionId: wrapper.versionId, diff: diffWorkflows(base, candidate),
    validationProblems: validateS6Candidate(candidate) } };
}

// Default CLI prints a safe report; --emit-private-json output holds live credentials and must never be logged.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [mode, input] = process.argv.slice(2);
    if (!['--report', '--emit-private-json'].includes(mode) || !input)
      throw new Error('usage: --report|--emit-private-json <private snapshot>');
    const result = prepareCandidate(JSON.parse(await readFile(input, 'utf8')));
    process.stdout.write(JSON.stringify(mode === '--report' ? result.report : result.candidate));
  } catch {
    process.stderr.write('S6 candidate preparation failed; inspect the input privately.\n');
    process.exitCode = 1;
  }
}
