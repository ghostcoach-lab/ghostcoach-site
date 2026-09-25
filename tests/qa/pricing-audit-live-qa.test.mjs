// The live QA script, tested through its only boundary: argv, env and fetch. A fake fetch plays
// production (Auth, both Edge Functions, the Management API SQL endpoint and the n8n API), so no
// test touches the network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runLiveQa } from '../../scripts/qa/pricing-audit-live-qa.mjs';

const REF = 'abcdefghijklmnopqrst';
const USER = '11111111-2222-4333-8444-555555555555';

function logger() {
  const lines = [];
  return { lines, log: line => lines.push(line), text: () => lines.join('\n') };
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const uuids = text => [...new Set((text.match(UUID) ?? []).map(v => v.toLowerCase()))];
const json = (status, body) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const hashOf = value => JSON.stringify(value);
// jsonb stores object keys shortest first, then in byte order, not in the order they were sent.
const jsonb = value => value && Object.fromEntries(Object.entries(value)
  .sort(([a], [b]) => a.length - b.length || (a < b ? -1 : 1)));
const AUDIT_1 = 'bbbbbbbb-0000-4000-8000-000000000001';

// A small stand-in for production: the rows the run can touch, the deployed functions, Auth,
// the Management API SQL endpoint (routed by each query's "-- qa:<name>" tag) and the n8n API.
// `faults` injects the failures a live run can meet.
function fakeProduction(faults = {}) {
  const state = {
    user: { plan: 'builder', status: 'pending', welcome_audit_used: false, last_audit_completed_at: null },
    otherUsers: 'other users v1',
    sessions: [{ id: 'aaaaaaaa-0000-4000-8000-000000000001', user_id: USER, session_number: 3, is_pricing_audit: false }],
    audits: [],
    authSessions: ['browser-session'],
    executions: [{ id: '100', status: 'success' }],
  };
  const initial = structuredClone(state);
  const calls = [];
  const sql = [];

  const tableState = () => [
    { name: 'auth sessions (QA account)', rows: state.authSessions.length, hash: hashOf(state.authSessions) },
    { name: 'pricing_audits', rows: state.audits.length, hash: hashOf(state.audits) },
    { name: 'sessions', rows: state.sessions.length, hash: hashOf(state.sessions) },
    { name: 'users (QA account)', rows: 1, hash: hashOf(state.user) },
    { name: 'users (other)', rows: 12, hash: hashOf(state.otherUsers) },
  ];
  const gatedDate = () => state.user.last_audit_completed_at && '2026-12-24';
  const entitled = () => state.user.plan === 'operator' && state.user.status === 'active';

  function runRows(query) {
    const run = uuids(query).filter(id => id !== USER);
    const audits = state.audits.filter(a => a.user_id === USER || run.includes(a.session_id));
    const others = state.sessions.filter(s => s.user_id === USER && !run.includes(s.id));
    return [{ run: {
      sessions: state.sessions.filter(s => run.includes(s.id)).map(s => ({
        id: s.id, user_id: s.user_id, is_pricing_audit: s.is_pricing_audit, processing_status: s.processing_status,
        summary_is_null: true, transcript_chars: s.transcript.length, audit_intake: jsonb(s.audit_intake),
        session_number: s.session_number,
      })),
      audits: audits.map(a => ({
        id: a.id, user_id: a.user_id, session_id: a.session_id, completed_at: a.completed_at,
        is_welcome_audit: a.is_welcome_audit, verdict_action: a.verdict.action, verdict_number: a.verdict.number,
        verdict_deadline: a.verdict.deadline, baseline_keys: ['churn_window', 'friction_read', 'mix', 'value_anchor'],
        recap_sent_at: a.recap_sent_at, next_eligible_date: '2026-12-24',
      })),
      user: { ...state.user, clock_matches_audit: audits.some(a => a.completed_at === state.user.last_audit_completed_at) },
      max_other_session_number: Math.max(0, ...others.map(s => s.session_number)),
    } }];
  }

  // Applies the cleanup's statements the way Postgres would: each delete only removes rows whose
  // IDs it names, and the restore writes the values it names.
  function cleanup(query) {
    const auditDelete = query.match(/delete from public\.pricing_audits[^;]*;/i)?.[0] ?? '';
    const sessionDelete = query.match(/delete from public\.sessions[^;]*;/i)?.[0] ?? '';
    const restore = query.match(/update public\.users\s+set([^;]*);/i)?.[1];
    const auditIds = uuids(auditDelete);
    const sessionIds = uuids(sessionDelete);
    state.audits = state.audits.filter(a => !(a.user_id === USER && auditIds.includes(a.id)));
    state.sessions = state.sessions.filter(s => !(s.user_id === USER && s.is_pricing_audit && sessionIds.includes(s.id)));
    if (restore) {
      const value = name => restore.match(new RegExp(name + " = (null|true|false|'[^']*')"))?.[1];
      const parse = v => v === 'null' ? null : v === 'true' ? true : v === 'false' ? false : v.slice(1, -1);
      state.user = {
        plan: parse(value('plan')), status: parse(value('status')),
        welcome_audit_used: parse(value('welcome_audit_used')),
        last_audit_completed_at: parse(value('last_audit_completed_at')),
      };
    }
    return [];
  }

  function database(query) {
    const tag = query.match(/-- qa:(\S+)/)?.[1];
    sql.push({ tag, query });
    if (faults.sqlFails === tag) return json(400, { message: 'boom' });
    if (tag === 'preflight') return json(201, [{ migrated: true, completion_rpc: 1, audits: state.audits.length, ...state.user }]);
    if (tag === 'state') return json(201, tableState());
    if (tag === 'grant') {
      state.user = { plan: 'operator', status: 'active', welcome_audit_used: false, last_audit_completed_at: null };
      if (faults.organicChange) state.otherUsers = 'other users v2';
      return json(201, []);
    }
    if (tag === 'run-rows') return json(201, runRows(query));
    if (tag === 'cleanup') return json(201, cleanup(query));
    return json(400, { message: 'unknown query' });
  }

  function complete(body) {
    const own = state.audits.find(a => a.session_id === body.session_id && a.user_id === USER);
    const reply = (status, a) => json(200, { status, audit_id: a.id, is_welcome_audit: a.is_welcome_audit,
      verdict: a.verdict, next_eligible_date: '2026-12-24' });
    if (own) return reply('already_completed', own);
    if (!entitled()) return json(403, { reason: 'plan_lapsed' });
    if (gatedDate()) return json(403, { reason: 'gated', next_eligible_date: gatedDate() });
    if (faults.complete) return json(faults.complete.status, { reason: faults.complete.reason });
    const completedAt = '2026-09-25T10:00:00.000+00:00';
    const audit = {
      id: AUDIT_1, user_id: USER, session_id: body.session_id, completed_at: completedAt,
      is_welcome_audit: !state.user.welcome_audit_used,
      verdict: { action: 'raise', number: '39 per month', deadline: '2026-10-25', reasoning: 'QA' },
      recap_sent_at: faults.recapNotSent ? null : '2026-09-25T10:00:01.000+00:00',
    };
    state.audits.push(audit);
    state.sessions.push({ id: body.session_id, user_id: USER, session_number: 4, is_pricing_audit: true,
      processing_status: 'complete', transcript: 'Marcus: …', audit_intake: body.audit_intake });
    state.user = { ...state.user, welcome_audit_used: true, last_audit_completed_at: completedAt };
    if (!faults.recapNotSent) state.executions.push({ id: '101', status: 'success' });
    if (faults.completeWritesThenFails) return json(500, { reason: 'internal_error' });
    return reply('completed', audit);
  }

  function chat(body) {
    if (!entitled()) return json(403, { reason: 'plan_lapsed' });
    if (gatedDate()) return json(403, { reason: 'gated', next_eligible_date: gatedDate() });
    if (state.sessions.some(s => s.id === body.session_id)) return json(409, { reason: 'session_conflict' });
    return json(200, { reply: body.messages.length ? 'Verdict: raise to 39 per month by 25 October.' : 'Welcome.' });
  }

  const fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(init.body) : undefined;
    const headers = init.headers ?? {};
    calls.push({ url: url.href, method, body });
    if (url.host === 'api.supabase.com') {
      assert.equal(headers.Authorization, 'Bearer ' + SECRETS[2]);
      assert.equal(url.pathname, `/v1/projects/${REF}/database/query`);
      return database(body.query);
    }
    if (url.host === 'n8n.example.test') {
      assert.equal(headers['X-N8N-API-KEY'], SECRETS[3]);
      if (url.pathname === '/api/v1/workflows/wf-s12') return json(200, { id: 'wf-s12', active: true });
      if (url.pathname === '/api/v1/executions') return json(200, { data: [...state.executions].reverse() });
    }
    const path = url.pathname;
    if (path === `/auth/v1/admin/users/${USER}`) return json(200, { id: USER, email: 'qa@example.test' });
    if (path === '/auth/v1/admin/generate_link') return json(200, { hashed_token: 'h', verification_type: 'magiclink' });
    if (path === '/auth/v1/verify') {
      state.authSessions.push('qa-session');
      return json(200, { access_token: 'user-jwt', user: { id: USER } });
    }
    if (path === '/auth/v1/logout') {
      state.authSessions = state.authSessions.filter(s => s !== 'qa-session');
      return new Response(null, { status: 204 });
    }
    if (path.startsWith('/functions/v1/')) {
      assert.equal(headers.Authorization, 'Bearer user-jwt');
      if (path === '/functions/v1/marcus-audit-chat') return chat(body);
      if (path === '/functions/v1/pricing-audit-complete') return complete(body);
    }
    throw new Error('unexpected request: ' + method + ' ' + url.href);
  };
  return { state, initial, calls, sql, fetch };
}

