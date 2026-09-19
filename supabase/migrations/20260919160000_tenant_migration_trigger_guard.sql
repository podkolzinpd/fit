-- Historical tenant restores insert goals and progress after their client row.
-- Product writes must advance the program source timestamp, while a trusted
-- migration restore must preserve the exact timestamp carried by the snapshot.
create or replace function private.touch_program_client_source()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_id uuid := coalesce(new.client_id, old.client_id);
begin
  if current_setting('fit.tenant_migration_restore', true) = 'on' then
    return coalesce(new, old);
  end if;

  update public.clients set updated_at = clock_timestamp() where id = target_id;
  return coalesce(new, old);
end;
$$;

revoke all on function private.touch_program_client_source() from public, anon, authenticated;
