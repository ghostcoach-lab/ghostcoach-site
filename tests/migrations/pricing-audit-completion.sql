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

-- Customers: A is on the Welcome audit with two normal sessions; B has nothing yet.
insert into auth.users (id) values
  ('00000000-0000-0000-0000-00000000000a'),
  ('00000000-0000-0000-0000-00000000000b');
insert into public.users (id, email, plan, status) values
  ('00000000-0000-0000-0000-00000000000a', 'a@example.test', 'operator', 'active'),
  ('00000000-0000-0000-0000-00000000000b', 'b@example.test', 'lifetime', 'active');
insert into public.profiles (user_id, goal_90_day, goal_progress, goal_start_date) values
  ('00000000-0000-0000-0000-00000000000a', 'Reach 10k MRR', 42, '2026-08-01T00:00:00Z'),
  ('00000000-0000-0000-0000-00000000000b', null, 0, null);
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

-- Only the service role may execute the Completion RPC.
do $$
declare
  rpc regprocedure := 'public.complete_pricing_audit(uuid, uuid, text, jsonb, text, text, date, text, jsonb)';
begin
  if has_function_privilege('anon', rpc, 'EXECUTE') then
    raise exception 'anon must not execute complete_pricing_audit';
  end if;
  if has_function_privilege('authenticated', rpc, 'EXECUTE') then
    raise exception 'authenticated must not execute complete_pricing_audit';
  end if;
  if exists (select 1 from pg_proc, aclexplode(proacl) as acl where oid = rpc and acl.grantee = 0) then
    raise exception 'PUBLIC must not execute complete_pricing_audit';
  end if;
  if not has_function_privilege('service_role', rpc, 'EXECUTE') then
    raise exception 'service_role must execute complete_pricing_audit';
  end if;
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
  E'Marcus: What do you charge?\n\nFounder: 49 a month.\n\nMarcus: Raise to 59 by 2026-11-01.',
  '{"mrr": 4200, "customer_count": 37, "churn_rate": 4.5, "current_pricing": "49", "last_pricing_change": "Never"}'::jsonb,
  'raise', '59', '2026-11-01', 'Customers anchor on time saved.',
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
     is distinct from ('raise', '59', '2026-11-01'::date, 'Customers anchor on time saved.') then
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

-- A later audit is not a Welcome audit, takes the next number and moves the Cooldown again.
set role service_role;
create temp table later_result as
select * from public.complete_pricing_audit(
  '00000000-0000-0000-0000-00000000000a',
  '20000000-0000-0000-0000-0000000000a2',
  'Marcus: Hold.', '{}'::jsonb, 'hold', null, '2026-12-01', 'Evidence unchanged.',
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
begin
  perform public.complete_pricing_audit(
    '00000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-0000000000b1',
    'Marcus: x', '{}'::jsonb, 'lower', '10', '2026-12-01', 'Invalid action.', '{}'::jsonb
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
    'Marcus: x', '{}'::jsonb, 'hold', null, '2026-12-01', 'Unknown customer.', '{}'::jsonb
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
