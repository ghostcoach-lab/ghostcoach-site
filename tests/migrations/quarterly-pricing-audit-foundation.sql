create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

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
  plan public.plan_type not null default 'builder',
  trial_end timestamptz,
  status public.user_status not null default 'pending'
);

create table public.profiles (
  user_id uuid primary key references public.users(id) on delete cascade,
  pricing_audit_last_date timestamptz
);

create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  is_pricing_audit boolean not null default false,
  processing_status public.session_processing_status not null default 'pending'
);

alter table public.users enable row level security;
alter table public.profiles enable row level security;
alter table public.sessions enable row level security;

create policy users_select_own
on public.users for select to authenticated
using ((select auth.uid()) = id);

create policy sessions_select_own
on public.sessions for select to authenticated
using ((select auth.uid()) = user_id);

create policy sessions_insert_own
on public.sessions for insert to authenticated
with check ((select auth.uid()) = user_id);

grant all on public.users, public.profiles, public.sessions to anon, authenticated, service_role;

create function public.can_request_pricing_audit(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    u.plan = 'operator'
    and (
      p.pricing_audit_last_date is null
      or now() > p.pricing_audit_last_date + interval '90 days'
    )
  from public.users u
  join public.profiles p on p.user_id = u.id
  where u.id = p_user_id;
$$;

create function public.next_pricing_audit_date(p_user_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select case
    when pricing_audit_last_date is null then now()
    else pricing_audit_last_date + interval '90 days'
  end
  from public.profiles
  where user_id = p_user_id;
$$;

create temp table legacy_function_oids as
select proname, oid
from pg_proc
where oid in (
  'public.can_request_pricing_audit(uuid)'::regprocedure,
  'public.next_pricing_audit_date(uuid)'::regprocedure
);

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-000000000002'),
  ('00000000-0000-0000-0000-000000000003'),
  ('00000000-0000-0000-0000-000000000004'),
  ('00000000-0000-0000-0000-000000000005'),
  ('00000000-0000-0000-0000-000000000006'),
  ('00000000-0000-0000-0000-000000000007'),
  ('00000000-0000-0000-0000-000000000008');

insert into public.users (id, plan, status, trial_end) values
  ('00000000-0000-0000-0000-000000000001', 'operator', 'active', null),
  ('00000000-0000-0000-0000-000000000002', 'operator', 'trialing', now() + interval '1 day'),
  ('00000000-0000-0000-0000-000000000003', 'operator', 'trialing', now() - interval '1 day'),
  ('00000000-0000-0000-0000-000000000004', 'operator', 'past_due', null),
  ('00000000-0000-0000-0000-000000000005', 'builder', 'active', null),
  ('00000000-0000-0000-0000-000000000006', 'lifetime', 'active', null),
  ('00000000-0000-0000-0000-000000000007', 'operator', 'active', null),
  ('00000000-0000-0000-0000-000000000008', 'operator', 'active', null);

insert into public.profiles (user_id)
select id from public.users;

\ir ../../supabase/migrations/20260919105053_quarterly_pricing_audit_foundation.sql

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'pricing_audit_last_date'
  ) then
    raise exception 'legacy pricing_audit_last_date still exists';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'users'
      and column_name = 'last_audit_completed_at'
      and data_type = 'timestamp with time zone'
      and is_nullable = 'YES'
  ) then
    raise exception 'users.last_audit_completed_at contract is missing';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'users'
      and column_name = 'welcome_audit_used'
      and data_type = 'boolean'
      and is_nullable = 'NO'
      and column_default = 'false'
  ) then
    raise exception 'users.welcome_audit_used contract is missing';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'sessions'
      and column_name = 'audit_intake'
      and data_type = 'jsonb'
      and is_nullable = 'YES'
  ) then
    raise exception 'sessions.audit_intake contract is missing';
  end if;

  if to_regclass('public.pricing_audits') is null then
    raise exception 'public.pricing_audits is missing';
  end if;

  if exists (
    select 1
    from legacy_function_oids as before
    where before.oid <> case before.proname
      when 'can_request_pricing_audit' then 'public.can_request_pricing_audit(uuid)'::regprocedure::oid
      when 'next_pricing_audit_date' then 'public.next_pricing_audit_date(uuid)'::regprocedure::oid
    end
  ) then
    raise exception 'legacy function identity was not preserved';
  end if;
