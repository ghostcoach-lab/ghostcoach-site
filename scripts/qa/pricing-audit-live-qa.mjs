// Milestone 2 live QA (ticket #14): one short real Pricing audit with an existing QA account,
// proved end to end against production, then exact-ID cleanup. Runbook:
// docs/operations/pricing-audit-m2-rollout.md.
//
// Every key and production identifier comes from the environment; nothing is read from the
// repository. The run refuses without --execute and confirmation flags that repeat the target
// project and QA account, and --dry-run only prints the plan. Output is JSON lines holding
// statuses and row IDs only: no key, JWT, email address or Marcus reply is ever printed.
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const ENV = {
  keys: 'GC_QA_KEYS',
  supabaseUrl: 'GC_QA_SUPABASE_URL',
  accessToken: 'GC_QA_SUPABASE_ACCESS_TOKEN',
  userId: 'GC_QA_USER_ID',
  n8nUrl: 'GC_QA_N8N_URL',
  n8nKey: 'GC_QA_N8N_API_KEY',
  s12WorkflowId: 'GC_QA_S12_WORKFLOW_ID',
};
const MANAGEMENT_API = 'https://api.supabase.com';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PROJECT_URL = /^https:\/\/([a-z0-9]{20})\.supabase\.co$/;
const BASELINE_KEYS = ['churn_window', 'friction_read', 'mix', 'value_anchor'];

// The Audit intake and the one customer turn. Both say plainly that this is a QA run.
const AUDIT_INTAKE = {
  mrr: 1200,
  customer_count: 40,
  churn_rate: 4.5,
  current_pricing: 'QA test run: one plan at 30 per month.',
  last_pricing_change: 'QA test run: no change since launch.',
};
const QA_TURN =
  'This is an automated QA test of the pricing audit, not a real business. Please skip the ' +
  'diagnostic questions and give your Verdict now, in this one reply: the action (raise, hold or ' +
  'restructure), the new price if there is one, a deadline 30 days from today, and your reasoning. ' +
  'Also state the Baseline: the value anchor, the friction read, the customer mix and the churn window.';

export const PLAN = [
  'before: read-only preflight (migration, QA account, S12 active), then row counts and hashes of the QA account\'s rows and the run\'s session IDs, and whole-table row counts',
  'sign in: a magic-link session for the QA account (this updates auth.users, so S1 fires as in Milestone 1 QA)',
  'entitlement: temporary database-only operator/active, guarded by the values saved in the preflight',
  'opener: marcus-audit-chat with no messages, then one short exchange asking for the Verdict',
  'complete: pricing-audit-complete; check the Pricing audit sessions row, the pricing_audits row, the moved Cooldown, recap_sent_at and exactly one new S12 run',
  'replay: the same completion again; expect already_completed, no write and no S12 run',
  'gated: a new audit straight away; expect gated from the chat and from completion, and no write',
  'cleanup: delete by the exact session and audit IDs, restore the saved entitlement, sign the QA session out',
  'after: the same counts and hashes again; a difference in the QA account\'s rows or the run\'s rows fails the run, and a whole-table count change is only reported (live traffic moves it)',
];

class QaFailure extends Error {}
const check = (condition, message) => { if (!condition) throw new QaFailure(message); };

