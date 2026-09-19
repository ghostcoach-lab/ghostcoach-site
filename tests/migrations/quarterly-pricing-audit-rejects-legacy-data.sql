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

grant all on public.users, public.profiles, public.sessions to anon, authenticated, service_role;

create function public.can_request_pricing_audit(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select true;
$$;

create function public.next_pricing_audit_date(p_user_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select now();
$$;

insert into auth.users (id)
values ('00000000-0000-0000-0000-000000000001');

insert into public.users (id, plan, status)
values ('00000000-0000-0000-0000-000000000001', 'operator', 'active');

insert into public.profiles (user_id, pricing_audit_last_date)
values (
  '00000000-0000-0000-0000-000000000001',
  now() - interval '30 days'
);
