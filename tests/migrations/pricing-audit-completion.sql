-- Contract tests for the Milestone 2 completion migration. The baseline mirrors the live
-- columns, the session numbering trigger and Supabase's default EXECUTE grants.
-- Roles are cluster-wide; the foundation test in the same container may have created them.
do $$
begin
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
exception
  when duplicate_object then null;
end;
$$;

alter default privileges in schema public
  grant execute on functions to anon, authenticated, service_role;

create schema auth;

create table auth.users (
  id uuid primary key
);

create function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create type public.plan_type as enum ('builder', 'operator', 'lifetime');
create type public.user_status as enum (
  'trialing', 'active', 'past_due', 'canceled', 'pending', 'deleted'
);
create type public.session_processing_status as enum ('pending', 'complete', 'failed');

create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  plan public.plan_type not null default 'builder',
  trial_end timestamptz,
  status public.user_status not null default 'pending',
  updated_at timestamptz not null default now()
);

create table public.profiles (
  user_id uuid primary key references public.users(id) on delete cascade,
  pricing_audit_last_date timestamptz,
  goal_90_day text,
  goal_progress integer not null default 0,
  goal_start_date timestamptz
);

create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  session_number integer not null,
  transcript text default '',
  summary text,
  goal_progress_score integer check (goal_progress_score >= 0 and goal_progress_score <= 100),
  action_committed text,
  is_pricing_audit boolean not null default false,
  processing_status public.session_processing_status not null default 'pending',
  retry_count integer not null default 0,
  last_error text
);

create function public.assign_session_number()
returns trigger
language plpgsql
as $$
begin
  if new.session_number is null or new.session_number = 0 then
    select coalesce(max(session_number), 0) + 1
      into new.session_number
      from public.sessions
     where user_id = new.user_id;
  end if;
  return new;
end;
$$;

create trigger trg_sessions_assign_number
before insert on public.sessions
for each row execute function public.assign_session_number();

alter table public.users enable row level security;
alter table public.profiles enable row level security;
alter table public.sessions enable row level security;

create policy users_select_own
on public.users for select to authenticated
using ((select auth.uid()) = id);

create policy sessions_select_own
on public.sessions for select to authenticated
using ((select auth.uid()) = user_id);

grant usage on schema public to anon, authenticated, service_role;
grant all on public.users, public.profiles, public.sessions to anon, authenticated, service_role;

create function public.can_request_pricing_audit(p_user_id uuid)
returns boolean
language sql
stable
as $$ select false; $$;

create function public.next_pricing_audit_date(p_user_id uuid)
returns timestamptz
language sql
stable
as $$ select now(); $$;

\ir ../../supabase/migrations/20260919105053_quarterly_pricing_audit_foundation.sql

create temp table m1_functions as
select oid, proname, md5(pg_get_functiondef(oid)) as definition, proacl::text as acl
from pg_proc
where oid in (
  'public.can_request_pricing_audit(uuid)'::regprocedure,
  'public.next_pricing_audit_date(uuid)'::regprocedure
);

\ir ../../supabase/migrations/20260924170000_pricing_audit_completion.sql

-- Customers: A is on the Welcome audit with two normal sessions; B has nothing yet;
-- C is on Builder, so not Entitled.
insert into auth.users (id) values
  ('00000000-0000-0000-0000-00000000000a'),
  ('00000000-0000-0000-0000-00000000000b'),
  ('00000000-0000-0000-0000-00000000000c');
insert into public.users (id, email, plan, status) values
  ('00000000-0000-0000-0000-00000000000a', 'a@example.test', 'operator', 'active'),
  ('00000000-0000-0000-0000-00000000000b', 'b@example.test', 'lifetime', 'active'),
  ('00000000-0000-0000-0000-00000000000c', 'c@example.test', 'builder', 'active');
insert into public.profiles (user_id, goal_90_day, goal_progress, goal_start_date) values
  ('00000000-0000-0000-0000-00000000000a', 'Reach 10k MRR', 42, '2026-08-01T00:00:00Z'),
  ('00000000-0000-0000-0000-00000000000b', null, 0, null),
  ('00000000-0000-0000-0000-00000000000c', null, 0, null);
