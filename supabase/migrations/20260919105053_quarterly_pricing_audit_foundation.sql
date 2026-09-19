begin;

alter table public.users
  add column last_audit_completed_at timestamptz,
  add column welcome_audit_used boolean not null default false,
  add constraint users_welcome_audit_completion_check
    check (not welcome_audit_used or last_audit_completed_at is not null);

comment on column public.users.last_audit_completed_at is
  'Completion time of the most recent pricing audit verdict. Abandoned audits do not update this value.';

comment on column public.users.welcome_audit_used is
  'True only after the customer completes the one-time welcome pricing audit.';

alter table public.sessions
  add column audit_intake jsonb,
  add constraint sessions_audit_intake_is_object
    check (audit_intake is null or jsonb_typeof(audit_intake) = 'object'),
  add constraint sessions_user_id_id_key unique (user_id, id);

comment on column public.sessions.audit_intake is
  'Pricing-audit intake captured for an audit session. Null for normal coaching sessions.';

do $$
begin
  if exists (
    select 1
    from public.profiles
    where pricing_audit_last_date is not null
  ) then
    raise exception using
      errcode = 'check_violation',
      message = 'Cannot remove profiles.pricing_audit_last_date while populated values exist',
      hint = 'Backfill users.last_audit_completed_at and users.welcome_audit_used before rerunning this migration.';
  end if;
end;
$$;

create or replace function public.can_request_pricing_audit(p_user_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce((
    select
      (
        (u.plan = 'lifetime'::public.plan_type and u.status = 'active'::public.user_status)
        or
        (
          u.plan = 'operator'::public.plan_type
          and (
            u.status = 'active'::public.user_status
            or (
              u.status = 'trialing'::public.user_status
              and u.trial_end > now()
            )
          )
        )
      )
      and (
        not u.welcome_audit_used
        or u.last_audit_completed_at + interval '90 days' <= now()
      )
    from public.users as u
    where u.id = p_user_id
  ), false);
$$;

comment on function public.can_request_pricing_audit(uuid) is
  'Compatibility RPC backed by the new audit state. New clients should use the authenticated eligibility endpoint.';

create or replace function public.next_pricing_audit_date(p_user_id uuid)
returns timestamptz
language sql
stable
security invoker
set search_path = ''
as $$
  select case
    when not u.welcome_audit_used then now()
    else u.last_audit_completed_at + interval '90 days'
  end
  from public.users as u
  where u.id = p_user_id;
$$;

comment on function public.next_pricing_audit_date(uuid) is
  'Compatibility RPC backed by the new audit state. New clients should use the authenticated eligibility endpoint.';

alter table public.profiles
  drop column pricing_audit_last_date;

create table public.pricing_audits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  session_id uuid not null,
  completed_at timestamptz not null,
  is_welcome_audit boolean not null,
  verdict_action text not null,
  verdict_number text,
  verdict_deadline date,
  verdict_reasoning text not null,
  baseline jsonb not null,
  created_at timestamptz not null default now(),

  constraint pricing_audits_session_id_key unique (session_id),
  constraint pricing_audits_session_owner_fkey
    foreign key (user_id, session_id)
    references public.sessions(user_id, id),
  constraint pricing_audits_verdict_action_check
    check (verdict_action in ('raise', 'hold', 'restructure')),
  constraint pricing_audits_verdict_reasoning_not_blank
    check (btrim(verdict_reasoning) <> ''),
  constraint pricing_audits_baseline_is_object
    check (jsonb_typeof(baseline) = 'object')
);

comment on table public.pricing_audits is
  'Completed quarterly pricing-audit verdicts. A row exists only after verdict emission.';

comment on column public.pricing_audits.session_id is
  'Idempotency key for audit completion; one completed audit per session.';

create index pricing_audits_user_completed_idx
  on public.pricing_audits (user_id, completed_at desc);

alter table public.pricing_audits enable row level security;

create policy pricing_audits_select_own
on public.pricing_audits
for select
to authenticated
using ((select auth.uid()) = user_id);

revoke all on table public.pricing_audits from public, anon, authenticated;
grant select on table public.pricing_audits to authenticated;
grant all on table public.pricing_audits to service_role;

revoke execute on function public.can_request_pricing_audit(uuid) from public, anon;
revoke execute on function public.next_pricing_audit_date(uuid) from public, anon;
grant execute on function public.can_request_pricing_audit(uuid) to authenticated, service_role;
grant execute on function public.next_pricing_audit_date(uuid) to authenticated, service_role;

commit;
