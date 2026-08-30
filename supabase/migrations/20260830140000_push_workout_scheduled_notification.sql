-- Второй push-сценарий: клиент узнаёт мгновенно, когда привязанный тренер
-- запланировал ему тренировку (не когда клиент сам себе её завёл —
-- self-service-ветка `owner_mode` в legacy_save_workout_request остаётся
-- беззвучной, уведомлять себя самого нет смысла).
--
-- В отличие от `workout_reminder` (20260826190000, окно 9:00 по cron), это
-- событие должно уйти в тот же момент, когда тренер сохранил тренировку —
-- но AGENTS.md запрещает бизнес-триггеры ("Инициализация вызывается явно").
-- Поэтому вместо AFTER INSERT trigger на public.workouts — явный вызов
-- producer-функции в конце той же RPC-транзакции, что создаёт тренировку
-- (`private.legacy_save_workout_request`). Дальше — тот же generic
-- dispatcher/sender конвейер (`private.sync_push_notifications`, работает
-- каждую минуту), что и у первого сценария.

create or replace function private.enqueue_workout_scheduled_notification(p_workout_id uuid, p_trainer_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target record;
begin
  select
    w.workout_date,
    w.start_time,
    w.status,
    c.auth_user_id as client_user_id,
    trainer.first_name as trainer_first_name,
    trainer.last_name as trainer_last_name
  into target
  from public.workouts w
  join public.clients c on c.id = w.client_id
  join public.profiles trainer on trainer.id = p_trainer_id
  where w.id = p_workout_id;

  if not found or target.status <> 'planned' or target.client_user_id is null then
    return;
  end if;
  if not exists (select 1 from public.push_subscriptions ps where ps.user_id = target.client_user_id) then
    return;
  end if;
  if not coalesce(
    (select np.enabled from public.notification_preferences np
      where np.user_id = target.client_user_id and np.kind = 'workout_scheduled'),
    true
  ) then
    return;
  end if;

  insert into private.push_notifications_outbox (kind, user_id, title, body, data)
  values (
    'workout_scheduled',
    target.client_user_id,
    'Новая тренировка',
    format(
      'Тренер %s запланировал вам тренировку на %s%s',
      nullif(btrim(coalesce(target.trainer_first_name, '') || ' ' || coalesce(target.trainer_last_name, '')), ''),
      to_char(target.workout_date, 'DD.MM.YYYY'),
      case when target.start_time is not null then ' в ' || to_char(target.start_time, 'HH24:MI') else '' end
    ),
    jsonb_build_object('workout_id', p_workout_id)
  )
  on conflict (kind, user_id, data) do nothing;
end;
$$;

create or replace function private.legacy_save_workout_request(p_workout jsonb, p_expected_version bigint DEFAULT NULL::bigint)
 returns uuid
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  actor_id uuid := auth.uid();
  original_sub text := actor_id::text;
  client_id_value uuid := (p_workout->>'clientId')::uuid;
  workout_id_value uuid := nullif(p_workout->>'id', '')::uuid;
  root_trainer uuid;
  result uuid;
  owner_mode boolean;
  effective_workout jsonb := p_workout;
  is_new_workout boolean := workout_id_value is null;
begin
  if workout_id_value is null then
    root_trainer := public.authorize_client_mutation(client_id_value, true);
  else
    root_trainer := public.authorize_workout_mutation(workout_id_value, false);
  end if;
  select exists (
    select 1 from public.clients client
    where client.id = client_id_value and client.auth_user_id = actor_id
  ) into owner_mode;
  if owner_mode then
    select jsonb_set(
      p_workout, '{exercises}',
      coalesce(jsonb_agg(exercise_item - 'trainerComment'), '[]'::jsonb)
    ) into effective_workout
    from jsonb_array_elements(coalesce(p_workout->'exercises', '[]'::jsonb)) exercise_item;
  end if;
  perform set_config('request.jwt.claim.sub', root_trainer::text, true);
  begin result := private.legacy_save_workout(effective_workout, p_expected_version, actor_id);
  exception when others then perform set_config('request.jwt.claim.sub', original_sub, true); raise; end;
  perform set_config('request.jwt.claim.sub', original_sub, true);
  if workout_id_value is null then
    update public.workouts set created_by = actor_id, updated_by = actor_id where id = result;
  else
    update public.workouts set updated_by = actor_id where id = result;
  end if;
  if is_new_workout and not owner_mode then
    perform private.enqueue_workout_scheduled_notification(result, actor_id);
  end if;
  return result;
end $function$;