// Problems name the variable or flag, never its value.
function readConfig(env) {
  const problems = [];
  const value = name => (typeof env[name] === 'string' ? env[name].trim() : '');
  for (const name of Object.values(ENV)) if (!value(name)) problems.push(`${name} is not set`);

  let anonKey;
  let serviceKey;
  if (value(ENV.keys)) {
    try {
      const keys = JSON.parse(value(ENV.keys));
      const legacy = name => keys.find(k => k?.name === name && k?.type === 'legacy')?.api_key;
      anonKey = legacy('anon');
      serviceKey = legacy('service_role');
    } catch { /* reported below */ }
    if (!anonKey || !serviceKey) problems.push(`${ENV.keys} must hold the legacy anon and service_role keys`);
  }
  const supabaseUrl = value(ENV.supabaseUrl).replace(/\/$/, '');
  const projectRef = supabaseUrl.match(PROJECT_URL)?.[1];
  if (supabaseUrl && !projectRef) problems.push(`${ENV.supabaseUrl} must be https://<project ref>.supabase.co`);
  const userId = value(ENV.userId).toLowerCase();
  if (userId && !UUID.test(userId)) problems.push(`${ENV.userId} must be a UUID`);
  const n8nUrl = value(ENV.n8nUrl).replace(/\/$/, '');
  if (n8nUrl && !n8nUrl.startsWith('https://')) problems.push(`${ENV.n8nUrl} must be https`);

  return {
    problems,
    config: { anonKey, serviceKey, supabaseUrl, projectRef, userId, n8nUrl,
      accessToken: value(ENV.accessToken), n8nKey: value(ENV.n8nKey), s12WorkflowId: value(ENV.s12WorkflowId) },
  };
}

// The flags repeat the target, so a run can't hit a project or account by accident.
function confirmationProblems(argv, config) {
  const problems = [];
  const flag = name => argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  if (!argv.includes('--execute')) problems.push('--execute is missing');
  if (!config.projectRef || flag('confirm-project') !== config.projectRef)
    problems.push('--confirm-project=<project ref> is missing or does not match the target project');
  if (!config.userId || flag('confirm-user')?.toLowerCase() !== config.userId)
    problems.push('--confirm-user=<QA account ID> is missing or does not match the QA account');
  return problems;
}

// SQL literals. Only validated UUIDs and values the database itself returned are ever quoted.
const lit = v => (v === null || v === undefined ? 'null'
  : typeof v === 'boolean' ? String(v)
  : `'${String(v).replaceAll("'", "''")}'`);
const uuidList = ids => ids.map(id => { check(UUID.test(id), 'not a UUID'); return lit(id); }).join(', ');