const noSleep = async () => {};

async function execute(production, env = qaEnv()) {
  const out = logger();
  const code = await runLiveQa({ argv: CONFIRMED, env, fetch: production.fetch, log: out.log, sleep: noSleep });
  return { code, out };
}

function recordingFetch() {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? 'GET' });
    throw new Error('unexpected network call: ' + url);
  };
  return { calls, fetch };
}

const SECRETS = ['anon-key-xyz', 'service-key-xyz', 'pat-xyz', 'n8n-key-xyz'];

function qaEnv(overrides = {}) {
  return {
    GC_QA_KEYS: JSON.stringify([
      { name: 'anon', type: 'legacy', api_key: SECRETS[0] },
      { name: 'service_role', type: 'legacy', api_key: SECRETS[1] },
    ]),
    GC_QA_SUPABASE_URL: `https://${REF}.supabase.co`,
    GC_QA_SUPABASE_ACCESS_TOKEN: SECRETS[2],
    GC_QA_USER_ID: USER,
    GC_QA_N8N_URL: 'https://n8n.example.test',
    GC_QA_N8N_API_KEY: SECRETS[3],
    GC_QA_S12_WORKFLOW_ID: 'wf-s12',
    ...overrides,
  };
}

const CONFIRMED = ['--execute', `--confirm-project=${REF}`, `--confirm-user=${USER}`];

