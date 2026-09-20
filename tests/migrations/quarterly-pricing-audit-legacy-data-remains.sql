do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'pricing_audit_last_date'
  ) then
    raise exception 'failed migration removed the populated legacy column';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'users'
      and column_name in ('last_audit_completed_at', 'welcome_audit_used')
  ) then
    raise exception 'failed migration did not roll back new user columns';
  end if;

  if to_regclass('public.pricing_audits') is not null then
    raise exception 'failed migration did not roll back pricing_audits';
  end if;
end;
$$;