end;
$$;

update public.users
set welcome_audit_used = true,
    last_audit_completed_at = now() - interval '10 days'
where id = '00000000-0000-0000-0000-000000000007';

update public.users
set welcome_audit_used = true,
    last_audit_completed_at = now() - interval '91 days'
where id = '00000000-0000-0000-0000-000000000008';

do $$
begin
  begin
    update public.users
    set welcome_audit_used = true,
        last_audit_completed_at = null
    where id = '00000000-0000-0000-0000-000000000001';
    raise exception 'welcome audit was marked used without a completion time';
  exception
    when check_violation then null;
  end;

  if public.can_request_pricing_audit('00000000-0000-0000-0000-000000000001') is not true then
    raise exception 'active Operator welcome audit must be eligible';
  end if;
  if public.can_request_pricing_audit('00000000-0000-0000-0000-000000000002') is not true then
    raise exception 'unexpired Operator trial welcome audit must be eligible';
  end if;
  if public.can_request_pricing_audit('00000000-0000-0000-0000-000000000003') is not false then
    raise exception 'expired Operator trial must not be eligible';
  end if;
  if public.can_request_pricing_audit('00000000-0000-0000-0000-000000000004') is not false then
    raise exception 'past-due Operator must not be eligible';
  end if;
  if public.can_request_pricing_audit('00000000-0000-0000-0000-000000000005') is not false then
    raise exception 'active Builder must not be eligible';
  end if;
  if public.can_request_pricing_audit('00000000-0000-0000-0000-000000000006') is not true then
    raise exception 'active Lifetime customer must be eligible';
  end if;
  if public.can_request_pricing_audit('00000000-0000-0000-0000-000000000007') is not false then
    raise exception 'recent completed audit must be gated';
  end if;
  if public.can_request_pricing_audit('00000000-0000-0000-0000-000000000008') is not true then
    raise exception 'audit older than 90 days must be eligible';
  end if;
  if public.next_pricing_audit_date('00000000-0000-0000-0000-000000000007')
     <> (select last_audit_completed_at + interval '90 days'
         from public.users
         where id = '00000000-0000-0000-0000-000000000007') then
    raise exception 'next audit date must be 90 days after the last completion';
  end if;
end;
$$;

insert into public.sessions (id, user_id, is_pricing_audit, processing_status, audit_intake)
values
  (
    '10000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    true,
    'complete',
    '{"mrr":"1000","customer_count":"10"}'::jsonb
  ),
  (
    '10000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000001',
    true,
    'complete',
    '{}'::jsonb
  ),
  (
    '10000000-0000-0000-0000-000000000003',
    '00000000-0000-0000-0000-000000000002',
    true,
    'complete',
    '{}'::jsonb
  );

insert into public.pricing_audits (
  user_id,
  session_id,
  completed_at,
  is_welcome_audit,
  verdict_action,
  verdict_number,
  verdict_deadline,
  verdict_reasoning,
  baseline
) values (
  '00000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  now(),
  true,
  'raise',
  '$149/month',
  current_date + 30,
  'The value signal supports a controlled increase.',
  '{"value_anchor":"time saved"}'::jsonb
);

insert into public.pricing_audits (
  user_id,
  session_id,
  completed_at,
  is_welcome_audit,
  verdict_action,
  verdict_reasoning,
  baseline
) values (
  '00000000-0000-0000-0000-000000000002',
  '10000000-0000-0000-0000-000000000003',
  now(),
  true,
  'hold',
  'The current pricing still matches the evidence.',
  '{}'::jsonb
);

