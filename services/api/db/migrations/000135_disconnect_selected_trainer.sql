-- Up Migration

-- Preserve the previous writer for an exact rollback, but do not expose a
-- membership-only path that could leave an explicit active relationship alive.
alter function public.remove_client_trainer(uuid, uuid)
  rename to remove_client_trainer_before_disconnect;
revoke all on function public.remove_client_trainer_before_disconnect(uuid, uuid)
  from public, fit_api;

create function public.remove_client_trainer(p_client_id uuid, p_trainer_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  client_row public.clients%rowtype;
begin
  if actor_id is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;
  if not exists (
    select 1 from public.profiles
    where id = actor_id and account_role = 'client'
  ) then
    raise exception 'membership_not_allowed' using errcode = 'PT403';
  end if;

  select * into client_row
  from public.clients
  where id = p_client_id and auth_user_id = actor_id
    and archived_at is null and merged_into_client_id is null
  for update;
  if not found then
    raise exception 'membership_not_allowed' using errcode = 'PT403';
  end if;
  if p_trainer_id is null then
    raise exception 'membership_not_found' using errcode = 'PT404';
  end if;
  -- Moving a legacy trainer-owned partition requires a separate safe migration.
  -- An ordinary disconnect must never reparent or delete the client's history.
  if client_row.trainer_id = p_trainer_id then
    raise exception 'root_trainer_cannot_be_removed' using errcode = 'PT422';
  end if;

  update public.client_trainer_relationships
  set status = 'disconnected', disconnected_at = now(),
      disconnected_by = actor_id, updated_at = now()
  where client_id = client_row.id and trainer_id = p_trainer_id
    and status = 'active';

  delete from public.client_trainers
  where client_id = client_row.id and trainer_id = p_trainer_id;
  -- Repeat is successful: only this trainer's active access is removed.
end;
$$;

revoke all on function public.remove_client_trainer(uuid, uuid) from public;
grant execute on function public.remove_client_trainer(uuid, uuid) to fit_api;

-- Down Migration

drop function public.remove_client_trainer(uuid, uuid);
alter function public.remove_client_trainer_before_disconnect(uuid, uuid)
  rename to remove_client_trainer;
grant execute on function public.remove_client_trainer(uuid, uuid) to fit_api;
