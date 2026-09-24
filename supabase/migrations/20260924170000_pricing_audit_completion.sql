begin;

alter table public.pricing_audits
  add column recap_sent_at timestamptz;

comment on column public.pricing_audits.recap_sent_at is
  'When the recap workflow accepted this audit''s recap email. Null until then; a failed recap never rolls back the Completion.';

create function public.pricing_audit_next_eligible_date(p_completed_at timestamptz)
returns date
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select (p_completed_at at time zone 'UTC')::date + 90;
$$;

comment on function public.pricing_audit_next_eligible_date(timestamptz) is
  'The next eligible date after a Completion: the UTC calendar date 90 days later. Mirrors the shared TypeScript eligibility decision.';

-- The eligibility rule, the same as decidePricingAuditEligibility in
-- supabase/functions/_shared/pricing-audit-eligibility.ts. A shared table of cases tests both.
create function public.pricing_audit_decide_eligibility(
  p_plan public.plan_type,
  p_status public.user_status,
  p_trial_end timestamptz,
  p_welcome_audit_used boolean,
  p_last_audit_completed_at timestamptz,
  p_now timestamptz
)
returns table (state text, is_welcome_audit boolean, next_eligible_date date)
language plpgsql
immutable
set search_path = ''
as $$
begin
  if not (
    (p_status = 'active' and p_plan in ('operator', 'lifetime'))
    or (p_plan = 'operator' and p_status = 'trialing' and p_trial_end is not null and p_trial_end > p_now)
  ) then
    return query select 'not_entitled'::text, null::boolean, null::date;
    return;
  end if;
  if not p_welcome_audit_used then
    return query select 'eligible'::text, true, null::date;
    return;
  end if;
  if p_last_audit_completed_at is null then
    raise exception 'Completed audit timestamp is missing';
  end if;
  -- 90 days of UTC time, so the session time zone and DST never shift the boundary.
  if p_now < ((p_last_audit_completed_at at time zone 'UTC') + interval '90 days') at time zone 'UTC' then
    return query select 'gated'::text, null::boolean, public.pricing_audit_next_eligible_date(p_last_audit_completed_at);
    return;
  end if;
  return query select 'eligible'::text, false, null::date;
end;
$$;

comment on function public.pricing_audit_decide_eligibility(public.plan_type, public.user_status, timestamptz, boolean, timestamptz, timestamptz) is
  'Whether a customer can start a Pricing audit: eligible (with the Welcome audit flag), gated (with the next eligible date) or not_entitled.';

