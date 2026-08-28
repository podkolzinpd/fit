-- Расширение безопасного переподключения: регистрация непосредственно по
-- приглашению и устранение только точных технических дублей стартового замера.
-- Предыдущая миграция остаётся неизменной; новое определение применяется
-- отдельным последовательным шагом.

create or replace function public.reconnect_client_trainer(p_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_role text;
  active_trainer_id uuid;
  invitation public.client_invitations%rowtype;
  source_client public.clients%rowtype;
  canonical_client public.clients%rowtype;
begin
  if actor_id is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;

  select profile.account_role
  into actor_role
  from public.profiles profile
  where profile.id = actor_id;

  if actor_role is distinct from 'client' then
    raise exception 'client_role_required' using errcode = 'PT403';
  end if;

  select stored_invitation.*
  into invitation
  from public.client_invitations stored_invitation
  where stored_invitation.code_hash = encode(
      extensions.digest(upper(btrim(coalesce(p_code, ''))), 'sha256'),
      'hex'
    )
  for update;

  if invitation.id is null then
    raise exception 'invitation_invalid' using errcode = 'PT404';
  end if;

  if invitation.claimed_at is not null then
    if invitation.claimed_by is distinct from actor_id then
      raise exception 'invitation_invalid' using errcode = 'PT404';
    end if;
    return public.claim_client_invitation(p_code);
  end if;

  if invitation.revoked_at is not null
    or invitation.expires_at <= now()
    or invitation.target_role <> 'client'
  then
    raise exception 'invitation_invalid' using errcode = 'PT404';
  end if;

  select client.*
  into source_client
  from public.clients client
  where client.id = invitation.client_id
    and client.archived_at is null
    and client.merged_into_client_id is null
    and client.auth_user_id is null
  for update;

  if source_client.id is null then
    raise exception 'invitation_invalid' using errcode = 'PT404';
  end if;

  select client.*
  into canonical_client
  from public.clients client
  where client.auth_user_id = actor_id
    and client.archived_at is null
    and client.merged_into_client_id is null
    and client.id <> source_client.id
  for update;

  -- При регистрации непосредственно по приглашению самостоятельной карточки
  -- ещё нет. Создаём её в той же транзакции и затем запускаем атомарное
  -- объединение, сохраняя тот же контракт владения данными.
  if canonical_client.id is null then
    insert into public.clients (
      trainer_id,
      auth_user_id,
      full_name,
      gender,
      age_years,
      age_updated_at,
      height_cm,
      goal
    ) values (
      actor_id,
      actor_id,
      source_client.full_name,
      source_client.gender,
      source_client.age_years,
      source_client.age_updated_at,
      source_client.height_cm,
      source_client.goal
    )
    returning * into canonical_client;

    insert into public.client_private_details (client_id, trainer_id)
    values (canonical_client.id, actor_id);
  end if;

  select relationship.trainer_id
  into active_trainer_id
  from public.client_trainer_relationships relationship
  where relationship.client_id = canonical_client.id
    and relationship.status = 'active'
  for update;

  if active_trainer_id is not null then
    raise exception 'trainer_disconnect_required' using errcode = 'PT409';
  end if;

  -- Архивируем только полностью одинаковый стартовый замер без собственных
  -- метрик. Любое расхождение остаётся коллизией и отклоняется claim.
  update public.client_progress source_progress
  set deleted_at = now(),
      updated_at = now(),
      updated_by = actor_id
  from public.client_progress target_progress
  where source_progress.client_id = source_client.id
    and source_progress.deleted_at is null
    and target_progress.client_id = canonical_client.id
    and target_progress.recorded_on = source_progress.recorded_on
    and target_progress.deleted_at is null
    and target_progress.weight_kg is not distinct from source_progress.weight_kg
    and target_progress.chest_cm is not distinct from source_progress.chest_cm
    and target_progress.waist_cm is not distinct from source_progress.waist_cm
    and target_progress.hip_cm is not distinct from source_progress.hip_cm
    and target_progress.notes is not distinct from source_progress.notes
    and not exists (
      select 1
      from public.client_progress_custom source_custom
      where source_custom.progress_id = source_progress.id
    );

  return public.claim_client_invitation(p_code);
end;
$$;

revoke all on function public.reconnect_client_trainer(text) from public, anon;
grant execute on function public.reconnect_client_trainer(text) to authenticated;
