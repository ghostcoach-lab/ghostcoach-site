// Pure, offline transformer. This module never calls n8n, Supabase, Anthropic, or Resend.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateS3Repair } from './s3-session-end-repair.mjs';

const AUDIT_FILTER = '&is_pricing_audit=is.false';
const API_KEY = /&apikey=[^`&$]+(?=`)/;
// Each lookup URL as published, with the live apikey value replaced by KEY.
// The filter goes in immediately before &select=.
const LOOKUPS = {
  s4: {
    node: 'Fetch 3 Recent Sessions1',
    url: '={{ `${$vars.SUPABASE_URL}/rest/v1/sessions?user_id=eq.${$json.user_id}&select=summary,action_committed,goal_progress_score,created_at&order=created_at.desc&limit=3&apikey=KEY` }}',
  },
  s3: {
    node: 'Fetch Previous Session',
    url: "={{ `${$vars.SUPABASE_URL}/rest/v1/sessions?user_id=eq.${$('Validate Claimed Session').first().json.user_id}&id=neq.${$('Validate Claimed Session').first().json.session_id}&select=action_committed,session_number&order=created_at.desc&limit=1&apikey=KEY` }}",
  },
};
const filtered = url => url.replace('&select=', AUDIT_FILTER + '&select=');
const withoutKey = url => (url ?? '').replace(API_KEY, '&apikey=KEY');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function onlyNode(workflow, name) {
  const nodes = workflow.nodes.filter(n => n.name === name);
  if (nodes.length !== 1) throw new Error('expected exactly one ' + name);
  return nodes[0];
}

function lookupFor(which) {
  const lookup = LOOKUPS[which];
  if (!lookup) throw new Error('unknown workflow ' + which);
  return lookup;
}

function isSupabaseRead(n) {
  return n.type === 'n8n-nodes-base.httpRequest' && [undefined, 'GET'].includes(n.parameters.method) &&
    n.parameters.authentication === 'predefinedCredentialType' &&
    n.parameters.nodeCredentialType === 'supabaseApi' && !!n.credentials?.supabaseApi?.id;
}

function addAuditFilter(source, which) {
  const { node: name, url } = lookupFor(which);
  const workflow = structuredClone(source);
  const lookup = onlyNode(workflow, name);
  if (!isSupabaseRead(lookup)) throw new Error('expected ' + name + ' to be a Supabase read');
  if (withoutKey(lookup.parameters.url) !== url) throw new Error('unexpected ' + name + ' query');
  lookup.parameters.url = filtered(lookup.parameters.url);
  const problems = validateAuditFilter(workflow, which);
  if (problems.length) throw new Error('candidate validation: ' + problems.join('; '));
  return workflow;
}

export function excludeAuditsFromS4(source) {
  return addAuditFilter(source, 's4');
}

export function excludeAuditsFromS3(source) {
  if (validateS3Repair(source).length) throw new Error('expected S3 with the session-end repair published');
  const workflow = addAuditFilter(source, 's3');
  const problems = validateS3Repair(workflow);
  if (problems.length) throw new Error('candidate lost the session-end repair: ' + problems.join('; '));
  return workflow;
}

export function validateAuditFilter(workflow, which) {
  const { node: name, url } = lookupFor(which);
  const problems = [];
  const matches = workflow.nodes?.filter(n => n.name === name) ?? [];
  if (matches.length !== 1) return [name + ' must exist exactly once'];
  const [lookup] = matches;
  if (!isSupabaseRead(lookup)) problems.push(name + ' must be a Supabase read');
  if (withoutKey(lookup.parameters.url) !== filtered(url))
    problems.push(name + ' must exclude audit sessions and otherwise keep its query');
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

export function prepareCandidate(snapshot, which) {
  const transform = { s3: excludeAuditsFromS3, s4: excludeAuditsFromS4 }[which];
  if (!transform) throw new Error('unknown workflow ' + which);
  const wrapper = snapshot.workflow ?? snapshot;
  if (!wrapper.activeVersion?.nodes || wrapper.activeVersion.versionId !== wrapper.activeVersionId)
    throw new Error('expected snapshot with matching published activeVersion');
  const base = { name: wrapper.name, nodes: wrapper.activeVersion.nodes,
    connections: wrapper.activeVersion.connections, settings: wrapper.settings };
  const candidate = transform(base);
  return { candidate, report: { workflow: which, sourceActiveVersionId: wrapper.activeVersionId,
    sourceDraftVersionId: wrapper.versionId, diff: diffWorkflows(base, candidate),
    validationProblems: validateAuditFilter(candidate, which) } };
}

// Default CLI prints a safe report; --emit-private-json output holds live credentials and must never be logged.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [mode, which, input] = process.argv.slice(2);
    if (!['--report', '--emit-private-json'].includes(mode) || !LOOKUPS[which] || !input)
      throw new Error('usage: --report|--emit-private-json s3|s4 <private snapshot>');
    const result = prepareCandidate(JSON.parse(await readFile(input, 'utf8')), which);
    process.stdout.write(JSON.stringify(mode === '--report' ? result.report : result.candidate));
  } catch {
    process.stderr.write('Candidate preparation failed; inspect the input privately.\n');
    process.exitCode = 1;
  }
}
