-- A pending owner-run workout backfill follows this migration. Keep product
-- writes paused, but let the PostgreSQL migration owner pass the statement
-- triggers for a short, self-expiring window.
update private.source_cutover_write_gate
set migration_owner_bypass_until = clock_timestamp() + interval '10 minutes'
where singleton;

create or replace function private.enforce_source_cutover_write_gate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  writes_allowed boolean;
  migration_owner_bypass_active boolean;
begin
  select
    not gate.writes_paused,
    session_user = 'postgres'
      and gate.migration_owner_bypass_until > clock_timestamp()
  into writes_allowed, migration_owner_bypass_active
  from private.source_cutover_write_gate gate
  where gate.singleton;

  if migration_owner_bypass_active then
    return null;
  end if;

  if writes_allowed is distinct from true then
    raise exception 'source_product_writes_paused'
      using errcode = 'P0001';
  end if;

  return null;
end;
$$;

revoke all on function private.enforce_source_cutover_write_gate()
  from public, anon, authenticated, service_role;