insert into public.sessions (user_id, transcript, summary, goal_progress_score, action_committed, processing_status) values
  ('00000000-0000-0000-0000-00000000000a', 'Founder: hi', 'First.', 60, 'Ship onboarding', 'complete'),
  ('00000000-0000-0000-0000-00000000000a', 'Founder: again', 'Second.', 70, 'Call five churned users', 'complete');

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'pricing_audits' and column_name = 'recap_sent_at'
      and data_type = 'timestamp with time zone' and is_nullable = 'YES' and column_default is null
  ) then
    raise exception 'pricing_audits.recap_sent_at contract is missing';
  end if;
end;
$$;

-- The next eligible date is the UTC calendar date 90 days after the Completion.
do $$
declare
  case_row record;
begin
  for case_row in
    select * from (values
      ('2026-01-15T10:00:00Z'::timestamptz, '2026-04-15'::date),
      ('2026-06-21T12:00:00Z', '2026-09-19'),
      ('2026-06-21T23:30:00-05:00', '2026-09-20'),
      ('2026-10-03T00:00:00Z', '2027-01-01'),
      ('2026-11-30T23:59:59Z', '2027-02-28'),
      ('2026-12-01T00:00:00Z', '2027-03-01'),
      ('2027-12-31T12:00:00Z', '2028-03-30')
    ) as cases(completed_at, expected)
  loop
    if public.pricing_audit_next_eligible_date(case_row.completed_at) is distinct from case_row.expected then
      raise exception 'next eligible date for % was %, expected %',
        case_row.completed_at, public.pricing_audit_next_eligible_date(case_row.completed_at), case_row.expected;
    end if;
  end loop;
  if public.pricing_audit_next_eligible_date(null) is not null then
    raise exception 'next eligible date of null must be null';
  end if;
end;
$$;

-- The SQL eligibility rule agrees with the TypeScript decision on the shared table of cases
-- (tests/functions/pricing-audit-eligibility-parity.test.ts asserts the same file).
\set eligibility_cases `cat /workspace/tests/fixtures/pricing-audit-eligibility-cases.json`
create temp table eligibility_cases as
select value as eligibility_case from jsonb_array_elements(:'eligibility_cases'::jsonb);

-- The rule must not depend on the session time zone (the fixture includes a DST change).
set timezone = 'America/New_York';

do $$
declare
  test_case jsonb;
  decision record;
  actual jsonb;
