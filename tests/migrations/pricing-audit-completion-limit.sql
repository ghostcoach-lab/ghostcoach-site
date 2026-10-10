-- Contract tests for the completion limit migration (#43).
\ir pricing-audit-completion.sql

\ir ../../supabase/migrations/20261010120000_pricing_audit_completion_limit.sql

insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-0000000000a2'),
  ('00000000-0000-0000-0000-0000000000a3'),
  ('00000000-0000-0000-0000-0000000000a4'),
  ('00000000-0000-0000-0000-0000000000a5');
insert into public.users (id, email, plan, status) values
  ('00000000-0000-0000-0000-0000000000a1', 'a1@example.test', 'operator', 'active'),
  ('00000000-0000-0000-0000-0000000000a2', 'a2@example.test', 'operator', 'active'),
  ('00000000-0000-0000-0000-0000000000a3', 'a3@example.test', 'operator', 'active'),
  ('00000000-0000-0000-0000-0000000000a4', 'a4@example.test', 'operator', 'active'),
  ('00000000-0000-0000-0000-0000000000a5', 'a5@example.test', 'operator', 'active');

-- Under, at and over the per-customer limit (3), the session limit being out of reach.
do $$
declare
  u constant uuid := '00000000-0000-0000-0000-0000000000a1';
  results text[] := '{}';
begin
  for i in 1..5 loop
    results := results || public.pricing_audit_take_completion_call(u, gen_random_uuid(), 3, 100);
  end loop;
  if results <> array['allowed', 'allowed', 'allowed', 'user', 'user'] then
    raise exception 'user limit sequence wrong: %', results;
  end if;
  if (select count(*) from public.pricing_audit_completion_calls where user_id = u) <> 3 then
    raise exception 'a refusal inserted a record';
  end if;
end;
$$;

-- Under, at and over the per-session limit (2).
do $$
declare
  u constant uuid := '00000000-0000-0000-0000-0000000000a2';
  s constant uuid := '10000000-0000-0000-0000-0000000000a2';
  results text[] := '{}';
begin
  for i in 1..4 loop
    results := results || public.pricing_audit_take_completion_call(u, s, 100, 2);
  end loop;
  if results <> array['allowed', 'allowed', 'session', 'session'] then
    raise exception 'session limit sequence wrong: %', results;
  end if;
  if (select count(*) from public.pricing_audit_completion_calls where session_id = s) <> 2 then
    raise exception 'a session refusal inserted a record';
  end if;
  -- Another customer's call on the same session id counts against the session too.
  if public.pricing_audit_take_completion_call('00000000-0000-0000-0000-0000000000a3', s, 100, 2) <> 'session' then
    raise exception 'session count must span customers';
  end if;
end;
$$;

-- Both exceeded reports the customer.
do $$
declare
  u constant uuid := '00000000-0000-0000-0000-0000000000a3';
  s constant uuid := '10000000-0000-0000-0000-0000000000a3';
begin
  perform public.pricing_audit_take_completion_call(u, s, 1, 1);
  if public.pricing_audit_take_completion_call(u, s, 1, 1) <> 'user' then
    raise exception 'both limits exceeded must return user';
  end if;
end;
$$;

-- Invalid arguments are rejected rather than silently allowed.
do $$
begin
  perform public.pricing_audit_take_completion_call(gen_random_uuid(), gen_random_uuid(), 0, 1);
  raise exception 'a zero limit was accepted';
exception when invalid_parameter_value then null;
end;
$$;

-- The window: older records are purged for every customer; exactly 24 hours old is outside.
-- One transaction, so now() is the same instant for the fixture and the function.
begin;
delete from public.pricing_audit_completion_calls;
insert into public.pricing_audit_completion_calls (user_id, session_id, called_at) values
  ('00000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000b1', now() - interval '24 hours'),
  ('00000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000b1', now() - interval '23 hours 59 minutes'),
  ('00000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-0000000000b2', now() - interval '30 hours');
do $$
begin
  -- Customer a1 has one record inside the window (the 24 h one has left it), limit 2.
  if public.pricing_audit_take_completion_call(
       '00000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000b1', 2, 100) <> 'allowed' then
    raise exception 'a record exactly 24 hours old still counted';
  end if;
  if public.pricing_audit_take_completion_call(
       '00000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000b1', 2, 100) <> 'user' then
    raise exception 'a record inside the window did not count';
  end if;
  if exists (select 1 from public.pricing_audit_completion_calls where called_at <= now() - interval '24 hours') then
    raise exception 'records 24 hours or older were not purged';
  end if;
  if exists (select 1 from public.pricing_audit_completion_calls where user_id = '00000000-0000-0000-0000-0000000000a2') then
    raise exception 'another customer''s old record was not purged';
  end if;
end;
$$;
rollback;

-- Privileges.
do $$
begin
  if has_table_privilege('anon', 'public.pricing_audit_completion_calls', 'SELECT,INSERT,UPDATE,DELETE')
     or has_table_privilege('authenticated', 'public.pricing_audit_completion_calls', 'SELECT,INSERT,UPDATE,DELETE')
     or has_function_privilege('anon', 'public.pricing_audit_take_completion_call(uuid,uuid,integer,integer)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.pricing_audit_take_completion_call(uuid,uuid,integer,integer)', 'EXECUTE') then
    raise exception 'limit state leaked to anon or authenticated';
  end if;
  if not has_table_privilege('service_role', 'public.pricing_audit_completion_calls', 'INSERT,SELECT,UPDATE,DELETE')
     or not has_function_privilege('service_role', 'public.pricing_audit_take_completion_call(uuid,uuid,integer,integer)', 'EXECUTE') then
    raise exception 'service role cannot use the limiter';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.pricing_audit_completion_calls'::regclass)
     or exists (select 1 from pg_policies where tablename = 'pricing_audit_completion_calls') then
    raise exception 'RLS must be on with no policies';
  end if;
end;
$$;

set role authenticated;
do $$
begin
  perform public.pricing_audit_take_completion_call(gen_random_uuid(), gen_random_uuid(), 1, 1);
  raise exception 'authenticated executed the limiter';
exception when insufficient_privilege then null;
end;
$$;
do $$
begin
  perform 1 from public.pricing_audit_completion_calls;
  raise exception 'authenticated read the limit table';
exception when insufficient_privilege then null;
end;
$$;
reset role;

-- Deleting a user removes their records.
do $$
declare
  u constant uuid := '00000000-0000-0000-0000-0000000000a4';
begin
  perform public.pricing_audit_take_completion_call(u, gen_random_uuid(), 5, 5);
  if not exists (select 1 from public.pricing_audit_completion_calls where user_id = u) then
    raise exception 'fixture: no record to delete';
  end if;
  delete from public.users where id = u;
  if exists (select 1 from public.pricing_audit_completion_calls where user_id = u) then
    raise exception 'deleting a user left limit records';
  end if;
end;
$$;

-- Parallel calls for one customer at the boundary admit exactly the remaining allowance.
-- Each dblink connection is its own transaction, so the advisory lock is what serialises them.
create extension dblink;
select public.pricing_audit_take_completion_call('00000000-0000-0000-0000-0000000000a5', gen_random_uuid(), 10, 100)
from generate_series(1, 6);

do $$
declare
  conn_string text := 'dbname=' || current_database() || ' user=postgres';
  allowed integer := 0;
  refused integer := 0;
  answer text;
begin
  for i in 1..12 loop
    perform dblink_connect('c' || i, conn_string);
    perform dblink_send_query('c' || i,
      'select public.pricing_audit_take_completion_call(''00000000-0000-0000-0000-0000000000a5'', gen_random_uuid(), 10, 100)');
  end loop;
  for i in 1..12 loop
    select r into answer from dblink_get_result('c' || i) as t(r text);
    if answer = 'allowed' then allowed := allowed + 1;
    elsif answer = 'user' then refused := refused + 1;
    else raise exception 'unexpected answer %', answer;
    end if;
    perform dblink_disconnect('c' || i);
  end loop;
  if allowed <> 4 or refused <> 8 then
    raise exception 'parallel boundary admitted % and refused % (want 4 and 8)', allowed, refused;
  end if;
  if (select count(*) from public.pricing_audit_completion_calls
      where user_id = '00000000-0000-0000-0000-0000000000a5') <> 10 then
    raise exception 'parallel calls overshot the limit';
  end if;
end;
$$;