const sql = {
  preflight: user => `-- qa:preflight
select
  exists (select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'pricing_audits' and column_name = 'recap_sent_at') as migrated,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'complete_pricing_audit')::int as completion_rpc,
  u.plan::text as plan, u.status::text as status, u.welcome_audit_used,
  u.last_audit_completed_at::text as last_audit_completed_at,
  (select count(*) from public.pricing_audits a where a.user_id = u.id)::int as audits
from public.users u
where u.id = ${lit(user)};`,

  // Row counts and md5 hashes of ordered row text, for the QA account's rows and the run's own
  // session IDs only: live chat inserts a pending sessions row on every page load, so a
  // whole-table hash would change during the run. Whole tables get a count and no hash. The QA
  // account's users row leaves out updated_at, which a trigger may move when the entitlement is
  // granted and restored.
  state: (user, runIds) => {
    const hashed = (name, from, order, row = 't::text') =>
      `select ${lit(name)} as name, count(*)::int as rows, md5(coalesce(string_agg(${row}, '|' order by ${order}), '')) as hash from ${from}`;
    const counted = table => `select ${lit(`${table} (all rows)`)} as name, count(*)::int as rows, null::text as hash from public.${table}`;
    const owner = `t.user_id = ${lit(user)}`;
    return `-- qa:state
${[
    hashed('users (QA account)', `public.users t where t.id = ${lit(user)}`, 't.id', "(to_jsonb(t) - 'updated_at')::text"),
    hashed('profiles (QA account)', `public.profiles t where ${owner}`, 't.user_id'),
    hashed('sessions (QA account and run)', `public.sessions t where ${owner} or t.id in (${uuidList(runIds)})`, 't.id'),
    hashed('pricing_audits (QA account and run)',
      `public.pricing_audits t where ${owner} or t.session_id in (${uuidList(runIds)})`, 't.id'),
    hashed('subscriptions (QA account)', `public.subscriptions t where ${owner}`, 't.id'),
    hashed('digests (QA account)', `public.digests t where ${owner}`, 't.id'),
    hashed('auth sessions (QA account)', `auth.sessions t where ${owner}`, 't.id', 't.id::text'),
    ...['users', 'profiles', 'sessions', 'pricing_audits', 'subscriptions', 'digests'].map(counted),
  ].join('\nunion all\n')}
order by name;`;
  },

  grant: (user, saved) => `-- qa:grant
do $qa$
declare v_rows int;
begin
  update public.users
     set plan = 'operator', status = 'active', welcome_audit_used = false, last_audit_completed_at = null
   where id = ${lit(user)}
     and plan::text = ${lit(saved.plan)} and status::text = ${lit(saved.status)}
     and welcome_audit_used = ${lit(saved.welcome_audit_used)}
     and last_audit_completed_at is not distinct from ${lit(saved.last_audit_completed_at)}::timestamptz;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'qa grant: the QA account changed since the preflight';
  end if;
end $qa$;`,

  // Everything the run could have written, found by the session IDs the run minted.
  runRows: (user, sessionIds) => `-- qa:run-rows
select json_build_object(
  'sessions', coalesce((select json_agg(json_build_object(
      'id', s.id, 'user_id', s.user_id, 'is_pricing_audit', s.is_pricing_audit,
      'processing_status', s.processing_status, 'summary_is_null', s.summary is null,
      'transcript_chars', length(s.transcript), 'audit_intake', s.audit_intake,
      'session_number', s.session_number) order by s.id)
    from public.sessions s where s.id in (${uuidList(sessionIds)})), '[]'::json),
  'audits', coalesce((select json_agg(json_build_object(
      'id', a.id, 'user_id', a.user_id, 'session_id', a.session_id, 'completed_at', a.completed_at,
      'is_welcome_audit', a.is_welcome_audit, 'verdict_action', a.verdict_action,
      'verdict_number', a.verdict_number, 'verdict_deadline', a.verdict_deadline,
      'baseline_keys', (select json_agg(k order by k) from jsonb_object_keys(a.baseline) k),
      'recap_sent_at', a.recap_sent_at,
      'next_eligible_date', public.pricing_audit_next_eligible_date(a.completed_at)) order by a.id)
    from public.pricing_audits a
    where a.user_id = ${lit(user)} or a.session_id in (${uuidList(sessionIds)})), '[]'::json),
  'user', (select json_build_object(
      'plan', u.plan, 'status', u.status, 'welcome_audit_used', u.welcome_audit_used,
      'last_audit_completed_at', u.last_audit_completed_at::text,
      'cooldown_matches_audit', exists (select 1 from public.pricing_audits a
        where a.user_id = u.id and a.completed_at = u.last_audit_completed_at))
    from public.users u where u.id = ${lit(user)}),
  'max_other_session_number', (select coalesce(max(s.session_number), 0) from public.sessions s
    where s.user_id = ${lit(user)} and s.id not in (${uuidList(sessionIds)}))
) as run;`,

  // One statement, so it commits or rolls back as a whole. Each step must touch exactly the
  // rows it names, or the whole cleanup is rolled back and the run fails.
  cleanup: (user, { auditIds, sessionIds, restore }) => {
    const steps = [];
    const expect = (label, n) => `  get diagnostics v_rows = row_count;
  if v_rows <> ${n} then
    raise exception 'qa cleanup: % % rows, expected ${n}', ${lit(label)}, v_rows;
  end if;`;
    if (auditIds.length) steps.push(`  delete from public.pricing_audits
   where user_id = ${lit(user)} and id in (${uuidList(auditIds)});
${expect('pricing_audits', auditIds.length)}`);
    if (sessionIds.length) steps.push(`  delete from public.sessions
   where user_id = ${lit(user)} and is_pricing_audit and id in (${uuidList(sessionIds)});
${expect('sessions', sessionIds.length)}`);
    // Guarded by the values the grant set, so a real plan change during the run is never overwritten.
    if (restore) steps.push(`  update public.users
     set plan = ${lit(restore.plan)}, status = ${lit(restore.status)}, welcome_audit_used = ${lit(restore.welcome_audit_used)}, last_audit_completed_at = ${lit(restore.last_audit_completed_at)}
   where id = ${lit(user)} and plan::text = 'operator' and status::text = 'active';
${expect('users', 1)}`);
    return `-- qa:cleanup
do $qa$
declare v_rows int;
begin
${steps.join('\n')}
end $qa$;`;
  },
};

