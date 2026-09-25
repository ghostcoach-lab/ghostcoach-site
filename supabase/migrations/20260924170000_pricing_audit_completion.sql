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
  v_is_welcome boolean;
  v_audit_id uuid;
begin
  -- The row lock serialises Completions for one customer.
  select not u.welcome_audit_used
    into v_is_welcome
    from public.users as u
   where u.id = p_user_id
     for update;
  if not found then
    raise exception using errcode = 'no_data_found', message = 'pricing audit customer not found';
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
    p_user_id, p_session_id, v_completed_at, v_is_welcome,
    p_verdict_action, p_verdict_number, p_verdict_deadline, p_verdict_reasoning, p_baseline
  )
  returning id into v_audit_id;

  update public.users
     set last_audit_completed_at = v_completed_at,
         welcome_audit_used = true
   where id = p_user_id;

  return query select
    v_audit_id,
    'completed'::text,
    v_is_welcome,
    p_verdict_action,
    p_verdict_number,
    p_verdict_deadline,
    p_verdict_reasoning,
    public.pricing_audit_next_eligible_date(v_completed_at);
end;
$$;

comment on function public.complete_pricing_audit(uuid, uuid, text, jsonb, text, text, date, text, jsonb) is
  'Records a Completion in one transaction: the audit session, the pricing_audits row and the moved Cooldown. Service role only.';

revoke all on function public.complete_pricing_audit(uuid, uuid, text, jsonb, text, text, date, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.complete_pricing_audit(uuid, uuid, text, jsonb, text, text, date, text, jsonb)
  to service_role;

commit;