test('the run refuses, sending nothing, without matching confirmation flags', async () => {
  const refusals = [
    { argv: [] },
    { argv: ['--execute'] },
    { argv: ['--execute', `--confirm-project=${REF}`] },
    { argv: ['--execute', '--confirm-project=otherprojectrefxxxxx', `--confirm-user=${USER}`] },
    { argv: ['--execute', `--confirm-project=${REF}`, '--confirm-user=99999999-2222-4333-8444-555555555555'] },
    { argv: CONFIRMED, env: qaEnv({ GC_QA_SUPABASE_ACCESS_TOKEN: '' }) },
    { argv: CONFIRMED, env: qaEnv({ GC_QA_KEYS: '[]' }) },
  ];
  for (const { argv, env = qaEnv() } of refusals) {
    const out = logger();
    const net = recordingFetch();
    const code = await runLiveQa({ argv, env, fetch: net.fetch, log: out.log });
    assert.equal(code, 2, 'refused: ' + argv.join(' '));
    assert.deepEqual(net.calls, []);
    for (const secret of SECRETS) assert.ok(!out.text().includes(secret), 'no secret printed');
  }
});

test('a dry run prints the plan and sends no request', async () => {
  const out = logger();
  const net = recordingFetch();
  const code = await runLiveQa({ argv: ['--dry-run'], env: {}, fetch: net.fetch, log: out.log });
  assert.equal(code, 0);
  assert.deepEqual(net.calls, []);
  for (const step of ['before', 'entitlement', 'opener', 'complete', 'replay', 'gated', 'cleanup', 'after'])
    assert.match(out.text(), new RegExp(step, 'i'), 'plan names the ' + step + ' step');
});

