-- Trainer invitations can create a membership without a relationship row.
-- Use the existing targeted removal contract and close both forms of access
-- atomically. The target ID selects the link; ownership comes from auth.uid().
create or replace function public.remove_client_trainer(p_client_id uuid, p_trainer_id uuid)
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
    raise exception 'client_role_required' using errcode = 'PT403';
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
  -- Legacy trainer-owned partitions still require a separate safe migration.
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
  -- Repeating a removal is successful: the selected trainer already has no
  -- membership or active relationship. Other trainers and client data remain.
end;
$$;

revoke all on function public.remove_client_trainer(uuid, uuid) from public, anon;
grant execute on function public.remove_client_trainer(uuid, uuid) to authenticated;