function production(config, fetch) {
  async function call(url, { method = 'GET', headers = {}, body, timeoutMs = 60_000 } = {}) {
    const response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
    return { status: response.status, data };
  }
  const ok = status => status >= 200 && status < 300;

  async function query(text) {
    const tag = text.match(/-- qa:(\S+)/)[1];
    const r = await call(`${MANAGEMENT_API}/v1/projects/${config.projectRef}/database/query`, {
      method: 'POST', headers: { Authorization: `Bearer ${config.accessToken}` }, body: { query: text },
    });
    // The database's own error text names the failed check; it holds no key.
    const detail = typeof r.data?.message === 'string' ? `: ${r.data.message.slice(0, 300)}` : '';
    check(ok(r.status), `SQL ${tag} failed with HTTP ${r.status}${detail}`);
    return r.data;
  }

  const supabase = (path, key, token, options = {}) =>
    call(config.supabaseUrl + path, { ...options, headers: { apikey: key, Authorization: `Bearer ${token}` } });

  async function signIn() {
    const account = await supabase(`/auth/v1/admin/users/${config.userId}`, config.serviceKey, config.serviceKey);
    check(account.status === 200 && account.data?.id === config.userId, `QA account lookup: HTTP ${account.status}`);
    const link = await supabase('/auth/v1/admin/generate_link', config.serviceKey, config.serviceKey,
      { method: 'POST', body: { type: 'magiclink', email: account.data.email } });
    check(link.status === 200 && link.data?.hashed_token, `magic link: HTTP ${link.status}`);
    const session = await supabase('/auth/v1/verify', config.anonKey, config.anonKey,
      { method: 'POST', body: { type: link.data.verification_type, token_hash: link.data.hashed_token } });
    check(session.status === 200 && session.data?.user?.id === config.userId && session.data?.access_token,
      `sign in: HTTP ${session.status}`);
    return session.data.access_token;
  }

  const n8n = path => call(config.n8nUrl + path, { headers: { 'X-N8N-API-KEY': config.n8nKey } });
  async function s12Runs() {
    const r = await n8n(`/api/v1/executions?workflowId=${encodeURIComponent(config.s12WorkflowId)}&limit=100`);
    check(r.status === 200 && Array.isArray(r.data?.data), `n8n executions: HTTP ${r.status}`);
    return r.data.data.map(e => ({ id: String(e.id), status: e.status }));
  }

  return {
    query,
    signIn,
    signOut: token => supabase('/auth/v1/logout?scope=local', config.anonKey, token, { method: 'POST' }),
    s12Workflow: () => n8n(`/api/v1/workflows/${encodeURIComponent(config.s12WorkflowId)}`),
    s12Runs,
    // The chat can take two attempts of 60 s; completion adds extraction retries and the recap.
    chat: (token, body) => supabase('/functions/v1/marcus-audit-chat', config.anonKey, token,
      { method: 'POST', body, timeoutMs: 150_000 }),
    complete: (token, body) => supabase('/functions/v1/pricing-audit-complete', config.anonKey, token,
      { method: 'POST', body, timeoutMs: 300_000 }),
  };
}

