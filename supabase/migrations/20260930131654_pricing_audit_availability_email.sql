begin;

create table public.pricing_audit_availability_emails (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  audit_id uuid references public.pricing_audits(id) on delete cascade,
  sent_at timestamptz not null,
  provider_message_id text,
  created_at timestamptz not null default now(),
  constraint pricing_audit_availability_emails_opportunity_key
    unique nulls not distinct (user_id, audit_id),
  constraint pricing_audit_availability_emails_provider_id_not_blank
    check (provider_message_id is null or btrim(provider_message_id) <> '')
);

create index pricing_audit_availability_emails_audit_idx
  on public.pricing_audit_availability_emails (audit_id)
  where audit_id is not null;

comment on table public.pricing_audit_availability_emails is
  'Accepted S13 sends, one per Pricing audit opportunity. A null audit_id is the Welcome audit; '
  'a later opportunity is keyed by the preceding completed Pricing audit.';

alter table public.pricing_audit_availability_emails enable row level security;

revoke all on table public.pricing_audit_availability_emails from public, anon, authenticated;
grant all on table public.pricing_audit_availability_emails to service_role;

create function public.pricing_audit_availability_candidates(
  p_now timestamptz,
  p_only_user_id uuid default null
)
returns table (
  user_id uuid,
  email text,
  first_name text,
  audit_id uuid
)
language sql
stable
set search_path = ''
as $$
  select u.id, u.email, coalesce(left(p.firstname, 100), ''), opportunity.id
  from public.users as u
  left join public.profiles as p on p.user_id = u.id
  left join lateral (
    select a.id
    from public.pricing_audits as a
    where a.user_id = u.id
      and a.completed_at = u.last_audit_completed_at
    order by a.id
    limit 1
  ) as opportunity on true
  cross join lateral public.pricing_audit_decide_eligibility(
    u.plan, u.status, u.trial_end, u.welcome_audit_used, u.last_audit_completed_at, p_now
  ) as decision
  where p_now is not null
    and (p_only_user_id is null or u.id = p_only_user_id)
    and decision.state = 'eligible'
    and (
      (decision.is_welcome_audit and opportunity.id is null)
      or (not decision.is_welcome_audit and opportunity.id is not null)
    )
    and not exists (
      select 1
      from public.pricing_audit_availability_emails as sent
      where sent.user_id = u.id
        and sent.audit_id is not distinct from opportunity.id
    )
  order by u.id;
$$;

comment on function public.pricing_audit_availability_candidates(timestamptz, uuid) is
  'Lists currently available Pricing audit opportunities without an accepted S13 send. '
  'Uses the shared Entitlement and Cooldown decision. Service role only.';

create function public.record_pricing_audit_availability_email(
  p_user_id uuid,
  p_audit_id uuid,
  p_sent_at timestamptz,
  p_provider_message_id text
)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  inserted_id uuid;
begin
  if p_user_id is null or p_sent_at is null then
    raise exception using errcode = '22004', message = 'user_id and sent_at are required';
  end if;
  if not exists (select 1 from public.users as u where u.id = p_user_id) then
    raise exception using errcode = '23503', message = 'unknown S13 customer';
  end if;
  if p_audit_id is not null and not exists (
    select 1 from public.pricing_audits as a where a.id = p_audit_id and a.user_id = p_user_id
  ) then
    raise exception using errcode = '23514', message = 'S13 audit opportunity does not belong to customer';
  end if;

  insert into public.pricing_audit_availability_emails
    (user_id, audit_id, sent_at, provider_message_id)
  values
    (p_user_id, p_audit_id, p_sent_at, nullif(btrim(p_provider_message_id), ''))
  on conflict on constraint pricing_audit_availability_emails_opportunity_key do nothing
  returning id into inserted_id;

  return inserted_id is not null;
end;
$$;

comment on function public.record_pricing_audit_availability_email(uuid, uuid, timestamptz, text) is
  'Records one Resend-accepted S13 email. Duplicate opportunities return false. Service role only.';

revoke all on function public.pricing_audit_availability_candidates(timestamptz, uuid)
  from public, anon, authenticated;
grant execute on function public.pricing_audit_availability_candidates(timestamptz, uuid)
  to service_role;

revoke all on function public.record_pricing_audit_availability_email(uuid, uuid, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.record_pricing_audit_availability_email(uuid, uuid, timestamptz, text)
  to service_role;

commit;
