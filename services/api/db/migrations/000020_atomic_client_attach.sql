-- Up Migration

-- Атомарная привязка самостоятельного клиента к карточке тренера.
-- Самостоятельная карточка остаётся канонической, а данные из карточки,
-- созданной тренером, переносятся без изменения авторства.

create schema if not exists app_private;
revoke all on schema app_private from public;
grant usage on schema app_private to fit_api;

-- В Supabase-контуре эта закрытая схема и защитный триггер появились раньше.
-- API-контур должен уметь разворачиваться с нуля, поэтому создаём их здесь
-- явно, не полагаясь на историю другой базы.
create schema if not exists private;
revoke all on schema private from public, fit_api;

create or replace function app_private.client_dependency_counts(p_client_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
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

revoke all on function app_private.client_dependency_counts(uuid) from public, fit_api;

-- Композитные ключи содержат client_id/trainer_id. Их откладываем до конца
-- транзакции, чтобы родительские и дочерние строки сменили пространство вместе.
alter table public.workouts
  alter constraint workouts_client_fk deferrable initially immediate;
alter table public.workout_exercises
  alter constraint workout_exercises_workout_fk deferrable initially immediate,
  alter constraint workout_exercises_custom_fk deferrable initially immediate;
alter table public.workout_sets
  alter constraint workout_sets_exercise_fk deferrable initially immediate;
alter table public.client_progress
  alter constraint client_progress_client_fk deferrable initially immediate;
alter table public.client_custom_metrics
  alter constraint client_metrics_client_fk deferrable initially immediate;
alter table public.client_progress_custom
  alter constraint progress_custom_metric_fk deferrable initially immediate,
  alter constraint progress_custom_progress_fk deferrable initially immediate;
alter table public.client_goals
  alter constraint client_goals_client_fk deferrable initially immediate;
alter table public.goal_stages
  alter constraint goal_stages_goal_fk deferrable initially immediate;
alter table public.client_training_summaries
  alter constraint training_summaries_client_fk deferrable initially immediate;
alter table public.client_published_training_summaries
  alter constraint published_summaries_client_fk deferrable initially immediate,
  alter constraint client_published_training_summaries_source_summary_id_fkey deferrable initially immediate;

-- Обычная смена владельца тренировки по-прежнему запрещена. Единственное
-- исключение — источник уже атомарно помечен как объединённый именно в ту
-- карточку, куда переносится тренировка. При ошибке вся транзакция откатится.
create or replace function private.prevent_workout_client_reassignment()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.client_id is distinct from new.client_id
    and not exists (
      select 1
      from public.clients source_client
      where source_client.id = old.client_id
        and source_client.archived_at is not null
        and source_client.merged_into_client_id = new.client_id
    )
  then
    raise exception 'workout_client_immutable' using errcode = 'PT403';
  end if;
  return new;
end;
$$;

drop trigger if exists prevent_workout_client_reassignment on public.workouts;
create trigger prevent_workout_client_reassignment
before update of client_id on public.workouts
for each row execute function private.prevent_workout_client_reassignment();

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
begin
  if actor_id is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;

  select profile.account_role
  into actor_role
  from public.profiles profile
  where profile.id = actor_id;

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

    if source_client.merged_into_client_id is not null then
      return source_client.merged_into_client_id;
    end if;
    if source_client.auth_user_id = actor_id then
      return source_client.id;
    end if;
    raise exception 'invitation_invalid' using errcode = 'PT404';
  end if;

  if invitation.revoked_at is not null or invitation.expires_at <= now() then
    raise exception 'invitation_invalid' using errcode = 'PT404';
  end if;
  if actor_role <> invitation.target_role then
    raise exception 'invitation_role_mismatch' using errcode = 'PT403';
  end if;

  if invitation.target_role <> 'client' then
    insert into public.client_trainers (client_id, trainer_id, alias)
    select client.id, actor_id, client.full_name
    from public.clients client
    where client.id = invitation.client_id
      and client.archived_at is null
    on conflict (client_id, trainer_id) do nothing;

    if not found then
      raise exception 'invitation_invalid' using errcode = 'PT404';
    end if;

    update public.client_invitations
    set claimed_by = actor_id,
        claimed_at = now()
    where id = invitation.id;
    return invitation.client_id;
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

    insert into public.client_trainer_relationships (
      client_id, trainer_id, connected_by, source_invitation_id
    ) values (
      source_client.id, source_client.trainer_id, actor_id, invitation.id
    ) on conflict (client_id) where status = 'active' do nothing;

    update public.client_invitations
    set claimed_by = actor_id,
        claimed_at = now()
    where id = invitation.id;
    return source_client.id;
  end if;

  -- Самостоятельная карточка обязана принадлежать самому клиенту.
  if target_client.trainer_id <> actor_id then
    raise exception 'canonical_client_invalid' using errcode = 'PT409';
  end if;

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
    raise exception 'trainer_switch_required' using errcode = 'PT409';
  end if;

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

  insert into public.client_trainer_relationships (
    client_id, trainer_id, connected_by, source_invitation_id
  ) values (
    target_client.id, source_client.trainer_id, actor_id, invitation.id
  ) on conflict (client_id) where status = 'active' do update
  set source_invitation_id = excluded.source_invitation_id,
      updated_at = now();

  update public.client_invitations
  set claimed_by = actor_id,
      claimed_at = now()
  where id = invitation.id;

  counts_after := jsonb_build_object(
    'source', app_private.client_dependency_counts(source_client.id),
    'target', app_private.client_dependency_counts(target_client.id)
  );

  update public.client_merge_operations
  set status = 'completed',
      dependency_counts_after = counts_after,
      completed_at = now()
  where id = merge_operation_id;

  return target_client.id;
end;
$$;

revoke all on function public.claim_client_invitation(text) from public;
grant execute on function public.claim_client_invitation(text) to fit_api;

-- Down Migration

revoke execute on function public.claim_client_invitation(text) from fit_api;

create or replace function private.prevent_workout_client_reassignment()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.client_id is distinct from new.client_id then
    raise exception 'workout_client_immutable' using errcode = 'PT403';
  end if;
  return new;
end;
$$;

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
begin
  if actor_id is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;

  select profile.account_role
  into actor_role
  from public.profiles profile
  where profile.id = actor_id;

  select stored_invitation.*
  into invitation
  from public.client_invitations stored_invitation
  join public.clients client on client.id = stored_invitation.client_id
  where stored_invitation.code_hash = encode(
      sha256(convert_to(upper(btrim(coalesce(p_code, ''))), 'UTF8')),
      'hex'
    )
    and client.archived_at is null
  for update of stored_invitation;

  if invitation.id is null
    or invitation.revoked_at is not null
    or invitation.claimed_at is not null
    or invitation.expires_at <= now()
  then
    raise exception 'invitation_invalid' using errcode = 'PT404';
  end if;
  if actor_role <> invitation.target_role then
    raise exception 'invitation_role_mismatch' using errcode = 'PT403';
  end if;

  if invitation.target_role = 'client' then
    update public.clients client
    set auth_user_id = actor_id
    where client.id = invitation.client_id
      and client.auth_user_id is null;
    if not found then
      raise exception 'client_already_linked' using errcode = 'PT409';
    end if;
  else
    insert into public.client_trainers (client_id, trainer_id)
    values (invitation.client_id, actor_id)
    on conflict (client_id, trainer_id) do nothing;
  end if;

  update public.client_invitations stored_invitation
  set claimed_by = actor_id,
      claimed_at = now()
  where stored_invitation.id = invitation.id;

  return invitation.client_id;
end;
$$;

grant execute on function public.claim_client_invitation(text) to fit_api;

alter table public.client_published_training_summaries
  alter constraint published_summaries_client_fk not deferrable,
  alter constraint client_published_training_summaries_source_summary_id_fkey not deferrable;
alter table public.client_training_summaries
  alter constraint training_summaries_client_fk not deferrable;
alter table public.goal_stages
  alter constraint goal_stages_goal_fk not deferrable;
alter table public.client_goals
  alter constraint client_goals_client_fk not deferrable;
alter table public.client_progress_custom
  alter constraint progress_custom_metric_fk not deferrable,
  alter constraint progress_custom_progress_fk not deferrable;
alter table public.client_custom_metrics
  alter constraint client_metrics_client_fk not deferrable;
alter table public.client_progress
  alter constraint client_progress_client_fk not deferrable;
alter table public.workout_sets
  alter constraint workout_sets_exercise_fk not deferrable;
alter table public.workout_exercises
  alter constraint workout_exercises_workout_fk not deferrable,
  alter constraint workout_exercises_custom_fk not deferrable;
alter table public.workouts
  alter constraint workouts_client_fk not deferrable;

drop function app_private.client_dependency_counts(uuid);
