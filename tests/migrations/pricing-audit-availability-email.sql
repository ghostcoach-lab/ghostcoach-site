\ir pricing-audit-completion.sql

-- The production profile already has this field; the completion fixture only models fields used
-- by the earlier migrations.
alter table public.profiles add column firstname text;

\ir ../../supabase/migrations/20260930131654_pricing_audit_availability_email.sql

insert into auth.users (id) values
  ('00000000-0000-0000-0000-00000000000d'),
  ('00000000-0000-0000-0000-00000000000e'),
  ('00000000-0000-0000-0000-00000000000f'),
  ('00000000-0000-0000-0000-000000000010'),
  ('00000000-0000-0000-0000-000000000011'),
  ('00000000-0000-0000-0000-000000000012'),
  ('00000000-0000-0000-0000-000000000013');

insert into public.users (id, email, plan, status, trial_end) values
  ('00000000-0000-0000-0000-00000000000d', 'welcome@example.test', 'operator', 'active', null),
  ('00000000-0000-0000-0000-00000000000e', 'trial@example.test', 'operator', 'trialing', '2026-10-02T00:00:00Z'),
  ('00000000-0000-0000-0000-00000000000f', 'lifetime@example.test', 'lifetime', 'active', null),
  ('00000000-0000-0000-0000-000000000010', 'builder@example.test', 'builder', 'active', null),
  ('00000000-0000-0000-0000-000000000011', 'expired@example.test', 'operator', 'trialing', '2026-09-29T00:00:00Z'),
  ('00000000-0000-0000-0000-000000000012', 'returning@example.test', 'operator', 'active', null),
  ('00000000-0000-0000-0000-000000000013', 'gated@example.test', 'operator', 'active', null);

insert into public.profiles (user_id, firstname) values
  ('00000000-0000-0000-0000-00000000000d', 'Welcome'),
  ('00000000-0000-0000-0000-00000000000e', 'Trial'),
  ('00000000-0000-0000-0000-00000000000f', null),
  ('00000000-0000-0000-0000-000000000010', 'Builder'),
  ('00000000-0000-0000-0000-000000000011', 'Expired'),
  ('00000000-0000-0000-0000-000000000012', 'Returning'),
  ('00000000-0000-0000-0000-000000000013', 'Gated');

insert into public.sessions (id, user_id, transcript, processing_status, is_pricing_audit) values
  ('20000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000012', 'done', 'complete', true),
  ('20000000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-000000000013', 'done', 'complete', true);
insert into public.pricing_audits
  (id, user_id, session_id, completed_at, is_welcome_audit, verdict_action, verdict_number,
   verdict_deadline, verdict_reasoning, baseline)
values
  ('30000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000012',
   '20000000-0000-0000-0000-000000000012', '2026-07-01T06:00:00Z', true, 'hold', null,
   '2026-08-01', 'Hold.', '{}'::jsonb),
  ('30000000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-000000000013',
   '20000000-0000-0000-0000-000000000013', '2026-08-01T06:00:00Z', true, 'hold', null,
   '2026-09-01', 'Hold.', '{}'::jsonb);
update public.users set welcome_audit_used = true, last_audit_completed_at = '2026-07-01T06:00:00Z'
where id = '00000000-0000-0000-0000-000000000012';
update public.users set welcome_audit_used = true, last_audit_completed_at = '2026-08-01T06:00:00Z'
where id = '00000000-0000-0000-0000-000000000013';

do $$
declare
  ids uuid[];
  row_count integer;
begin
  select array_agg(user_id order by user_id), count(*) into ids, row_count
  from public.pricing_audit_availability_candidates('2026-09-30T07:00:00+02:00')
  where user_id in (
    '00000000-0000-0000-0000-00000000000d', '00000000-0000-0000-0000-00000000000e',
    '00000000-0000-0000-0000-00000000000f', '00000000-0000-0000-0000-000000000010',
    '00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000012',
    '00000000-0000-0000-0000-000000000013'
  );
  if row_count <> 4 or ids <> array[
    '00000000-0000-0000-0000-00000000000d'::uuid,
    '00000000-0000-0000-0000-00000000000e'::uuid,
    '00000000-0000-0000-0000-00000000000f'::uuid,
    '00000000-0000-0000-0000-000000000012'::uuid
  ] then
    raise exception 'unexpected S13 audience: %', ids;
  end if;
  if (select first_name from public.pricing_audit_availability_candidates('2026-09-30T05:00:00Z')
      where user_id = '00000000-0000-0000-0000-00000000000f') <> '' then
    raise exception 'a missing first name must become an empty string';
  end if;
  if (select audit_id from public.pricing_audit_availability_candidates('2026-09-30T05:00:00Z')
      where user_id = '00000000-0000-0000-0000-000000000012')
      <> '30000000-0000-0000-0000-000000000012' then
    raise exception 'returning opportunity is not keyed by its preceding audit';
  end if;
end;
$$;

do $$
begin
  if (select count(*) from public.pricing_audit_availability_candidates(
      '2026-09-30T05:00:00Z', '00000000-0000-0000-0000-00000000000e')) <> 1
     or exists (select 1 from public.pricing_audit_availability_candidates(
      '2026-09-30T05:00:00Z', '00000000-0000-0000-0000-000000000010')) then
    raise exception 'the QA-only candidate scope is not exact';
  end if;
end;
$$;

do $$
begin
  if not public.record_pricing_audit_availability_email(
    '00000000-0000-0000-0000-00000000000d', null, '2026-09-30T05:01:00Z', 'resend-welcome') then
    raise exception 'welcome send was not recorded';
  end if;
  if not public.record_pricing_audit_availability_email(
    '00000000-0000-0000-0000-000000000012', '30000000-0000-0000-0000-000000000012',
    '2026-09-30T05:01:00Z', 'resend-returning') then
    raise exception 'returning send was not recorded';
  end if;
  if public.record_pricing_audit_availability_email(
    '00000000-0000-0000-0000-00000000000d', null, '2026-09-30T05:02:00Z', 'duplicate') then
    raise exception 'duplicate welcome send was recorded';
  end if;
  if (select count(*) from public.pricing_audit_availability_emails) <> 2 then
    raise exception 'delivery ledger count is wrong';
  end if;
  if exists (select 1 from public.pricing_audit_availability_candidates('2026-10-01T05:00:00Z')
    where user_id in ('00000000-0000-0000-0000-00000000000d', '00000000-0000-0000-0000-000000000012')) then
    raise exception 'a recorded opportunity was selected again';
  end if;
  if not exists (select 1 from public.pricing_audit_availability_candidates('2026-10-01T05:00:00Z')
    where user_id = '00000000-0000-0000-0000-00000000000e') then
    raise exception 'an unrecorded failed send was not retried the next day';
  end if;
end;
$$;

do $$
begin
  if has_table_privilege('authenticated', 'public.pricing_audit_availability_emails', 'SELECT')
     or has_function_privilege('authenticated', 'public.pricing_audit_availability_candidates(timestamptz,uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.record_pricing_audit_availability_email(uuid,uuid,timestamptz,text)', 'EXECUTE') then
    raise exception 'S13 delivery state leaked to authenticated customers';
  end if;
  if not has_table_privilege('service_role', 'public.pricing_audit_availability_emails', 'INSERT,SELECT,UPDATE,DELETE')
     or not has_function_privilege('service_role', 'public.pricing_audit_availability_candidates(timestamptz,uuid)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.record_pricing_audit_availability_email(uuid,uuid,timestamptz,text)', 'EXECUTE') then
    raise exception 'service role cannot run S13';
  end if;
end;
$$;
