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

-- Mirrors the live sessions columns and numbering trigger.
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

create policy sessions_insert_own
on public.sessions for insert to authenticated
with check ((select auth.uid()) = user_id);

grant usage on schema public to anon, authenticated, service_role;
grant all on public.users, public.profiles, public.sessions
  to anon, authenticated, service_role;

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
