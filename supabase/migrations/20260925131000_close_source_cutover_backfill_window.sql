-- Restore the strict gate immediately after the owner-run backfill and the
-- Schedule V2 allowlist migration. API sessions never receive this bypass.
create or replace function private.enforce_source_cutover_write_gate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  writes_allowed boolean;
begin
  select not gate.writes_paused
  into writes_allowed
  from private.source_cutover_write_gate gate
  where gate.singleton;

  if writes_allowed is distinct from true then
    raise exception 'source_product_writes_paused'
      using errcode = 'P0001';
  end if;

  return null;
end;
$$;

revoke all on function private.enforce_source_cutover_write_gate()
  from public, anon, authenticated, service_role;

update private.source_cutover_write_gate
set migration_owner_bypass_until = null
where singleton;