const sameEntitlement = (a, b) =>
  a.plan === b.plan && a.status === b.status && a.welcome_audit_used === b.welcome_audit_used &&
  a.last_audit_completed_at === b.last_audit_completed_at;

export async function runLiveQa({ argv, env, fetch, log, sleep = ms => new Promise(r => setTimeout(r, ms)) }) {
  const emit = record => log(JSON.stringify(record));
  const { problems: configProblems, config } = readConfig(env);
  if (argv.includes('--dry-run')) {
    log('Dry run: nothing is sent. A confirmed run would do these steps:');
    PLAN.forEach((step, i) => log(`${i + 1}. ${step}`));
    log(configProblems.length ? `Configuration not ready: ${configProblems.join('; ')}.`
      : `Target: project ${config.projectRef}, QA account ${config.userId}.`);
    log('To run: --execute --confirm-project=<project ref> --confirm-user=<QA account ID>');
    return 0;
  }
  const problems = [...configProblems, ...confirmationProblems(argv, config)];
  if (problems.length) {
    log(`Refused, nothing was sent: ${problems.join('; ')}.`);
    log('Run with --dry-run to see the plan.');
    return 2;
  }

  const prod = production(config, fetch);
  const user = config.userId;
  const sessionId = randomUUID();
  const gatedSessionId = randomUUID();
  const runIds = [sessionId, gatedSessionId];
  let before;
  let saved;
  let token;
  let failure;
  let step = 'before';
  const readRun = async () => (await prod.query(sql.runRows(user, runIds)))[0].run;

  try {
    const [pre] = await prod.query(sql.preflight(user));
    check(pre, 'the QA account has no users row');
    check(pre.migrated === true && pre.completion_rpc === 1, 'the Milestone 2 migration is not applied');
    check(pre.audits === 0, 'the QA account already has a pricing audit; clean it up before the run');
    const workflow = await prod.s12Workflow();
    check(workflow.status === 200 && workflow.data?.active === true, 'S12 is not active');
    saved = { plan: pre.plan, status: pre.status, welcome_audit_used: pre.welcome_audit_used,
      last_audit_completed_at: pre.last_audit_completed_at };
    before = await prod.query(sql.state(user, runIds));
    emit({ step, ok: true, session_id: sessionId, gated_session_id: gatedSessionId, state: before });

    step = 'sign in';
    token = await prod.signIn();
    emit({ step, ok: true });

    step = 'entitlement';
    await prod.query(sql.grant(user, saved));
    emit({ step, ok: true, granted: 'operator/active' });

    step = 'opener';
    const messages = [];
    const marcus = async label => {
      const r = await prod.chat(token, { session_id: sessionId, audit_intake: AUDIT_INTAKE, messages });
      check(r.status === 200 && typeof r.data?.reply === 'string' && r.data.reply.trim(),
        `${label}: HTTP ${r.status} ${r.data?.reason ?? ''}`.trim());
      messages.push({ role: 'assistant', content: r.data.reply });
      return r.data.reply;
    };
    const opener = await marcus('opener');
    messages.push({ role: 'user', content: QA_TURN });
    const reply = await marcus('exchange');
    emit({ step, ok: true, opener_chars: opener.length, reply_chars: reply.length });

    step = 'complete';
    const s12Before = new Set((await prod.s12Runs()).map(e => e.id));
    const body = { session_id: sessionId, audit_intake: AUDIT_INTAKE, messages };
    const completed = await prod.complete(token, body);
    check(completed.status === 200 && completed.data?.status === 'completed',
      `completion: HTTP ${completed.status} ${completed.data?.reason ?? completed.data?.status ?? ''}`.trim());
    const result = completed.data;
    const run = await readRun();
    const [session] = run.sessions;
    const [audit] = run.audits;
    check(run.sessions.length === 1 && session.id === sessionId && session.user_id === user,
      'exactly one sessions row with the run\'s ID');
    check(session.is_pricing_audit === true && session.processing_status === 'complete' &&
      session.summary_is_null === true && session.transcript_chars > 0, 'the Pricing audit sessions row fields');
    // jsonb reorders keys, so compare by value.
    check(isDeepStrictEqual(session.audit_intake, AUDIT_INTAKE), 'the stored Audit intake');
    check(session.session_number === run.max_other_session_number + 1, 'the audit takes the next session number');
    check(run.audits.length === 1 && audit.id === result.audit_id && audit.session_id === sessionId,
      'exactly one pricing_audits row, the one completion returned');
    check(audit.is_welcome_audit === true && result.is_welcome_audit === true, 'a Welcome audit');
    check(audit.verdict_action === result.verdict?.action && audit.verdict_number === result.verdict?.number &&
      audit.verdict_deadline === result.verdict?.deadline, 'the stored Verdict matches the response');
    check(isDeepStrictEqual(audit.baseline_keys, BASELINE_KEYS), 'the Baseline has its four fields');
    check(audit.next_eligible_date === result.next_eligible_date, 'the next eligible date');
    check(run.user.welcome_audit_used === true && run.user.cooldown_matches_audit === true, 'the Cooldown moved to the Completion');
    check(audit.recap_sent_at !== null, 'recap_sent_at is set');
    let recaps = [];
    for (let attempt = 0; attempt < 10; attempt++) {
      recaps = (await prod.s12Runs()).filter(e => !s12Before.has(e.id));
      if (recaps.length === 1 && recaps[0].status === 'success') break;
      await sleep(2_000);
    }
    check(recaps.length === 1 && recaps[0].status === 'success', `exactly one successful S12 run (saw ${recaps.length})`);
    emit({ step, ok: true, audit_id: audit.id, verdict_action: audit.verdict_action,
      next_eligible_date: audit.next_eligible_date, s12_execution: recaps[0].id });

    step = 'replay';
    const replay = await prod.complete(token, body);
    check(replay.status === 200 && replay.data?.status === 'already_completed', `replay: HTTP ${replay.status}`);
    check(replay.data.audit_id === result.audit_id &&
      isDeepStrictEqual(replay.data.verdict, result.verdict) &&
      replay.data.next_eligible_date === result.next_eligible_date, 'the replay returns the saved audit');
    check(isDeepStrictEqual(await readRun(), run), 'the replay wrote nothing');
    emit({ step, ok: true });

    step = 'gated';
    const gatedBody = { session_id: gatedSessionId, audit_intake: AUDIT_INTAKE, messages: [] };
    const gatedChat = await prod.chat(token, gatedBody);
    const gatedComplete = await prod.complete(token, { ...gatedBody, messages });
    for (const [label, r] of [['chat', gatedChat], ['completion', gatedComplete]])
      check(r.status === 403 && r.data?.reason === 'gated' && r.data?.next_eligible_date === result.next_eligible_date,
        `gated ${label}: HTTP ${r.status} ${r.data?.reason ?? ''}`.trim());
    check(isDeepStrictEqual(await readRun(), run), 'the gated attempt wrote nothing');
    await sleep(5_000);
    const late = (await prod.s12Runs()).filter(e => !s12Before.has(e.id));
    check(late.length === 1, `no S12 run after the replay or the gated attempt (saw ${late.length - 1})`);
    emit({ step, ok: true });
  } catch (error) {
    failure = error;
    emit({ step, ok: false, error: error instanceof QaFailure ? error.message : `${error.name}: ${error.message}` });
  }

  const outcome = await cleanUp({ prod, user, runIds, saved, token, readRun, emit });
  let after;
  if (before) {
    try {
      after = await prod.query(sql.state(user, runIds));
    } catch (error) {
      emit({ step: 'after', ok: false, error: error.message });
    }
  }
  const { differences, countChanges } = before && after ? compareState(before, after)
    : { differences: ['the before or after state is missing'], countChanges: [] };
  if (before) emit({ step: 'after', ok: after !== undefined && differences.length === 0, state: after, differences,
    count_changes: countChanges });

  if (before && after && differences.length)
    log('FAILED: production differs from before the run. Investigate each difference before anything else.');
  const failedStep = failure ? step : !outcome.ok ? 'cleanup' : differences.length ? 'after' : null;
  emit(failedStep ? { result: 'failed', failed_step: failedStep } : { result: 'passed' });
  return failedStep ? 1 : 0;
}