begin
  for test_case in select eligibility_case from eligibility_cases loop
    begin
      select * into strict decision from public.pricing_audit_decide_eligibility(
        (test_case #>> '{record,plan}')::public.plan_type,
        (test_case #>> '{record,status}')::public.user_status,
        (test_case #>> '{record,trial_end}')::timestamptz,
        (test_case #>> '{record,welcome_audit_used}')::boolean,
        (test_case #>> '{record,last_audit_completed_at}')::timestamptz,
        (test_case ->> 'now')::timestamptz
      );
    exception
      when raise_exception then
        if (test_case #>> '{expected,error}')::boolean is not true then
          raise exception 'parity case "%" raised: %', test_case ->> 'name', sqlerrm;
        end if;
        continue;
    end;
    actual := case decision.state
      when 'eligible' then jsonb_build_object('state', 'eligible', 'is_welcome_audit', decision.is_welcome_audit)
      when 'gated' then jsonb_build_object('state', 'gated', 'next_eligible_date', decision.next_eligible_date)
      else jsonb_build_object('state', decision.state)
    end;
    if actual is distinct from test_case -> 'expected' then
      raise exception 'parity case "%": SQL gave %, expected %', test_case ->> 'name', actual, test_case -> 'expected';
    end if;
  end loop;
  if (select count(*) from eligibility_cases) < 17 then
    raise exception 'the parity table did not load';
  end if;
end;
$$;
reset timezone;

-- Only the service role may execute the Completion RPCs.
do $$
declare
  rpc regprocedure;
begin
  foreach rpc in array array[
    'public.complete_pricing_audit(uuid, uuid, text, jsonb, text, text, date, text, jsonb)'::regprocedure,
    'public.pricing_audit_session_state(uuid, uuid)'::regprocedure,
    'public.pricing_audit_decide_eligibility(public.plan_type, public.user_status, timestamptz, boolean, timestamptz, timestamptz)'::regprocedure
  ] loop
    if has_function_privilege('anon', rpc, 'EXECUTE') then
      raise exception 'anon must not execute %', rpc;
    end if;
    if has_function_privilege('authenticated', rpc, 'EXECUTE') then
      raise exception 'authenticated must not execute %', rpc;
    end if;
    if exists (select 1 from pg_proc, aclexplode(proacl) as acl where oid = rpc and acl.grantee = 0) then
      raise exception 'PUBLIC must not execute %', rpc;
    end if;
    if not has_function_privilege('service_role', rpc, 'EXECUTE') then
      raise exception 'service_role must execute %', rpc;
    end if;
  end loop;
end;
$$;

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
do $$
begin
  perform public.complete_pricing_audit(
    '00000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a9',
    'Founder: x', '{}'::jsonb, 'hold', null, current_date + 30, 'r', '{}'::jsonb
  );
  raise exception 'authenticated executed complete_pricing_audit';
exception
  when insufficient_privilege then null;
end;
$$;
reset role;

-- The Welcome audit: one call writes the session, the audit and the moved Cooldown together.
set role service_role;
create temp table welcome_result as
select * from public.complete_pricing_audit(
  '00000000-0000-0000-0000-00000000000a',
  '20000000-0000-0000-0000-0000000000a1',
  E'Marcus: What do you charge?\n\nFounder: 49 a month.\n\nMarcus: Raise to 59 within 38 days.',
  '{"mrr": 4200, "customer_count": 37, "churn_rate": 4.5, "current_pricing": "49", "last_pricing_change": "Never"}'::jsonb,
  'raise', '59', (now() at time zone 'UTC')::date + 38, 'Customers anchor on time saved.',
  '{"value_anchor": "time saved", "friction_read": "low", "mix": "solo", "churn_window": "month 2"}'::jsonb
);
reset role;

do $$
declare
  result record;
  audit record;
  session record;
  customer record;
begin
  select * into strict result from welcome_result;
  select * into strict audit from public.pricing_audits where session_id = '20000000-0000-0000-0000-0000000000a1';
  select * into strict session from public.sessions where id = '20000000-0000-0000-0000-0000000000a1';
  select * into strict customer from public.users where id = '00000000-0000-0000-0000-00000000000a';

  if result.audit_id <> audit.id or result.status <> 'completed' or result.is_welcome_audit is not true then
    raise exception 'unexpected Welcome audit result: %', row_to_json(result);
  end if;
  if (result.verdict_action, result.verdict_number, result.verdict_deadline, result.verdict_reasoning)
     is distinct from ('raise', '59', (now() at time zone 'UTC')::date + 38, 'Customers anchor on time saved.') then
    raise exception 'result does not echo the Verdict: %', row_to_json(result);
  end if;
  if result.next_eligible_date <> public.pricing_audit_next_eligible_date(audit.completed_at) then
    raise exception 'result next eligible date does not follow the shared rule';
  end if;

  if audit.user_id <> customer.id or audit.is_welcome_audit is not true or audit.recap_sent_at is not null
     or audit.baseline <> '{"value_anchor": "time saved", "friction_read": "low", "mix": "solo", "churn_window": "month 2"}'::jsonb then
    raise exception 'unexpected audit row: %', row_to_json(audit);
  end if;

  if session.user_id <> customer.id or session.is_pricing_audit is not true
     or session.processing_status <> 'complete' or session.summary is not null
     or session.goal_progress_score is not null or session.action_committed is not null
     or session.transcript not like 'Marcus: What do you charge?%'
     or session.audit_intake ->> 'current_pricing' <> '49' then
    raise exception 'unexpected audit session row: %', row_to_json(session);
  end if;
  if session.session_number <> 3 then
    raise exception 'audit session must take the next session number, got %', session.session_number;
  end if;

  if customer.welcome_audit_used is not true or customer.last_audit_completed_at <> audit.completed_at then
    raise exception 'the Cooldown did not move with the Completion';
  end if;

  if (select count(*) from public.sessions where user_id = customer.id) <> 3
     or (select count(*) from public.pricing_audits where user_id = customer.id) <> 1 then
    raise exception 'one Completion must write exactly one session and one audit';
  end if;

  if (select goal_progress from public.profiles where user_id = customer.id) <> 42
     or (select goal_start_date from public.profiles where user_id = customer.id) <> '2026-08-01T00:00:00Z'
     or (select array_agg(goal_progress_score order by session_number) from public.sessions
         where user_id = customer.id and not is_pricing_audit) <> array[60, 70] then
    raise exception 'Completion changed goal progress';
  end if;
end;
$$;

-- Replaying a completed session returns the saved audit without a second record or clock move.
create temp table before_replay as
select
  (select last_audit_completed_at from public.users where id = '00000000-0000-0000-0000-00000000000a') as clock,
  (select count(*) from public.sessions) as sessions,
  (select count(*) from public.pricing_audits) as audits;

set role service_role;
create temp table replay_result as
select * from public.complete_pricing_audit(
  '00000000-0000-0000-0000-00000000000a',
  '20000000-0000-0000-0000-0000000000a1',
  'Marcus: A different ending.', '{}'::jsonb, 'hold', null, (now() at time zone 'UTC')::date + 10,
  'A different Verdict must not replace the saved one.',
  '{"value_anchor": "a", "friction_read": "b", "mix": "c", "churn_window": "d"}'::jsonb
);
create temp table state_completed as
select * from public.pricing_audit_session_state('00000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a1');
create temp table state_new as
select * from public.pricing_audit_session_state('00000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a7');
create temp table state_other_customer as
select * from public.pricing_audit_session_state('00000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-0000000000a1');
create temp table state_coaching_session as
select * from public.pricing_audit_session_state(
  '00000000-0000-0000-0000-00000000000a',
  (select id from public.sessions where user_id = '00000000-0000-0000-0000-00000000000a' and not is_pricing_audit limit 1)
);
reset role;

do $$
declare
  replay record;
  saved record;
  state record;
begin
  select * into strict replay from replay_result;
  select * into strict saved from welcome_result;
  if replay.status <> 'already_completed' or replay.audit_id <> saved.audit_id
     or (replay.verdict_action, replay.verdict_number, replay.verdict_deadline, replay.verdict_reasoning,
         replay.is_welcome_audit, replay.next_eligible_date)
        is distinct from (saved.verdict_action, saved.verdict_number, saved.verdict_deadline, saved.verdict_reasoning,
         saved.is_welcome_audit, saved.next_eligible_date) then
    raise exception 'a replay must return the saved audit: %', row_to_json(replay);
  end if;
  if (select clock from before_replay)
       <> (select last_audit_completed_at from public.users where id = '00000000-0000-0000-0000-00000000000a')
     or (select sessions from before_replay) <> (select count(*) from public.sessions)
     or (select audits from before_replay) <> (select count(*) from public.pricing_audits) then
    raise exception 'a replay wrote a second record or moved the clock';
  end if;

  select * into strict state from state_completed;
  if state.status <> 'already_completed' or state.audit_id <> saved.audit_id
     or state.next_eligible_date <> saved.next_eligible_date or state.verdict_number <> '59' then
    raise exception 'session state for a completed audit: %', row_to_json(state);
  end if;
  select * into strict state from state_new;
  if state.status <> 'new' or state.audit_id is not null then
    raise exception 'session state for an unused ID: %', row_to_json(state);
  end if;
  select * into strict state from state_other_customer;
  if state.status <> 'session_conflict' or state.audit_id is not null then
    raise exception 'session state for another customer''s session: %', row_to_json(state);
  end if;
  select * into strict state from state_coaching_session;
  if state.status <> 'session_conflict' then
    raise exception 'session state for a coaching session: %', row_to_json(state);
  end if;
end;
$$;

-- Refusals under the row lock write nothing: another customer's session, a coaching session,
-- a customer inside the Cooldown, and a customer who isn't Entitled.
create temp table before_refusals as
select
  (select count(*) from public.sessions) as sessions,
  (select count(*) from public.pricing_audits) as audits,
  (select jsonb_agg(to_jsonb(u) order by id) from public.users as u) as customers;

set role service_role;
create temp table refusals as
select 'other customer' as label, r.* from public.complete_pricing_audit(
  '00000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-0000000000a1',
  'Marcus: x', '{}'::jsonb, 'hold', null, (now() at time zone 'UTC')::date + 10, 'r', '{}'::jsonb) as r
union all
select 'coaching session', r.* from public.complete_pricing_audit(
  '00000000-0000-0000-0000-00000000000a',
  (select id from public.sessions where user_id = '00000000-0000-0000-0000-00000000000a' and not is_pricing_audit limit 1),
  'Marcus: x', '{}'::jsonb, 'hold', null, (now() at time zone 'UTC')::date + 10, 'r', '{}'::jsonb) as r
union all
select 'inside the Cooldown', r.* from public.complete_pricing_audit(
  '00000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a3',
  'Marcus: x', '{}'::jsonb, 'hold', null, (now() at time zone 'UTC')::date + 10, 'r', '{}'::jsonb) as r
union all
select 'not Entitled', r.* from public.complete_pricing_audit(
  '00000000-0000-0000-0000-00000000000c', '20000000-0000-0000-0000-0000000000c1',
  'Marcus: x', '{}'::jsonb, 'hold', null, (now() at time zone 'UTC')::date + 10, 'r', '{}'::jsonb) as r;
reset role;

do $$
declare
  refusal record;
begin
  for refusal in select * from refusals loop
    if refusal.audit_id is not null or refusal.verdict_action is not null or refusal.status <> (case refusal.label
      when 'other customer' then 'session_conflict'
      when 'coaching session' then 'session_conflict'
      when 'inside the Cooldown' then 'gated'
      when 'not Entitled' then 'plan_lapsed'
    end) then
      raise exception 'unexpected refusal for %: %', refusal.label, row_to_json(refusal);
    end if;
    if (refusal.label = 'inside the Cooldown') <> (refusal.next_eligible_date is not null) then
      raise exception 'only gated carries the next eligible date: %', row_to_json(refusal);
    end if;
  end loop;
  if (select next_eligible_date from refusals where label = 'inside the Cooldown')
     <> (select public.pricing_audit_next_eligible_date(last_audit_completed_at)
         from public.users where id = '00000000-0000-0000-0000-00000000000a') then
    raise exception 'gated must carry the next eligible date';
  end if;
  if (select count(*) from refusals) <> 4
     or (select sessions from before_refusals) <> (select count(*) from public.sessions)
     or (select audits from before_refusals) <> (select count(*) from public.pricing_audits)
     or (select customers from before_refusals)
        <> (select jsonb_agg(to_jsonb(u) order by id) from public.users as u) then
    raise exception 'a refused Completion changed the database';
  end if;
end;
$$;

-- A later audit, once the Cooldown is over, is not a Welcome audit, takes the next number and
-- moves the Cooldown again.
update public.users
set last_audit_completed_at = now() - interval '91 days'
where id = '00000000-0000-0000-0000-00000000000a';

set role service_role;
create temp table later_result as
select * from public.complete_pricing_audit(
  '00000000-0000-0000-0000-00000000000a',
  '20000000-0000-0000-0000-0000000000a2',
  'Marcus: Hold.', '{}'::jsonb, 'hold', null, (now() at time zone 'UTC')::date + 60, 'Evidence unchanged.',
  '{"value_anchor": "a", "friction_read": "b", "mix": "c", "churn_window": "d"}'::jsonb
);
reset role;

do $$
declare
  result record;
begin
  select * into strict result from later_result;
  if result.is_welcome_audit is not false then
    raise exception 'a later audit must not be a Welcome audit';
  end if;
  if (select session_number from public.sessions where id = '20000000-0000-0000-0000-0000000000a2') <> 4 then
    raise exception 'the later audit session must be number 4';
  end if;
  if (select last_audit_completed_at from public.users where id = '00000000-0000-0000-0000-00000000000a')
     <> (select completed_at from public.pricing_audits where id = result.audit_id) then
    raise exception 'the Cooldown did not move to the later Completion';
  end if;
  if (select count(*) from public.pricing_audits where user_id = '00000000-0000-0000-0000-00000000000a') <> 2 then
    raise exception 'expected two audits for customer A';
  end if;
end;
$$;

-- A failed Completion writes nothing.
set role service_role;
do $$
declare
  completion_date date := (now() at time zone 'UTC')::date;
  deadline date;
begin
  -- The RPC re-checks the deadline window against its own completion date.
  foreach deadline in array array[completion_date, (completion_date + interval '1 year')::date + 1] loop
    begin
      perform public.complete_pricing_audit(
        '00000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-0000000000b2',
        'Marcus: x', '{}'::jsonb, 'hold', null, deadline, 'Deadline out of range.', '{}'::jsonb
      );
      raise exception 'a deadline of % was accepted', deadline;
    exception
      when invalid_parameter_value then null;
    end;
  end loop;
  -- One year out is the last accepted day.
  begin
    perform public.complete_pricing_audit(
      '00000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-0000000000b3',
      'Marcus: x', '{}'::jsonb, 'lower', null, (completion_date + interval '1 year')::date,
      'Invalid action, valid deadline.', '{}'::jsonb
    );
    raise exception 'an invalid Verdict action was accepted';
  exception
    when check_violation then null;
  end;
end;
$$;
do $$
begin
  perform public.complete_pricing_audit(
    '00000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-0000000000b1',
    'Marcus: x', '{}'::jsonb, 'lower', '10', (now() at time zone 'UTC')::date + 60, 'Invalid action.', '{}'::jsonb
  );
  raise exception 'an invalid Verdict action was accepted';
exception
  when check_violation then null;
end;
$$;
do $$
begin
  perform public.complete_pricing_audit(
    '00000000-0000-0000-0000-0000000000ff', '20000000-0000-0000-0000-0000000000f1',
    'Marcus: x', '{}'::jsonb, 'hold', null, (now() at time zone 'UTC')::date + 60, 'Unknown customer.', '{}'::jsonb
  );
  raise exception 'a Completion for an unknown customer was accepted';
exception
  when no_data_found then null;
end;
$$;
reset role;

do $$
begin
  if exists (select 1 from public.sessions where user_id = '00000000-0000-0000-0000-00000000000b')
     or exists (select 1 from public.pricing_audits where user_id = '00000000-0000-0000-0000-00000000000b')
     or (select welcome_audit_used from public.users where id = '00000000-0000-0000-0000-00000000000b') then
    raise exception 'a failed Completion left rows or state behind';
  end if;
  if exists (select 1 from public.sessions where id = '20000000-0000-0000-0000-0000000000f1') then
    raise exception 'a Completion for an unknown customer left a session';
  end if;
end;
$$;

-- The Milestone 1 compatibility functions are unchanged.
do $$
begin
  if exists (
    select 1 from m1_functions as before
    join pg_proc as after on after.oid = before.oid
    where md5(pg_get_functiondef(after.oid)) <> before.definition
       or after.proacl::text is distinct from before.acl
  ) or (select count(*) from m1_functions) <> 2
    or (select count(*) from pg_proc where oid in (select oid from m1_functions)) <> 2 then
    raise exception 'Milestone 1 compatibility functions changed';
  end if;
end;
$$;
