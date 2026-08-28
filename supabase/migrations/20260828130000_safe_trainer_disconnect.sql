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

  -- Обычное отключение никогда не переписывает раздел истории. Старую
  -- тренерскую карточку сначала должна безопасно разобрать repair-процедура.
  if client_row.trainer_id is distinct from actor_id then
    raise exception 'client_requires_safe_migration' using errcode = 'PT409';
  end if;

  select * into relationship_row
  from public.client_trainer_relationships
  where client_id = client_row.id
    and status = 'active'
  for update;

  if not found then
    return jsonb_build_object(
      'clientId', client_row.id,
      'status', 'already_disconnected'
    );
  end if;

  delete from public.client_trainers
  where client_id = client_row.id
    and trainer_id = relationship_row.trainer_id;

  update public.client_trainer_relationships
  set status = 'disconnected',
      disconnected_at = now(),
      disconnected_by = actor_id,
      updated_at = now()
  where id = relationship_row.id;

  return jsonb_build_object(
    'clientId', client_row.id,
    'trainerId', relationship_row.trainer_id,
    'status', 'disconnected'
  );
end;
$$;

revoke all on function public.disconnect_client_trainer(uuid) from public, anon;
grant execute on function public.disconnect_client_trainer(uuid) to authenticated;
