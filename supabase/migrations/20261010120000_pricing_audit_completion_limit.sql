begin;

create table public.pricing_audit_completion_calls (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  session_id uuid not null,
  called_at timestamptz not null default now()
);

create index pricing_audit_completion_calls_user_idx
  on public.pricing_audit_completion_calls (user_id, called_at);
create index pricing_audit_completion_calls_session_idx
  on public.pricing_audit_completion_calls (session_id, called_at);
create index pricing_audit_completion_calls_called_at_idx
  on public.pricing_audit_completion_calls (called_at);

comment on table public.pricing_audit_completion_calls is
  'Counted pricing-audit-complete calls in the last 24 hours. session_id has no foreign key: the session row may not exist yet. Rows older than 24 hours are purged by pricing_audit_take_completion_call.';

alter table public.pricing_audit_completion_calls enable row level security;

revoke all on table public.pricing_audit_completion_calls from public, anon, authenticated;
grant all on table public.pricing_audit_completion_calls to service_role;

create function public.pricing_audit_take_completion_call(
  p_user_id uuid,
  p_session_id uuid,
  p_user_limit integer,
  p_session_limit integer
)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  window_start constant timestamptz := now() - interval '24 hours';
  user_count integer;
  session_count integer;
begin
  if p_user_id is null or p_session_id is null
     or p_user_limit is null or p_user_limit < 1
     or p_session_limit is null or p_session_limit < 1 then
    raise exception 'invalid completion limit arguments' using errcode = '22023';
  end if;

  -- Parallel calls for one customer queue here until the holder's transaction ends.
  perform pg_advisory_xact_lock(
    hashtextextended('pricing_audit_completion_call:' || p_user_id::text, 0)
  );

  -- Skip locked rows: another customer's transaction may be purging the same old records.
  delete from public.pricing_audit_completion_calls
  where id in (
    select id from public.pricing_audit_completion_calls
    where called_at <= window_start
    for update skip locked
  );

  select count(*) into user_count
  from public.pricing_audit_completion_calls
  where user_id = p_user_id and called_at > window_start;

  if user_count >= p_user_limit then
    return 'user';
  end if;

  select count(*) into session_count
  from public.pricing_audit_completion_calls
  where session_id = p_session_id and called_at > window_start;

  if session_count >= p_session_limit then
    return 'session';
  end if;

  insert into public.pricing_audit_completion_calls (user_id, session_id)
  values (p_user_id, p_session_id);
  return 'allowed';
end;
$$;

comment on function public.pricing_audit_take_completion_call(uuid, uuid, integer, integer) is
  'Atomic completion limiter: purges records older than 24 hours, then returns user, session or allowed (recording the call). Service role only.';

revoke all on function public.pricing_audit_take_completion_call(uuid, uuid, integer, integer)
  from public, anon, authenticated;
grant execute on function public.pricing_audit_take_completion_call(uuid, uuid, integer, integer)
  to service_role;

commit;