-- Where a session ID stands before a Completion: new, already_completed (with the saved audit)
-- or session_conflict (another customer's session, or a coaching session).
create function public.pricing_audit_session_state(p_user_id uuid, p_session_id uuid)
returns table (
  audit_id uuid,
  status text,
  is_welcome_audit boolean,
  verdict_action text,
  verdict_number text,
  verdict_deadline date,
  verdict_reasoning text,
  next_eligible_date date
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  return query
  select a.id, 'already_completed'::text, a.is_welcome_audit, a.verdict_action, a.verdict_number,
         a.verdict_deadline, a.verdict_reasoning, public.pricing_audit_next_eligible_date(a.completed_at)
    from public.pricing_audits as a
   where a.user_id = p_user_id and a.session_id = p_session_id;
  if found then
    return;
  end if;
  if exists (select 1 from public.sessions as s where s.id = p_session_id) then
    return query select null::uuid, 'session_conflict'::text, null::boolean, null::text, null::text,
                        null::date, null::text, null::date;
    return;
  end if;
  return query select null::uuid, 'new'::text, null::boolean, null::text, null::text,
                      null::date, null::text, null::date;
end;
$$;

comment on function public.pricing_audit_session_state(uuid, uuid) is
  'Idempotency lookup for a Completion: new, already_completed or session_conflict. Service role only.';

create function public.complete_pricing_audit(
  p_user_id uuid,
  p_session_id uuid,
  p_transcript text,
  p_audit_intake jsonb,
  p_verdict_action text,
  p_verdict_number text,
  p_verdict_deadline date,
  p_verdict_reasoning text,
  p_baseline jsonb
)
returns table (
  audit_id uuid,
  status text,
  is_welcome_audit boolean,
  verdict_action text,
  verdict_number text,
  verdict_deadline date,
  verdict_reasoning text,
  next_eligible_date date
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_completed_at timestamptz := now();
  v_customer public.users%rowtype;
  v_decision record;
  v_audit_id uuid;
begin
  -- The row lock serialises Completions for one customer, so a concurrent duplicate waits here
  -- and then finds the saved audit.
  select * into v_customer from public.users as u where u.id = p_user_id for update;
  if not found then
    raise exception using errcode = 'no_data_found', message = 'pricing audit customer not found';
  end if;

  -- A replay, another customer's session or a coaching session: nothing is written.
  select * into v_decision from public.pricing_audit_session_state(p_user_id, p_session_id);
  if v_decision.status <> 'new' then
    return query select v_decision.audit_id, v_decision.status, v_decision.is_welcome_audit,
                        v_decision.verdict_action, v_decision.verdict_number, v_decision.verdict_deadline,
                        v_decision.verdict_reasoning, v_decision.next_eligible_date;
    return;
  end if;

  -- The authoritative Entitlement and Cooldown check.
  select * into v_decision from public.pricing_audit_decide_eligibility(
    v_customer.plan, v_customer.status, v_customer.trial_end,
    v_customer.welcome_audit_used, v_customer.last_audit_completed_at, v_completed_at
  );
  if v_decision.state <> 'eligible' then
    return query select null::uuid,
                        case v_decision.state when 'gated' then 'gated' else 'plan_lapsed' end,
                        null::boolean, null::text, null::text, null::date, null::text,
                        v_decision.next_eligible_date;
    return;
  end if;

  -- The caller checked the deadline against its own clock; re-check it against this
  -- Completion's UTC date, which can differ around midnight.
  if p_verdict_deadline is null
     or p_verdict_deadline <= (v_completed_at at time zone 'UTC')::date
     or p_verdict_deadline > ((v_completed_at at time zone 'UTC')::date + interval '1 year')::date then
    raise exception using
      errcode = 'invalid_parameter_value',
      message = 'verdict deadline must be after the completion date and at most one year later';
  end if;

  -- session_number comes from the existing numbering trigger. Summary stays null and goal
  -- progress is never touched, so the audit stays out of normal coaching context.
  insert into public.sessions (id, user_id, is_pricing_audit, processing_status, transcript, audit_intake, summary)
  values (p_session_id, p_user_id, true, 'complete', p_transcript, p_audit_intake, null);

  insert into public.pricing_audits (
    user_id, session_id, completed_at, is_welcome_audit,
    verdict_action, verdict_number, verdict_deadline, verdict_reasoning, baseline
  ) values (
    p_user_id, p_session_id, v_completed_at, v_decision.is_welcome_audit,
    p_verdict_action, p_verdict_number, p_verdict_deadline, p_verdict_reasoning, p_baseline
  )
  returning id into v_audit_id;

  update public.users as u
     set last_audit_completed_at = v_completed_at,
         welcome_audit_used = true
   where u.id = p_user_id;

  return query select
    v_audit_id,
    'completed'::text,
    v_decision.is_welcome_audit,
    p_verdict_action,
    p_verdict_number,
    p_verdict_deadline,
    p_verdict_reasoning,
    public.pricing_audit_next_eligible_date(v_completed_at);
end;
$$;

comment on function public.complete_pricing_audit(uuid, uuid, text, jsonb, text, text, date, text, jsonb) is
  'Records a Completion in one transaction: the audit session, the pricing_audits row and the moved Cooldown. '
  'Returns completed, already_completed, session_conflict, plan_lapsed or gated; only completed writes. Service role only.';

revoke all on function public.pricing_audit_session_state(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.pricing_audit_session_state(uuid, uuid)
  to service_role;

revoke all on function public.complete_pricing_audit(uuid, uuid, text, jsonb, text, text, date, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.complete_pricing_audit(uuid, uuid, text, jsonb, text, text, date, text, jsonb)
  to service_role;

commit;
