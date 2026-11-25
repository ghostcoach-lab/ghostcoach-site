-- Contract test for the account-deletion-by-email function. Self-contained: the newsletter and
-- contacts fixtures model only the columns the function touches (newsletter.email is citext in
-- production). Run on a fresh database: psql --set ON_ERROR_STOP=1 --file <this file>.
-- Roles are cluster-wide; other contract tests in the same container may have created them.
do $$
begin
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
exception
  when duplicate_object then null;
end;
$$;

-- Supabase grants EXECUTE on new functions to these roles by default; the migration revokes it.
alter default privileges in schema public
  grant execute on functions to anon, authenticated, service_role;

create extension if not exists citext;

create table public.newsletter (
  id uuid primary key default gen_random_uuid(),
  email citext not null,
  user_id uuid,
  subscribed_at timestamptz not null default now(),
  unsubscribed_at timestamptz
);

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  name text,
  email text,
  message text
);

\ir ../../supabase/migrations/20261012130000_gdpr_delete_by_email.sql

insert into public.newsletter (email, user_id) values
  ('Target@Example.test', null),
  ('target@example.test', null),
  ('a_b@example.test', null),
  ('aXb@example.test', null),
  ('other@example.test', null);

insert into public.contacts (name, email, message) values
  ('Target', ' TARGET@example.test ', 'hello'),
  ('Other', 'other@example.test', 'hello'),
  ('Lookalike', 'aXb@example.test', 'hello');

-- Deletes every row for the address, whatever the case or surrounding spaces, and returns counts.
do $$
declare
  result jsonb;
begin
  select public.gdpr_delete_by_email('  target@EXAMPLE.test ') into result;
  if result <> '{"newsletter": 2, "contacts": 1}'::jsonb then
    raise exception 'unexpected counts %', result;
  end if;
  if exists (select 1 from public.newsletter where lower(email) = 'target@example.test')
     or exists (select 1 from public.contacts where lower(btrim(email)) = 'target@example.test') then
    raise exception 'rows for the address are still there';
  end if;
  if (select count(*) from public.newsletter) <> 3 or (select count(*) from public.contacts) <> 2 then
    raise exception 'other people''s rows were touched';
  end if;
end;
$$;

-- An underscore is a literal character: a_b@ must not delete aXb@.
do $$
declare
  result jsonb;
begin
  select public.gdpr_delete_by_email('a_b@example.test') into result;
  if result <> '{"newsletter": 1, "contacts": 0}'::jsonb then
    raise exception 'unexpected counts for the underscore address: %', result;
  end if;
  if not exists (select 1 from public.newsletter where email = 'aXb@example.test')
     or not exists (select 1 from public.contacts where email = 'aXb@example.test') then
    raise exception 'a pattern character matched a different address';
  end if;
end;
$$;

-- An address with no rows is a normal answer, not an error.
do $$
begin
  if public.gdpr_delete_by_email('nobody@example.test') <> '{"newsletter": 0, "contacts": 0}'::jsonb then
    raise exception 'unknown address did not return zero counts';
  end if;
end;
$$;

-- Empty and missing addresses are refused, so a bad call never deletes by accident.
do $$
begin
  begin
    perform public.gdpr_delete_by_email(null);
    raise exception 'null email was accepted';
  exception when raise_exception then
    if sqlerrm <> 'email required' then raise; end if;
  end;
  begin
    perform public.gdpr_delete_by_email('   ');
    raise exception 'blank email was accepted';
  exception when raise_exception then
    if sqlerrm <> 'email required' then raise; end if;
  end;
end;
$$;

-- The function never resolves names through a caller-controlled search_path.
do $$
begin
  if not exists (
    select 1 from pg_proc
    where oid = 'public.gdpr_delete_by_email(text)'::regprocedure
      and prosecdef
      and 'search_path=""' = any (proconfig)
  ) then
    raise exception 'function is not security definer with an empty search_path';
  end if;
end;
$$;

-- Only the service role may run it.
set role anon;
do $$
begin
  perform public.gdpr_delete_by_email('other@example.test');
  raise exception 'anon ran the deletion';
exception when insufficient_privilege then null;
end;
$$;
reset role;

set role authenticated;
do $$
begin
  perform public.gdpr_delete_by_email('other@example.test');
  raise exception 'authenticated ran the deletion';
exception when insufficient_privilege then null;
end;
$$;
reset role;

set role service_role;
select public.gdpr_delete_by_email('other@example.test');
reset role;

-- The rollback line in the migration works.
begin;
drop function public.gdpr_delete_by_email(text);
rollback;
