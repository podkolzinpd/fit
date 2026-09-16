-- Release only the failed attempt's lease; a newer attempt and cached results
-- must remain untouched. This RPC is never exposed to browser roles.
create or replace function public.release_assistant_program_generation_job(
  p_id uuid, p_owner_id uuid, p_client_id uuid, p_lease_id uuid
) returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update private.assistant_program_generations
    set lease_until = now()
    where id = p_id and owner_id = p_owner_id and client_id = p_client_id
      and lease_id = p_lease_id and result is null;
  return found;
end;
$$;
revoke all on function public.release_assistant_program_generation_job(uuid,uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.release_assistant_program_generation_job(uuid,uuid,uuid,uuid) to service_role;