// Cleanup runs after every run that got past the preflight, whatever failed. It reads the rows
// tied to the run's own session IDs and deletes exactly those, then restores the saved
// entitlement if it changed. The audit ID from the completion response is never trusted alone.
async function cleanUp({ prod, user, runIds, saved, token, readRun, emit }) {
  let ok = true;
  if (saved) {
    try {
      const run = await readRun();
      const auditIds = run.audits.filter(a => runIds.includes(a.session_id) && a.user_id === user).map(a => a.id);
      const sessionIds = run.sessions.filter(s => s.user_id === user && s.is_pricing_audit).map(s => s.id);
      // Restore only over the granted values. A grant whose response was lost still committed, so
      // the row is read, not assumed. Without the granted values the plan or status changed
      // outside the run: that change is kept, and the after step reports it. The Welcome audit
      // flag and the Cooldown are the run's own, so they must still be back at their saved values.
      const granted = run.user.plan === 'operator' && run.user.status === 'active';
      const restore = granted && !sameEntitlement(run.user, saved) ? saved : null;
      if (auditIds.length || sessionIds.length || restore) {
        await prod.query(sql.cleanup(user, { auditIds, sessionIds, restore }));
      }
      const left = await readRun();
      check(left.sessions.length === 0 && left.audits.length === 0, 'rows remain after cleanup');
      const ownFieldsSaved = left.user.welcome_audit_used === saved.welcome_audit_used &&
        left.user.last_audit_completed_at === saved.last_audit_completed_at;
      check(restore ? sameEntitlement(left.user, saved) : ownFieldsSaved,
        'the entitlement is not back at its saved values');
      emit({ step: 'cleanup', ok: true, deleted_audits: auditIds, deleted_sessions: sessionIds, restored: !!restore });
    } catch (error) {
      ok = false;
      emit({ step: 'cleanup', ok: false, error: error.message,
        action: 'Clean up by hand with the runbook, using the session IDs printed in the before step.' });
    }
  }
  if (token) {
    try {
      const r = await prod.signOut(token);
      emit({ step: 'sign out', ok: r.status === 204, status: r.status });
      if (r.status !== 204) ok = false;
    } catch (error) {
      ok = false;
      emit({ step: 'sign out', ok: false, error: error.message });
    }
  }
  return { ok };
}

// A hashed row covers the QA account and the run, so any change fails the run. A row without a
// hash is a whole-table count: live traffic moves it, so a change is only reported.
function compareState(before, after) {
  const index = rows => new Map(rows.map(r => [r.name, r]));
  const [b, a] = [index(before), index(after)];
  const differences = [];
  const countChanges = [];
  for (const name of new Set([...b.keys(), ...a.keys()])) {
    const x = b.get(name);
    const y = a.get(name);
    if (x && y && x.hash === null && y.hash === null) {
      if (x.rows !== y.rows) countChanges.push(`${name}: rows ${x.rows} -> ${y.rows}`);
    } else if (!x || !y || x.rows !== y.rows || x.hash !== y.hash) {
      differences.push(`${name}: rows ${x?.rows} -> ${y?.rows}, hash ${x?.hash === y?.hash ? 'same' : 'changed'}`);
    }
  }
  return { differences, countChanges };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const env = { ...process.env };
  for (const name of Object.values(ENV)) delete process.env[name];
  process.exitCode = await runLiveQa({ argv: process.argv.slice(2), env, fetch: globalThis.fetch, log: console.log });
}
