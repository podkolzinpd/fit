-- A successful disconnect must remove both the relationship and the legacy
-- membership that still grants access and feeds list_client_trainers.
-- Repair already disconnected production rows first so the profile becomes
-- correct without asking the client to repeat the action.
delete from public.client_trainers membership
where exists (
  select 1
  from public.client_trainer_relationships relationship
  where relationship.client_id = membership.client_id
    and relationship.trainer_id = membership.trainer_id
    and relationship.status = 'disconnected'
)
and not exists (
  select 1
  from public.client_trainer_relationships relationship
  where relationship.client_id = membership.client_id
    and relationship.trainer_id = membership.trainer_id
    and relationship.status = 'active'
);

create or replace function public.disconnect_client_trainer(p_client_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_role text;
  client_row public.clients%rowtype;
  relationship_row public.client_trainer_relationships%rowtype;
  disconnected_trainer_id uuid;
  removed_memberships integer := 0;
begin
  if actor_id is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;

  select account_role into actor_role
  from public.profiles
  where id = actor_id;

  if actor_role is distinct from 'client' then
    raise exception 'client_role_required' using errcode = 'PT403';
  end if;

  select * into client_row
  from public.clients
  where id = p_client_id
    and auth_user_id = actor_id
    and archived_at is null
    and merged_into_client_id is null
  for update;

  if not found then
    raise exception 'client_not_found' using errcode = 'PT404';
  end if;

  if client_row.trainer_id is distinct from actor_id then
    raise exception 'client_requires_safe_migration' using errcode = 'PT409';
  end if;

  select * into relationship_row
  from public.client_trainer_relationships
  where client_id = client_row.id
    and status = 'active'
  for update;

  if found then
    disconnected_trainer_id := relationship_row.trainer_id;

    update public.client_trainer_relationships
    set status = 'disconnected',
        disconnected_at = now(),
        disconnected_by = actor_id,
        updated_at = now()
    where id = relationship_row.id;
  else
    select relationship.trainer_id
    into disconnected_trainer_id
    from public.client_trainer_relationships relationship
    where relationship.client_id = client_row.id
      and relationship.status = 'disconnected'
    order by relationship.disconnected_at desc, relationship.id
    limit 1;
  end if;

  -- Repeating disconnect also repairs a legacy membership left behind by an
  -- earlier partial rollout. Only trainers recorded in disconnected history
  -- are removed; unrelated historical rows are not guessed at.
  delete from public.client_trainers membership
  where membership.client_id = client_row.id
    and exists (
      select 1
      from public.client_trainer_relationships relationship
      where relationship.client_id = membership.client_id
        and relationship.trainer_id = membership.trainer_id
        and relationship.status = 'disconnected'
    )
    and not exists (
      select 1
      from public.client_trainer_relationships relationship
      where relationship.client_id = membership.client_id
        and relationship.trainer_id = membership.trainer_id
        and relationship.status = 'active'
    );
  get diagnostics removed_memberships = row_count;

  return jsonb_strip_nulls(jsonb_build_object(
    'clientId', client_row.id,
    'trainerId', disconnected_trainer_id,
    'status', case
      when relationship_row.id is not null or removed_memberships > 0 then 'disconnected'
      else 'already_disconnected'
    end
  ));
end;
$$;

revoke all on function public.disconnect_client_trainer(uuid) from public, anon;
grant execute on function public.disconnect_client_trainer(uuid) to authenticated;
