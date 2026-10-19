-- Up Migration

-- Every public compatibility entry goes through the same one-coach command.
alter table public.trainer_finance_payments alter constraint trainer_finance_payments_package_fk deferrable initially immediate;
alter table public.trainer_finance_sessions alter constraint trainer_finance_sessions_package_fk deferrable initially immediate,
  alter constraint trainer_finance_sessions_workout_fk deferrable initially immediate;

create function app_private.connect_single_trainer(p_client_id uuid, p_trainer_id uuid, p_invitation_id uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  current_trainer_id uuid;
begin
  perform 1 from public.clients client where client.id = p_client_id
    and client.auth_user_id is not null and client.archived_at is null
    and client.merged_into_client_id is null for update;
  if not found or not exists (select 1 from public.trainers where profile_id = p_trainer_id) then
    raise exception 'invitation_not_allowed' using errcode = 'PT403';
  end if;
  select trainer_id into current_trainer_id from public.client_trainer_relationships
  where client_id = p_client_id and status = 'active';
  if current_trainer_id is not null and current_trainer_id <> p_trainer_id then
    raise exception 'trainer_disconnect_required' using errcode = 'PT409';
  end if;
  if current_trainer_id is null then
    insert into public.client_trainer_relationships(client_id, trainer_id, connected_by, source_invitation_id)
    values (p_client_id, p_trainer_id, auth.uid(), p_invitation_id);
    update public.client_invitations set revoked_at = now()
    where client_id = p_client_id and id is distinct from p_invitation_id
      and target_role = 'trainer' and claimed_at is null and revoked_at is null;
  end if;
end;
$$;
revoke all on function app_private.connect_single_trainer(uuid, uuid, uuid) from public, fit_api;

create or replace function public.claim_client_invitation(p_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_role text;
  invitation public.client_invitations;
  source_client public.clients;
  target_client public.clients;
  active_trainer_id uuid;
  merge_operation_id uuid;
  counts_before jsonb;
  counts_after jsonb;
  dependency_key text;
begin
  if actor_id is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;

  select profile.account_role
  into actor_role
  from public.profiles profile
  where profile.id = actor_id;

  perform pg_advisory_xact_lock(hashtextextended('fit-client-claim:' || actor_id::text, 0));
  select stored_invitation.* into invitation
  from public.client_invitations stored_invitation
  where stored_invitation.code_hash = encode(
    sha256(convert_to(upper(btrim(coalesce(p_code, ''))), 'UTF8')), 'hex');
  perform 1 from public.clients client where client.id = invitation.client_id for update;

  select stored_invitation.*
  into invitation
  from public.client_invitations stored_invitation
  where stored_invitation.code_hash = encode(
      sha256(convert_to(upper(btrim(coalesce(p_code, ''))), 'UTF8')),
      'hex'
    )
  for update;

  if invitation.id is null then
    raise exception 'invitation_invalid' using errcode = 'PT404';
  end if;

  -- Повтор того же успешно использованного кода тем же аккаунтом безопасен.
  if invitation.claimed_at is not null then
    if invitation.claimed_by <> actor_id then
      raise exception 'invitation_invalid' using errcode = 'PT404';
    end if;

    select client.*
    into source_client
    from public.clients client
    where client.id = invitation.client_id;

    select client.* into source_client from public.clients client
    where client.id = coalesce(source_client.merged_into_client_id, source_client.id);
    if source_client.archived_at is null
      and source_client.merged_into_client_id is null
      and ((invitation.target_role = 'client' and source_client.auth_user_id = actor_id
        and public.is_active_client_trainer_connection(source_client.id, invitation.created_by))
        or (invitation.target_role = 'trainer'
          and public.is_active_client_trainer_connection(source_client.id, actor_id))) then
      return source_client.id;
    end if;
    raise exception 'invitation_connection_ended' using errcode = 'PT409';
  end if;

  if invitation.revoked_at is not null or invitation.expires_at <= now() then
    raise exception 'invitation_invalid' using errcode = 'PT404';
  end if;
  if actor_role is distinct from invitation.target_role then
    raise exception 'invitation_role_mismatch' using errcode = 'PT403';
  end if;

  if invitation.target_role = 'trainer' then
    select client.* into source_client from public.clients client
    where client.id = invitation.client_id and client.archived_at is null
      and client.merged_into_client_id is null and client.auth_user_id = invitation.created_by
    for update;
    if source_client.id is null then
      raise exception 'invitation_invalid' using errcode = 'PT404';
    end if;
    perform app_private.connect_single_trainer(source_client.id, actor_id, invitation.id);
    insert into public.client_trainers(client_id, trainer_id, alias)
    values(source_client.id, actor_id, source_client.full_name)
    on conflict(client_id, trainer_id) do nothing;
    update public.client_invitations set claimed_by = actor_id, claimed_at = now()
    where id = invitation.id;
    return source_client.id;
  end if;

  select client.*
  into source_client
  from public.clients client
  where client.id = invitation.client_id
  for update;

  if source_client.id is null
    or source_client.archived_at is not null
    or source_client.merged_into_client_id is not null
    or source_client.auth_user_id is not null
  then
    raise exception 'client_already_linked' using errcode = 'PT409';
  end if;
  if source_client.trainer_id is distinct from invitation.created_by then
    raise exception 'invitation_not_allowed' using errcode = 'PT403';
  end if;
  -- An unbound card with a former athlete's coaching periods is not a fresh
  -- offline card. Do not transfer someone else's history on a new bearer link.
  if exists (select 1 from public.client_trainer_relationships where client_id = source_client.id) then
    raise exception 'client_merge_relationship_conflict' using errcode = 'PT409';
  end if;

  select client.*
  into target_client
  from public.clients client
  where client.auth_user_id = actor_id
    and client.archived_at is null
    and client.merged_into_client_id is null
    and client.id <> source_client.id
  for update;

  -- Старый сценарий: у клиента ещё нет самостоятельной карточки.
  if target_client.id is null then
    update public.clients
    set auth_user_id = actor_id
    where id = source_client.id;

    perform app_private.connect_single_trainer(source_client.id, source_client.trainer_id, invitation.id);

    update public.client_invitations
    set claimed_by = actor_id,
        claimed_at = now()
    where id = invitation.id;
    return source_client.id;
  end if;

  -- Keep the canonical partition even when its historical key is a former
  -- trainer. Ownership comes from auth_user_id; never reparent its history.

  -- Фиксированный порядок блокировок защищает параллельные привязки от deadlock.
  perform 1
  from public.clients client
  where client.id in (source_client.id, target_client.id)
  order by client.id
  for update;

  select relationship.trainer_id
  into active_trainer_id
  from public.client_trainer_relationships relationship
  where relationship.client_id = target_client.id
    and relationship.status = 'active'
  for update;

  if active_trainer_id is not null and active_trainer_id <> source_client.trainer_id then
    raise exception 'trainer_disconnect_required' using errcode = 'PT409';
  end if;

    update public.client_progress source_progress
    set deleted_at = now(),
        updated_at = now()
    from public.client_progress target_progress
    where source_progress.client_id = source_client.id
      and source_progress.deleted_at is null
      and target_progress.client_id = target_client.id
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

  -- Не угадываем, как объединять неоднозначные значения. Любая коллизия
  -- останавливает всю транзакцию до явного решения пользователя.
  if exists (
    select 1 from public.workouts source_workout
    join public.workouts target_workout
      on target_workout.client_id = target_client.id
     and target_workout.status = 'in_progress'
     and target_workout.deleted_at is null
    where source_workout.client_id = source_client.id
      and source_workout.status = 'in_progress'
      and source_workout.deleted_at is null
  ) then
    raise exception 'client_merge_active_workout_conflict' using errcode = 'PT409';
  end if;

  if exists (
    select 1 from public.client_progress source_progress
    join public.client_progress target_progress
      on target_progress.client_id = target_client.id
     and target_progress.recorded_on = source_progress.recorded_on
     and target_progress.deleted_at is null
    where source_progress.client_id = source_client.id
      and source_progress.deleted_at is null
  ) then
    raise exception 'client_merge_progress_conflict' using errcode = 'PT409';
  end if;

  if exists (
    select 1 from public.client_custom_metrics source_metric
    join public.client_custom_metrics target_metric
      on target_metric.client_id = target_client.id
     and lower(btrim(target_metric.name)) = lower(btrim(source_metric.name))
     and target_metric.archived_at is null
    where source_metric.client_id = source_client.id
      and source_metric.archived_at is null
  ) then
    raise exception 'client_merge_metric_conflict' using errcode = 'PT409';
  end if;

  if exists (
    select 1 from public.client_goals source_goal
    join public.client_goals target_goal
      on target_goal.client_id = target_client.id
     and target_goal.status = 'active'
    where source_goal.client_id = source_client.id
      and source_goal.status = 'active'
  ) then
    raise exception 'client_merge_goal_conflict' using errcode = 'PT409';
  end if;

  if exists (
    select 1 from public.client_training_summaries source_summary
    join public.client_training_summaries target_summary
      on target_summary.client_id = target_client.id
     and target_summary.period_start = source_summary.period_start
     and target_summary.period_end = source_summary.period_end
     and target_summary.prompt_version = source_summary.prompt_version
    where source_summary.client_id = source_client.id
  ) then
    raise exception 'client_merge_summary_conflict' using errcode = 'PT409';
  end if;

  if exists (
    select 1 from public.client_published_training_summaries source_summary
    join public.client_published_training_summaries target_summary
      on target_summary.client_id = target_client.id
     and target_summary.period_start = source_summary.period_start
     and target_summary.period_end = source_summary.period_end
    where source_summary.client_id = source_client.id
  ) then
    raise exception 'client_merge_published_summary_conflict' using errcode = 'PT409';
  end if;

  counts_before := jsonb_build_object(
    'source', app_private.client_dependency_counts(source_client.id),
    'target', app_private.client_dependency_counts(target_client.id)
  );

  insert into public.client_merge_operations (
    source_client_id,
    target_client_id,
    invitation_id,
    actor_id,
    dependency_counts_before
  ) values (
    source_client.id,
    target_client.id,
    invitation.id,
    actor_id,
    counts_before
  ) returning id into merge_operation_id;

  set constraints all deferred;

  -- Сначала фиксируем точное направление объединения. Это даёт узкому
  -- защитному триггеру право перенести тренировки только в target_client.
  update public.clients
  set archived_at = now(),
      merged_into_client_id = target_client.id,
      version = version + 1
  where id = source_client.id;

  -- Пользовательское упражнение остаётся в каталоге создавшего его тренера.
  -- В переносимой тренировке уже есть полный снимок названия, группы и типа,
  -- поэтому отвязываем строку тренировки от каталога и сохраняем её как снимок.
  update public.workout_exercises exercise
  set exercise_source = 'system',
      exercise_ref = 'snapshot:custom:' || exercise.custom_exercise_id::text,
      custom_exercise_id = null
  where exercise.client_id = source_client.id
    and exercise.exercise_source = 'custom'
    and exercise.custom_exercise_id is not null;

  update public.trainer_finance_payments set client_id = target_client.id where client_id = source_client.id;
  update public.trainer_finance_sessions set client_id = target_client.id where client_id = source_client.id;
  update public.trainer_finance_packages set client_id = target_client.id where client_id = source_client.id;
  update public.trainer_finance_events set client_id = target_client.id where client_id = source_client.id;
  update app_private.quick_start_operations set client_id = target_client.id where client_id = source_client.id;

  update public.workout_sets
  set client_id = target_client.id,
      trainer_id = target_client.trainer_id
  where client_id = source_client.id;

  update public.workout_exercises
  set client_id = target_client.id,
      trainer_id = target_client.trainer_id
  where client_id = source_client.id;

  update public.workouts
  set client_id = target_client.id,
      trainer_id = target_client.trainer_id
  where client_id = source_client.id;

  update public.client_progress_custom
  set client_id = target_client.id,
      trainer_id = target_client.trainer_id
  where client_id = source_client.id;

  update public.client_progress
  set client_id = target_client.id,
      trainer_id = target_client.trainer_id
  where client_id = source_client.id;

  update public.client_custom_metrics
  set client_id = target_client.id,
      trainer_id = target_client.trainer_id
  where client_id = source_client.id;

  update public.goal_stages
  set client_id = target_client.id,
      trainer_id = target_client.trainer_id
  where client_id = source_client.id;

  update public.client_goals
  set client_id = target_client.id,
      trainer_id = target_client.trainer_id
  where client_id = source_client.id;

  update public.client_published_training_summaries
  set client_id = target_client.id,
      trainer_id = target_client.trainer_id
  where client_id = source_client.id;

  update public.client_training_summaries
  set client_id = target_client.id,
      trainer_id = target_client.trainer_id
  where client_id = source_client.id;

  insert into public.client_trainers (
    client_id, trainer_id, joined_at, alias, note, attention_snoozed_until
  )
  select
    target_client.id,
    source_client.trainer_id,
    source_membership.joined_at,
    source_membership.alias,
    source_membership.note,
    source_membership.attention_snoozed_until
  from public.client_trainers source_membership
  where source_membership.client_id = source_client.id
    and source_membership.trainer_id = source_client.trainer_id
  on conflict (client_id, trainer_id) do update
  set alias = coalesce(public.client_trainers.alias, excluded.alias),
      note = coalesce(public.client_trainers.note, excluded.note),
      attention_snoozed_until = coalesce(
        public.client_trainers.attention_snoozed_until,
        excluded.attention_snoozed_until
      );

  perform app_private.connect_single_trainer(target_client.id, source_client.trainer_id, invitation.id);

  update public.client_invitations
  set claimed_by = actor_id,
      claimed_at = now()
  where id = invitation.id;

  -- Other links to the merged card cannot attach another account later.
  update public.client_invitations set revoked_at = now()
  where client_id = source_client.id and id <> invitation.id
    and claimed_at is null and revoked_at is null;

  counts_after := jsonb_build_object(
    'source', app_private.client_dependency_counts(source_client.id),
    'target', app_private.client_dependency_counts(target_client.id)
  );

  for dependency_key in select jsonb_object_keys(counts_before -> 'source') loop
    if (counts_before -> 'source' ->> dependency_key)::bigint
       + (counts_before -> 'target' ->> dependency_key)::bigint
      <> (counts_after -> 'source' ->> dependency_key)::bigint
       + (counts_after -> 'target' ->> dependency_key)::bigint then
      raise exception 'client_merge_dependency_conflict' using errcode = 'PT409';
    end if;
  end loop;

  update public.client_merge_operations
  set status = 'completed',
      dependency_counts_after = counts_after,
      completed_at = now()
  where id = merge_operation_id;

  return target_client.id;
end;
$$;

create or replace function public.reconnect_client_trainer(p_code text)
returns uuid language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and account_role = 'client') then
    raise exception 'client_role_required' using errcode = 'PT403';
  end if;
  return public.claim_client_invitation(p_code);
end;
$$;

create or replace function public.claim_client_invitation_link(p_token text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare code text := split_part(btrim(coalesce(p_token, '')), '.', 1);
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode = '28000'; end if;
  if not exists (select 1 from public.client_invitations invitation
    where invitation.link_token_hash = encode(sha256(convert_to(btrim(coalesce(p_token, '')), 'UTF8')), 'hex')
      and invitation.code_hash = encode(sha256(convert_to(upper(code), 'UTF8')), 'hex')) then
    raise exception 'invitation_invalid' using errcode = 'PT404';
  end if;
  return public.claim_client_invitation(code);
end;
$$;


-- Ending a coaching period never reparents a partition or deletes private notes.
create function app_private.disconnect_single_trainer(p_client_id uuid, p_trainer_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare card public.clients%rowtype;
begin
  select * into card from public.clients where id = p_client_id
    and archived_at is null and merged_into_client_id is null for update;
  if card.id is null or card.auth_user_id is null
    or auth.uid() is null or (auth.uid() is distinct from card.auth_user_id
      and auth.uid() is distinct from p_trainer_id)
    or not exists (select 1 from public.trainers where profile_id = p_trainer_id) then
    raise exception 'membership_not_allowed' using errcode = 'PT403';
  end if;
  update public.client_trainer_relationships
  set status = 'disconnected', disconnected_at = now(), disconnected_by = auth.uid(), updated_at = now()
  where client_id = p_client_id and trainer_id = p_trainer_id and status = 'active';
  if found then
    -- All old offers need fresh consent after a disconnect. Messages and original
    -- participants/read cursors are deliberately untouched.
    update public.chat_conversations set connection_invited_at = null,
      connection_accepted_at = null where client_id = p_client_id;
    update public.client_invitations set revoked_at = now()
    where client_id = p_client_id and claimed_at is null and revoked_at is null;
  end if;
end;
$$;
revoke all on function app_private.disconnect_single_trainer(uuid, uuid) from public, fit_api;

create or replace function public.remove_client_trainer(p_client_id uuid, p_trainer_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.clients where id = p_client_id and auth_user_id = auth.uid()) then
    raise exception 'membership_not_allowed' using errcode = 'PT403';
  end if;
  perform app_private.disconnect_single_trainer(p_client_id, p_trainer_id);
end;
$$;

create or replace function public.leave_client_space(p_client_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and account_role = 'trainer') then
    raise exception 'membership_not_allowed' using errcode = 'PT403';
  end if;
  if exists (select 1 from public.clients where id = p_client_id
    and trainer_id = auth.uid() and auth_user_id is null) then
    raise exception 'root_trainer_cannot_leave' using errcode = 'PT422';
  end if;
  if not exists (select 1 from public.client_trainer_relationships
    where client_id = p_client_id and trainer_id = auth.uid()) then
    raise exception 'membership_not_found' using errcode = 'PT404';
  end if;
  perform app_private.disconnect_single_trainer(p_client_id, auth.uid());
end;
$$;

-- Resolve the original athlete's current card without moving chat history.
create function app_private.chat_connection_client(p_conversation_id uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select client.id from public.chat_conversations conversation
  join public.clients client on client.auth_user_id = conversation.client_user_id
  where conversation.id = p_conversation_id
    and auth.uid() in (conversation.client_user_id, conversation.trainer_id)
    and client.archived_at is null and client.merged_into_client_id is null;
$$;
revoke all on function app_private.chat_connection_client(uuid) from public, fit_api;

create or replace function public.get_chat_connection_state(p_conversation_id uuid)
returns table (active_connection boolean, invitation_pending boolean, invited_at timestamptz,
  can_invite boolean, can_accept boolean, trainer_switch_required boolean)
language sql stable security definer set search_path = '' as $$
  with state as (
    select conversation.*, app_private.chat_connection_client(conversation.id) as current_client_id
    from public.chat_conversations conversation
    where conversation.id = p_conversation_id
      and auth.uid() in (conversation.client_user_id, conversation.trainer_id)
  ), connection as (
    select state.*,
      public.is_active_client_trainer_connection(current_client_id, trainer_id) as connected,
      exists(select 1 from public.client_trainer_relationships relationship
        where relationship.client_id = state.current_client_id and relationship.status = 'active'
          and relationship.trainer_id <> state.trainer_id) as has_other,
      state.connection_invited_at is not null and state.connection_accepted_at is null
        and not exists(select 1 from public.client_trainer_relationships relationship
          where relationship.client_id = state.current_client_id and relationship.status = 'disconnected'
            and relationship.disconnected_at >= state.connection_invited_at) as pending
    from state
  )
  select connected, pending and not connected, connection_invited_at,
    current_client_id is not null and auth.uid() = trainer_id and not connected and not has_other
      and client_blocked_at is null and trainer_blocked_at is null,
    current_client_id is not null and auth.uid() = client_user_id and pending and not connected and not has_other
      and client_blocked_at is null and trainer_blocked_at is null,
    has_other from connection;
$$;

create or replace function public.send_chat_connection_invitation(p_conversation_id uuid)
returns table (active_connection boolean, invitation_pending boolean, invited_at timestamptz,
  can_invite boolean, can_accept boolean, trainer_switch_required boolean)
language plpgsql security definer set search_path = '' as $$
declare
  conversation public.chat_conversations%rowtype;
  card_id uuid := app_private.chat_connection_client(p_conversation_id);
  state record;
begin
  -- The same card lock is used by link/code acceptance and disconnect.
  select id into card_id from public.clients where id = card_id
    and archived_at is null and merged_into_client_id is null
    and auth_user_id = (select client_user_id from public.chat_conversations where id = p_conversation_id)
  for update;
  select * into conversation from public.chat_conversations where id = p_conversation_id for update;
  if card_id is null or auth.uid() is distinct from conversation.trainer_id then
    raise exception 'chat_forbidden' using errcode = 'PT403';
  end if;
  if conversation.client_blocked_at is not null or conversation.trainer_blocked_at is not null then
    raise exception 'chat_blocked' using errcode = 'PT403';
  end if;
  select * into state from public.get_chat_connection_state(p_conversation_id);
  if state.trainer_switch_required then
    raise exception 'trainer_switch_required' using errcode = 'PT409';
  end if;
  if not state.active_connection and not state.invitation_pending then
    update public.chat_conversations set connection_invited_at = clock_timestamp(),
      connection_accepted_at = null, updated_at = now()
    where id = p_conversation_id returning * into conversation;
    insert into app_private.push_notifications_outbox(kind, user_id, title, body, data, subscription_id)
    select 'chat_message', conversation.client_user_id, 'Тренер', 'Предлагает заниматься вместе',
      jsonb_build_object('conversation_id', conversation.id, 'url', '/chat/' || conversation.id,
        'event', 'trainer_invitation', 'invited_at', conversation.connection_invited_at), subscription.id
    from public.push_subscriptions subscription where subscription.user_id = conversation.client_user_id
      and coalesce((select enabled from public.notification_preferences
        where user_id = conversation.client_user_id and kind = 'chat_message'), true)
    on conflict(kind, user_id, data, subscription_id) do nothing;
  end if;
  return query select * from public.get_chat_connection_state(p_conversation_id);
end;
$$;

create or replace function public.accept_chat_connection_invitation(p_conversation_id uuid)
returns table (active_connection boolean, invitation_pending boolean, invited_at timestamptz,
  can_invite boolean, can_accept boolean, trainer_switch_required boolean)
language plpgsql security definer set search_path = '' as $$
declare
  conversation public.chat_conversations%rowtype;
  card_id uuid := app_private.chat_connection_client(p_conversation_id);
  state record;
begin
  select id into card_id from public.clients where id = card_id
    and archived_at is null and merged_into_client_id is null
    and auth_user_id = (select client_user_id from public.chat_conversations where id = p_conversation_id)
  for update;
  select * into conversation from public.chat_conversations where id = p_conversation_id for update;
  if card_id is null or auth.uid() is distinct from conversation.client_user_id then
    raise exception 'chat_forbidden' using errcode = 'PT403';
  end if;
  if conversation.client_blocked_at is not null or conversation.trainer_blocked_at is not null then
    raise exception 'chat_blocked' using errcode = 'PT403';
  end if;
  select * into state from public.get_chat_connection_state(p_conversation_id);
  if state.trainer_switch_required then
    raise exception 'trainer_switch_required' using errcode = 'PT409';
  end if;
  -- An already accepted offer is only a receipt while that connection is active.
  if state.active_connection then
    return query select * from public.get_chat_connection_state(p_conversation_id);
    return;
  end if;
  if not state.can_accept then
    raise exception 'chat_invitation_required' using errcode = 'PT409';
  end if;
  perform app_private.connect_single_trainer(card_id, conversation.trainer_id);
  insert into public.client_trainers(client_id, trainer_id, alias)
  select card_id, conversation.trainer_id, full_name from public.clients where id = card_id
  on conflict(client_id, trainer_id) do nothing;
  update public.chat_conversations set connection_accepted_at = now(), updated_at = now()
  where id = p_conversation_id;
  insert into app_private.push_notifications_outbox(kind, user_id, title, body, data, subscription_id)
  select 'chat_message', conversation.trainer_id, 'Спортсмен', 'Принял приглашение',
    jsonb_build_object('conversation_id', conversation.id, 'url', '/chat/' || conversation.id,
      'event', 'trainer_invitation_accepted', 'invited_at', conversation.connection_invited_at), subscription.id
  from public.push_subscriptions subscription where subscription.user_id = conversation.trainer_id
    and coalesce((select enabled from public.notification_preferences
      where user_id = conversation.trainer_id and kind = 'chat_message'), true)
  on conflict(kind, user_id, data, subscription_id) do nothing;
  return query select * from public.get_chat_connection_state(p_conversation_id);
end;
$$;

create or replace function app_private.client_dependency_counts(p_client_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'finance_packages', (select count(*) from public.trainer_finance_packages where client_id = p_client_id),
    'finance_payments', (select count(*) from public.trainer_finance_payments where client_id = p_client_id),
    'finance_sessions', (select count(*) from public.trainer_finance_sessions where client_id = p_client_id),
    'quick_start_receipts', (select count(*) from app_private.quick_start_operations where client_id = p_client_id),
    'workouts', (select count(*) from public.workouts where client_id = p_client_id),
    'workout_exercises', (select count(*) from public.workout_exercises where client_id = p_client_id),
    'workout_sets', (select count(*) from public.workout_sets where client_id = p_client_id),
    'progress', (select count(*) from public.client_progress where client_id = p_client_id),
    'progress_custom', (select count(*) from public.client_progress_custom where client_id = p_client_id),
    'custom_metrics', (select count(*) from public.client_custom_metrics where client_id = p_client_id),
    'goals', (select count(*) from public.client_goals where client_id = p_client_id),
    'goal_stages', (select count(*) from public.goal_stages where client_id = p_client_id),
    'training_summaries', (select count(*) from public.client_training_summaries where client_id = p_client_id),
    'published_summaries', (select count(*) from public.client_published_training_summaries where client_id = p_client_id)
  );
$$;

create or replace function public.create_client_invitation(
  p_client_id uuid,
  p_target_role text
)
returns table (
  invitation_id uuid,
  invitation_code text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_role text;
  generated_code text;
  generated_expiry timestamptz := now() + interval '7 days';
begin
  if actor_id is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;
  if p_target_role not in ('client', 'trainer') then
    raise exception 'invalid_invitation_role' using errcode = 'PT422';
  end if;

  select profile.account_role
  into actor_role
  from public.profiles profile
  where profile.id = actor_id;

  if p_target_role = 'client' then
    if actor_role <> 'trainer' then
      raise exception 'invitation_not_allowed' using errcode = 'PT403';
    end if;
    perform 1
    from public.clients client
    where client.id = p_client_id
      and client.archived_at is null
      and client.auth_user_id is null
      and public.can_access_client(client.id)
    for update;
    if not found then
      raise exception 'invitation_not_allowed' using errcode = 'PT403';
    end if;
  else
    if actor_role <> 'client' then
      raise exception 'invitation_not_allowed' using errcode = 'PT403';
    end if;
    perform 1
    from public.clients client
    where client.id = p_client_id
      and client.archived_at is null
      and client.auth_user_id = actor_id
    for update;
    if not found then
      raise exception 'invitation_not_allowed' using errcode = 'PT403';
    end if;
  end if;

  if p_target_role = 'trainer' and exists (
    select 1 from public.client_trainer_relationships
    where client_id = p_client_id and status = 'active'
  ) then
    raise exception 'trainer_disconnect_required' using errcode = 'PT409';
  end if;

  update public.client_invitations invitation
  set revoked_at = now()
  where invitation.client_id = p_client_id
    and invitation.target_role = p_target_role
    and invitation.claimed_at is null
    and invitation.revoked_at is null;

  generated_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));

  insert into public.client_invitations (
    client_id,
    created_by,
    target_role,
    code_hash,
    expires_at
  ) values (
    p_client_id,
    actor_id,
    p_target_role,
    encode(sha256(convert_to(generated_code, 'UTF8')), 'hex'),
    generated_expiry
  )
  returning id into invitation_id;

  invitation_code := generated_code;
  expires_at := generated_expiry;
  return next;
end;
$$;

create or replace function public.get_client_invitation_preview(p_token text)
returns table (
  target_role text,
  inviter_name text,
  expires_at timestamptz,
  invitation_status text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    invitation.target_role,
    coalesce(
      nullif(btrim(concat_ws(' ', profile.first_name, profile.last_name)), ''),
      'Пользователь Fit'
    ) as inviter_name,
    invitation.expires_at,
    case
      when invitation.claimed_at is not null then 'claimed'
      when invitation.revoked_at is not null then 'revoked'
      when invitation.expires_at <= now() then 'expired'
      else 'active'
    end as invitation_status
  from public.client_invitations invitation
  join public.clients client on client.id = invitation.client_id
  join public.profiles profile on profile.id = invitation.created_by
  where (invitation.claimed_at is not null or
    (client.archived_at is null and client.merged_into_client_id is null))
    and invitation.link_token_hash = encode(
    sha256(convert_to(btrim(coalesce(p_token, '')), 'UTF8')),
    'hex'
  );
$$;

-- Down Migration
-- Forward-only: never restore the second-trainer bypass.
select 1;