do $$
begin
  begin
    delete from public.sessions
    where id = '10000000-0000-0000-0000-000000000001';
    raise exception 'session with audit history was deleted';
  exception
    when foreign_key_violation then null;
  end;

  begin
    insert into public.pricing_audits (
      user_id, session_id, completed_at, is_welcome_audit,
      verdict_action, verdict_reasoning, baseline
    ) values (
      '00000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000001',
      now(), false, 'hold', 'Duplicate must fail.', '{}'::jsonb
    );
    raise exception 'duplicate audit completion was accepted';
  exception
    when unique_violation then null;
  end;

  begin
    insert into public.pricing_audits (
      user_id, session_id, completed_at, is_welcome_audit,
      verdict_action, verdict_reasoning, baseline
    ) values (
      '00000000-0000-0000-0000-000000000002',
      '10000000-0000-0000-0000-000000000002',
      now(), false, 'hold', 'Mismatch must fail.', '{}'::jsonb
    );
    raise exception 'mismatched session owner was accepted';
  exception
    when foreign_key_violation then null;
  end;

  begin
    insert into public.pricing_audits (
      user_id, session_id, completed_at, is_welcome_audit,
      verdict_action, verdict_reasoning, baseline
    ) values (
      '00000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000002',
      now(), false, 'invalid', 'Invalid action must fail.', '{}'::jsonb
    );
    raise exception 'invalid verdict action was accepted';
  exception
    when check_violation then null;
  end;
end;
$$;

do $$
begin
  if has_table_privilege('anon', 'public.pricing_audits', 'SELECT') then
    raise exception 'anon must not read pricing_audits';
  end if;
  if not has_table_privilege('authenticated', 'public.pricing_audits', 'SELECT') then
    raise exception 'authenticated must have SELECT on pricing_audits';
  end if;
  if has_table_privilege('authenticated', 'public.pricing_audits', 'INSERT')
     or has_table_privilege('authenticated', 'public.pricing_audits', 'UPDATE')
     or has_table_privilege('authenticated', 'public.pricing_audits', 'DELETE') then
    raise exception 'authenticated must not write pricing_audits';
  end if;
  if not has_table_privilege('service_role', 'public.pricing_audits', 'INSERT,SELECT,UPDATE,DELETE') then
    raise exception 'service_role must manage pricing_audits';
  end if;
  if has_function_privilege('anon', 'public.can_request_pricing_audit(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.next_pricing_audit_date(uuid)', 'EXECUTE') then
    raise exception 'anon must not execute pricing-audit compatibility functions';
  end if;
  if not has_function_privilege('authenticated', 'public.can_request_pricing_audit(uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.next_pricing_audit_date(uuid)', 'EXECUTE') then
    raise exception 'authenticated must execute pricing-audit compatibility functions';
  end if;
  if exists (
    select 1
    from pg_proc
    where oid in (
      'public.can_request_pricing_audit(uuid)'::regprocedure,
      'public.next_pricing_audit_date(uuid)'::regprocedure
    )
      and prosecdef
  ) then
    raise exception 'pricing-audit compatibility functions must use security invoker';
  end if;
end;
$$;

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);

do $$
declare
  visible_count integer;
begin
  select count(*) into visible_count from public.pricing_audits;
  if visible_count <> 1 then
    raise exception 'authenticated owner expected 1 visible audit, got %', visible_count;
  end if;

  update public.users
  set last_audit_completed_at = now(), welcome_audit_used = true
  where id = '00000000-0000-0000-0000-000000000001';
  get diagnostics visible_count = row_count;
  if visible_count <> 0 then
    raise exception 'authenticated user changed backend-owned audit state';
  end if;

  if public.can_request_pricing_audit('00000000-0000-0000-0000-000000000001') is not true then
    raise exception 'authenticated user cannot read own eligibility';
  end if;
  if public.can_request_pricing_audit('00000000-0000-0000-0000-000000000008') is not false then
    raise exception 'authenticated user can inspect another user eligibility';
  end if;
end;
$$;

reset role;

delete from public.users
where id = '00000000-0000-0000-0000-000000000002';

do $$
begin
  if exists (
    select 1 from public.pricing_audits
    where user_id = '00000000-0000-0000-0000-000000000002'
  ) then
    raise exception 'GDPR user deletion did not remove audit history';
  end if;
end;
$$;
