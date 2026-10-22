begin;

-- Account deletion removes the auth user, which cascades to every row linked by user_id. Two tables
-- also hold rows by email only (visitors without an account, newsletter signups), so the delete
-- flow calls this function once with the verified email. Exact, case-insensitive match: no
-- pattern characters, so one address can never match another.
create function public.gdpr_delete_by_email(p_email text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalised constant text := lower(btrim(p_email));
  newsletter_deleted integer;
  contacts_deleted integer;
begin
  if normalised is null or normalised = '' then
    raise exception 'email required';
  end if;

  delete from public.newsletter where lower(btrim(email)) = normalised;
  get diagnostics newsletter_deleted = row_count;

  delete from public.contacts where lower(btrim(email)) = normalised;
  get diagnostics contacts_deleted = row_count;

  return jsonb_build_object('newsletter', newsletter_deleted, 'contacts', contacts_deleted);
end;
$$;

comment on function public.gdpr_delete_by_email(text) is
  'Deletes newsletter and contacts rows for one email (trimmed, case-insensitive, exact). Returns counts only, never addresses. Service role only. Called by the account-deletion flow.';

revoke all on function public.gdpr_delete_by_email(text) from public, anon, authenticated;
grant execute on function public.gdpr_delete_by_email(text) to service_role;

commit;

-- Rollback (nothing else depends on the function):
--   begin;
--   drop function public.gdpr_delete_by_email(text);
--   delete from supabase_migrations.schema_migrations where version = '20261012130000';
--   commit;
