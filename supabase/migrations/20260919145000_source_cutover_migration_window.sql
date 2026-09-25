-- Product writes stay paused during the retired-source deployment. A database
-- owner migration session receives a short-lived bypass so pending data
-- backfills can complete without making writes available to API sessions.
-- If a later migration fails, the bypass expires without operator action.
alter table private.source_cutover_write_gate
  add column migration_owner_bypass_until timestamptz;

update private.source_cutover_write_gate
set migration_owner_bypass_until = clock_timestamp() + interval '30 minutes'
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