test('a confirmed run completes one audit, proves replay and Cooldown, and leaves production as it found it', async () => {
  const production = fakeProduction();
  const { code, out } = await execute(production);
  assert.equal(code, 0, out.text());
  const { executions, ...rest } = production.state;
  const { executions: executionsBefore, ...restBefore } = production.initial;
  assert.deepEqual(rest, restBefore);
  assert.equal(executions.length, executionsBefore.length + 1, 'one S12 run: the recap');

  const functions = production.calls.filter(c => c.url.includes('/functions/v1/'));
  const chat = functions.filter(c => c.url.endsWith('marcus-audit-chat'));
  const complete = functions.filter(c => c.url.endsWith('pricing-audit-complete'));
  assert.equal(chat.length, 3, 'opener, one exchange, and the gated attempt');
  assert.equal(complete.length, 3, 'completion, replay, and the gated attempt');
  const [first, second] = [chat[0].body.session_id, chat[2].body.session_id];
  assert.notEqual(first, second);
  assert.deepEqual(chat[0].body.messages, []);
  assert.deepEqual(complete[0].body, complete[1].body, 'the replay repeats the completion exactly');
  assert.equal(complete[2].body.session_id, second);

  const cleanup = production.sql.filter(q => q.tag === 'cleanup');
  assert.equal(cleanup.length, 1);
  assert.ok(cleanup[0].query.includes(first) && cleanup[0].query.includes(AUDIT_1),
    'cleanup names the exact session and audit');
  assert.equal(production.sql.filter(q => q.tag === 'state').length, 2, 'before and after');

  for (const secret of [...SECRETS, 'user-jwt', 'qa@example.test']) assert.ok(!out.text().includes(secret));
  assert.match(out.text(), /passed/i);
});

function withoutExecutions({ executions, ...rest }) { return rest; }

test('a refused completion still restores the entitlement and fails the run', async () => {
  const production = fakeProduction({ complete: { status: 503, reason: 'ai_unavailable' } });
  const { code, out } = await execute(production);
  assert.equal(code, 1);
  assert.deepEqual(production.state, production.initial);
  assert.match(out.text(), /"step":"complete","ok":false.*ai_unavailable/);
  const cleanup = production.sql.find(q => q.tag === 'cleanup');
  assert.doesNotMatch(cleanup.query, /delete from/i, 'nothing to delete');
  assert.match(cleanup.query, /update public\.users/);
  assert.equal(production.state.authSessions.includes('qa-session'), false, 'signed out');
});

test('an audit written before a failed response is found by its session ID and deleted', async () => {
  const production = fakeProduction({ completeWritesThenFails: true });
  const { code, out } = await execute(production);
  assert.equal(code, 1);
  assert.deepEqual(withoutExecutions(production.state), withoutExecutions(production.initial));
  const cleanup = production.sql.find(q => q.tag === 'cleanup');
  assert.ok(cleanup.query.includes(AUDIT_1));
  assert.match(out.text(), /"step":"cleanup","ok":true/);
});

test('a recap that was not sent fails the run', async () => {
  const production = fakeProduction({ recapNotSent: true });
  const { code, out } = await execute(production);
  assert.equal(code, 1);
  assert.match(out.text(), /recap_sent_at/);
  assert.deepEqual(production.state, production.initial);
});

test('a difference between before and after fails loudly and names the table', async () => {
  const production = fakeProduction({ organicChange: true });
  const { code, out } = await execute(production);
  assert.equal(code, 1);
  assert.match(out.text(), /FAILED: production differs/);
  assert.match(out.text(), /users \(other\): rows 12 -> 12, hash changed/);
});

test('a failed cleanup fails the run and says to clean up by hand', async () => {
  const production = fakeProduction({ sqlFails: 'cleanup' });
  const { code, out } = await execute(production);
  assert.equal(code, 1);
  assert.match(out.text(), /"step":"cleanup","ok":false.*by hand/);
  assert.match(out.text(), /FAILED: production differs/);
});

test('a QA account that already has an audit stops the run before sign-in or any write', async () => {
  const production = fakeProduction();
  production.state.audits.push({ id: AUDIT_1, user_id: USER, session_id: 'x', verdict: {} });
  const { code, out } = await execute(production);
  assert.equal(code, 1);
  assert.match(out.text(), /already has a pricing audit/);
  assert.deepEqual(production.sql.map(q => q.tag), ['preflight']);
  assert.ok(!production.calls.some(c => c.url.includes('/auth/v1/')));
});
