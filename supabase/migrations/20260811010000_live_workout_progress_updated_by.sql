-- Добавляем updated_by (кто последний раз редактировал запись) для связки
-- "живая тренировка" + замеры: workouts, workout_exercises, workout_sets,
-- client_progress. Явно узнаём, кто последний раз трогал строку — созданный
-- created_by и updated_at этого не дают (updated_at трогается кем угодно,
-- created_by не переустанавливается на правках).
--
-- Все мутации этих таблиц идут через security definer RPC, часть из которых
-- временно подменяет identity через set_config('request.jwt.claim.sub', ...)
-- перед вызовом внутренней private.legacy_*-функции (чтобы RLS-проверки
-- внутри видели владельца партиции, а не реального вызывающего). Пока эта
-- подмена активна, auth.uid() внутри legacy-функции возвращает подменённого
-- root_trainer, а не настоящего автора действия — поэтому триггер здесь
-- недопустим. Вместо этого настоящий actor_id захватывается в самом начале
-- внешней RPC-обёртки (до set_config) и передаётся дальше явным параметром
-- p_actor_id, использующимся только для updated_by (не для авторизации).

alter table public.workouts add column updated_by uuid references public.profiles (id) on delete set null;
alter table public.workout_exercises add column updated_by uuid references public.profiles (id) on delete set null;
alter table public.workout_sets add column updated_by uuid references public.profiles (id) on delete set null;
alter table public.client_progress add column updated_by uuid references public.profiles (id) on delete set null;

-- create or replace function не меняет сигнатуру существующей функции — при
-- добавлении параметра p_actor_id вместо замены создаётся ВТОРАЯ, перегруженная
-- функция, а старая (без updated_by) остаётся висеть мёртвым грузом. Дропаем
-- старые сигнатуры явно перед пересозданием.
drop function if exists private.legacy_append_live_exercise(uuid, jsonb, bigint);
drop function if exists private.legacy_append_live_set(uuid, bigint);
drop function if exists private.legacy_confirm_live_set(uuid, bigint);
drop function if exists private.legacy_finish_workout(uuid, bigint);
drop function if exists private.legacy_remove_live_set(uuid, bigint);
drop function if exists private.legacy_reorder_live_block(uuid, uuid, smallint, bigint);
drop function if exists private.legacy_replace_live_exercise(uuid, uuid, jsonb, bigint);
drop function if exists private.legacy_save_live_set_draft(uuid, jsonb, bigint);
drop function if exists private.legacy_save_progress(jsonb, bigint);
drop function if exists private.legacy_save_workout(jsonb, bigint);
drop function if exists private.legacy_set_exercise_comment(uuid, text, bigint);
drop function if exists private.legacy_soft_delete_progress(uuid, bigint);
drop function if exists private.legacy_soft_delete_workout(uuid, bigint);
drop function if exists private.legacy_start_workout(uuid, bigint);

-- ---------------------------------------------------------------------
-- private.legacy_append_live_exercise
-- ---------------------------------------------------------------------
create or replace function private.legacy_append_live_exercise(p_workout_id uuid, p_exercise jsonb, p_expected_version bigint, p_actor_id uuid)
 returns bigint
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  actor_id uuid := auth.uid();
  client_id_value uuid;
  next_version bigint;
  next_position smallint;
  exercise_id uuid;
  source_value text := p_exercise->>'source';
  ref_value text := p_exercise->>'ref';
  custom_id uuid := nullif(p_exercise->>'customExerciseId', '')::uuid;
  name_value text := p_exercise->>'name';
  group_value text := p_exercise->>'muscleGroup';
  kind_value text := p_exercise->>'inputKind';
begin
  if actor_id is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;

  if source_value = 'custom' then
    select c.id::text, c.id, c.name, c.muscle_group, c.input_kind
      into ref_value, custom_id, name_value, group_value, kind_value
    from public.custom_exercises c
    where c.id = custom_id and c.trainer_id = actor_id and c.archived_at is null;
    if not found then
      raise exception 'exercise_not_found' using errcode = 'PT404';
    end if;
  elsif source_value <> 'system' then
    raise exception 'exercise_not_found' using errcode = 'PT404';
  end if;

  update public.workouts
  set version = version + 1, updated_by = p_actor_id
  where id = p_workout_id and trainer_id = actor_id and status = 'in_progress'
    and deleted_at is null and version = p_expected_version
  returning client_id, version into client_id_value, next_version;
  if next_version is null then
    raise exception 'workout_conflict' using errcode = 'PT409';
  end if;

  select coalesce(max(e.position) + 1, 0)::smallint into next_position
  from public.workout_exercises e where e.workout_id = p_workout_id;

  insert into public.workout_exercises (
    workout_id, trainer_id, client_id, position, exercise_source, exercise_ref,
    custom_exercise_id, exercise_name, muscle_group, input_kind, block_id, block_type, block_rounds,
    block_preset, rest_between_exercises_sec, rest_between_rounds_sec, rest_between_sets_sec, updated_by
  ) values (
    p_workout_id, actor_id, client_id_value, next_position, source_value, ref_value,
    custom_id, name_value, group_value, kind_value, gen_random_uuid(), 'single', 1,
    'set', 0, 90, 90, p_actor_id
  ) returning id into exercise_id;

  insert into public.workout_sets (
    workout_exercise_id, trainer_id, client_id, position, updated_by
  ) values (exercise_id, actor_id, client_id_value, 0, p_actor_id);

  return next_version;
end;
$function$;

-- ---------------------------------------------------------------------
-- private.legacy_append_live_set
-- ---------------------------------------------------------------------
create or replace function private.legacy_append_live_set(p_workout_exercise_id uuid, p_expected_version bigint, p_actor_id uuid)
 returns bigint
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  actor_id uuid := auth.uid();
  workout_id_value uuid;
  client_id_value uuid;
  next_version bigint;
  next_position smallint;
begin
  if actor_id is null then raise exception 'authentication_required' using errcode = '28000'; end if;
  select e.workout_id, e.client_id into workout_id_value, client_id_value
  from public.workout_exercises e where e.id = p_workout_exercise_id and e.trainer_id = actor_id;
  if not found then raise exception 'exercise_not_found' using errcode = 'PT404'; end if;
  update public.workouts set version = version + 1, updated_by = p_actor_id
  where id = workout_id_value and trainer_id = actor_id and status = 'in_progress'
    and deleted_at is null and version = p_expected_version
  returning version into next_version;
  if next_version is null then raise exception 'workout_conflict' using errcode = 'PT409'; end if;
  select coalesce(max(s.position) + 1, 0)::smallint into next_position
  from public.workout_sets s where s.workout_exercise_id = p_workout_exercise_id;
  insert into public.workout_sets (
    workout_exercise_id, trainer_id, client_id, position,
    plan_weight_kg, plan_reps, plan_duration_min, plan_duration_sec, plan_distance_km, plan_rpe, updated_by
  )
  select
    p_workout_exercise_id, actor_id, client_id_value, next_position,
    coalesce(last_set.fact_weight_kg, last_set.plan_weight_kg),
    coalesce(last_set.fact_reps, last_set.plan_reps),
    coalesce(last_set.fact_duration_min, last_set.plan_duration_min),
    coalesce(last_set.fact_duration_sec, last_set.plan_duration_sec,
      round(last_set.fact_duration_min * 60)::integer, round(last_set.plan_duration_min * 60)::integer),
    coalesce(last_set.fact_distance_km, last_set.plan_distance_km),
    coalesce(last_set.fact_rpe, last_set.plan_rpe),
    p_actor_id
  from (
    select s.plan_weight_kg, s.plan_reps, s.plan_duration_min, s.plan_duration_sec, s.plan_distance_km, s.plan_rpe,
           s.fact_weight_kg, s.fact_reps, s.fact_duration_min, s.fact_duration_sec, s.fact_distance_km, s.fact_rpe
    from public.workout_sets s where s.workout_exercise_id = p_workout_exercise_id
    order by s.position desc limit 1
  ) last_set right join (select 1) placeholder on true;
  return next_version;
end;
$function$;

-- ---------------------------------------------------------------------
-- private.legacy_confirm_live_set
-- ---------------------------------------------------------------------
create or replace function private.legacy_confirm_live_set(p_set_id uuid, p_expected_version bigint, p_actor_id uuid)
 returns bigint
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare next_version bigint;
begin
  if not exists (
    select 1 from public.workout_sets workout_set
    join public.workout_exercises exercise on exercise.id = workout_set.workout_exercise_id
    join public.workouts workout on workout.id = exercise.workout_id
    where workout_set.id = p_set_id and workout_set.version = p_expected_version
      and workout.trainer_id = auth.uid() and workout.status = 'in_progress' and workout.deleted_at is null
  ) then
    raise exception 'live_set_conflict' using errcode = 'PT409';
  end if;

  if not exists (
    select 1 from public.workout_sets workout_set
    join public.workout_exercises exercise on exercise.id = workout_set.workout_exercise_id
    join public.workouts workout on workout.id = exercise.workout_id
    where workout_set.id = p_set_id and workout_set.version = p_expected_version
      and workout.trainer_id = auth.uid() and workout.status = 'in_progress' and workout.deleted_at is null
      and coalesce(
        workout_set.fact_weight_kg, workout_set.fact_reps, workout_set.fact_duration_min, workout_set.fact_duration_sec,
        workout_set.fact_distance_km, workout_set.fact_rpe, workout_set.plan_weight_kg, workout_set.plan_reps,
        workout_set.plan_duration_min, workout_set.plan_duration_sec, workout_set.plan_distance_km, workout_set.plan_rpe
      ) is not null
  ) then
    raise exception 'live_set_empty' using errcode = 'PT422';
  end if;

  update public.workout_sets workout_set set
    confirmed_at = now(),
    fact_weight_kg = coalesce(workout_set.fact_weight_kg, workout_set.plan_weight_kg),
    fact_reps = coalesce(workout_set.fact_reps, workout_set.plan_reps),
    fact_duration_min = coalesce(workout_set.fact_duration_min, workout_set.plan_duration_min),
    fact_duration_sec = coalesce(workout_set.fact_duration_sec, workout_set.plan_duration_sec, round(workout_set.fact_duration_min * 60)::integer, round(workout_set.plan_duration_min * 60)::integer),
    fact_distance_km = coalesce(workout_set.fact_distance_km, workout_set.plan_distance_km),
    fact_rpe = coalesce(workout_set.fact_rpe, workout_set.plan_rpe),
    version = workout_set.version + 1,
    updated_by = p_actor_id
  from public.workout_exercises exercise, public.workouts workout
  where workout_set.id = p_set_id and workout_set.version = p_expected_version
    and exercise.id = workout_set.workout_exercise_id and workout.id = exercise.workout_id
    and workout.trainer_id = auth.uid() and workout.status = 'in_progress' and workout.deleted_at is null
  returning workout_set.version into next_version;
  return next_version;
end;
$function$;

-- ---------------------------------------------------------------------
-- private.legacy_finish_workout
-- ---------------------------------------------------------------------
create or replace function private.legacy_finish_workout(p_workout_id uuid, p_expected_version bigint, p_actor_id uuid)
 returns bigint
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare next_version bigint;
begin
  update public.workouts set status = 'done', completed_at = now(), version = version + 1, updated_by = p_actor_id
  where id = p_workout_id and trainer_id = auth.uid() and status = 'in_progress'
    and deleted_at is null and version = p_expected_version
  returning version into next_version;
  if next_version is null then
    raise exception 'workout_conflict' using errcode = 'PT409';
  end if;
  return next_version;
end;
$function$;

-- ---------------------------------------------------------------------
-- private.legacy_remove_live_set
-- ---------------------------------------------------------------------
create or replace function private.legacy_remove_live_set(p_set_id uuid, p_expected_version bigint, p_actor_id uuid)
 returns bigint
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  actor_id uuid := auth.uid();
  exercise_id_value uuid;
  workout_id_value uuid;
  remaining int;
  next_version bigint;
begin
  if actor_id is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;

  select s.workout_exercise_id, e.workout_id
    into exercise_id_value, workout_id_value
  from public.workout_sets s
  join public.workout_exercises e on e.id = s.workout_exercise_id
  where s.id = p_set_id and s.trainer_id = actor_id;
  if not found then
    raise exception 'set_not_found' using errcode = 'PT404';
  end if;

  select count(*) into remaining
  from public.workout_sets s where s.workout_exercise_id = exercise_id_value;
  if remaining <= 1 then
    -- Последний подход убрать нельзя — используем удаление упражнения.
    raise exception 'last_set_cannot_be_removed' using errcode = 'PT422';
  end if;

  update public.workouts
  set version = version + 1, updated_by = p_actor_id
  where id = workout_id_value and trainer_id = actor_id and status = 'in_progress'
    and deleted_at is null and version = p_expected_version
  returning version into next_version;
  if next_version is null then
    raise exception 'workout_conflict' using errcode = 'PT409';
  end if;

  delete from public.workout_sets where id = p_set_id and trainer_id = actor_id;

  -- Пересчитываем позиции оставшихся подходов по порядку с нуля.
  with ordered as (
    select id, (row_number() over (order by position) - 1)::smallint as new_position
    from public.workout_sets
    where workout_exercise_id = exercise_id_value
  )
  update public.workout_sets s
  set position = ordered.new_position, updated_by = p_actor_id
  from ordered
  where s.id = ordered.id and s.position <> ordered.new_position;

  return next_version;
end;
$function$;

-- ---------------------------------------------------------------------
-- private.legacy_reorder_live_block
-- ---------------------------------------------------------------------
create or replace function private.legacy_reorder_live_block(p_workout_id uuid, p_block_id uuid, p_direction smallint, p_expected_version bigint, p_actor_id uuid)
 returns bigint
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  actor_id uuid := auth.uid();
  next_version bigint;
  target_block uuid := p_block_id;
  neighbour_block uuid;
  target_min smallint;
  cursor_position smallint := 0;
  block_row record;
begin
  if actor_id is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;

  if p_direction <> -1 and p_direction <> 1 then
    raise exception 'invalid_direction' using errcode = 'PT422';
  end if;

  update public.workouts
  set version = version + 1, updated_by = p_actor_id
  where id = p_workout_id and trainer_id = actor_id and status = 'in_progress'
    and deleted_at is null and version = p_expected_version
  returning version into next_version;
  if next_version is null then
    raise exception 'workout_conflict' using errcode = 'PT409';
  end if;

  -- Минимальная позиция целевого блока (определяет его место в списке блоков).
  select min(e.position) into target_min
  from public.workout_exercises e
  where e.workout_id = p_workout_id and e.block_id = target_block;
  if target_min is null then
    raise exception 'block_not_found' using errcode = 'PT404';
  end if;

  -- Сосед в направлении сдвига: ближайший блок выше (-1) или ниже (+1)
  -- по своей минимальной позиции.
  if p_direction = -1 then
    select e.block_id into neighbour_block
    from public.workout_exercises e
    where e.workout_id = p_workout_id
    group by e.block_id
    having min(e.position) < target_min
    order by min(e.position) desc
    limit 1;
  else
    select e.block_id into neighbour_block
    from public.workout_exercises e
    where e.workout_id = p_workout_id
    group by e.block_id
    having min(e.position) > target_min
    order by min(e.position) asc
    limit 1;
  end if;

  -- Граница списка: соседа нет — перестановка невозможна, тихий no-op.
  -- Версия уже поднята: клиент получит свежие данные, порядок не изменится.
  if neighbour_block is null then
    return next_version;
  end if;

  -- Уникальный индекс (workout_id, position) не даёт переставлять позиции
  -- напрямую — промежуточные значения коллизят. Сдвигаем все позиции в
  -- заведомо свободный диапазон, затем присваиваем финальные значения с нуля.
  update public.workout_exercises
  set position = position + 1000
  where workout_id = p_workout_id;

  -- Перенумеровываем ВСЕ упражнения тренировки подряд, обходя блоки в порядке
  -- их min(position), но меняя местами целевой и соседний блок. Внутри блока
  -- порядок упражнений сохраняется (order by position).
  for block_row in
    select bl.block_id,
           case
             when bl.block_id = target_block then
               (select min(x.position) from public.workout_exercises x
                where x.workout_id = p_workout_id and x.block_id = neighbour_block)
             when bl.block_id = neighbour_block then
               (select min(x.position) from public.workout_exercises x
                where x.workout_id = p_workout_id and x.block_id = target_block)
             else bl.min_pos
           end as sort_key
    from (
      select e.block_id, min(e.position) as min_pos
      from public.workout_exercises e
      where e.workout_id = p_workout_id
      group by e.block_id
    ) bl
    order by sort_key
  loop
    update public.workout_exercises e
    set position = cursor_position + sub.rn, updated_by = p_actor_id
    from (
      select id, (row_number() over (order by position) - 1)::smallint as rn
      from public.workout_exercises
      where workout_id = p_workout_id and block_id = block_row.block_id
    ) sub
    where e.id = sub.id;

    cursor_position := cursor_position + (
      select count(*)::smallint from public.workout_exercises
      where workout_id = p_workout_id and block_id = block_row.block_id
    );
  end loop;

  return next_version;
end;
$function$;

-- ---------------------------------------------------------------------
-- private.legacy_replace_live_exercise
-- ---------------------------------------------------------------------
create or replace function private.legacy_replace_live_exercise(p_workout_id uuid, p_exercise_id uuid, p_exercise jsonb, p_expected_version bigint, p_actor_id uuid)
 returns bigint
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  actor_id uuid := auth.uid(); next_version bigint; old_kind text;
  source_value text := p_exercise->>'source'; ref_value text := p_exercise->>'ref';
  custom_id uuid := nullif(p_exercise->>'customExerciseId', '')::uuid;
  name_value text := p_exercise->>'name'; group_value text := p_exercise->>'muscleGroup'; kind_value text := p_exercise->>'inputKind';
begin
  if actor_id is null then raise exception 'authentication_required' using errcode = '28000'; end if;
  if source_value = 'custom' then
    select c.id::text, c.id, c.name, c.muscle_group, c.input_kind
    into ref_value, custom_id, name_value, group_value, kind_value
    from public.custom_exercises c where c.id = custom_id and c.trainer_id = actor_id and c.archived_at is null;
    if not found then raise exception 'exercise_not_found' using errcode = 'PT404'; end if;
  elsif source_value <> 'system' then raise exception 'exercise_not_found' using errcode = 'PT404'; end if;
  update public.workouts set version = version + 1, updated_by = p_actor_id
  where id = p_workout_id and trainer_id = actor_id and status = 'in_progress'
    and deleted_at is null and version = p_expected_version returning version into next_version;
  if next_version is null then raise exception 'workout_conflict' using errcode = 'PT409'; end if;
  select e.input_kind into old_kind from public.workout_exercises e
  where e.id = p_exercise_id and e.workout_id = p_workout_id and e.trainer_id = actor_id;
  if old_kind is null then raise exception 'exercise_not_found' using errcode = 'PT404'; end if;
  if exists (select 1 from public.workout_sets s where s.workout_exercise_id = p_exercise_id and s.confirmed_at is not null) then
    raise exception 'exercise_already_started' using errcode = 'PT409';
  end if;
  update public.workout_exercises e set
    exercise_source = source_value, exercise_ref = ref_value, custom_exercise_id = custom_id,
    exercise_name = name_value, muscle_group = group_value, input_kind = kind_value, updated_by = p_actor_id
  where e.id = p_exercise_id;
  if old_kind is distinct from kind_value then
    update public.workout_sets s set
      plan_weight_kg = null, plan_reps = null, plan_duration_min = null, plan_duration_sec = null,
      plan_distance_km = null, plan_rpe = null,
      fact_weight_kg = null, fact_reps = null, fact_duration_min = null, fact_duration_sec = null,
      fact_distance_km = null, fact_rpe = null, updated_by = p_actor_id
    where s.workout_exercise_id = p_exercise_id;
  end if;
  return next_version;
end;
$function$;

-- ---------------------------------------------------------------------
-- private.legacy_save_completed_workout (собственный actor_id, без нового параметра)
-- ---------------------------------------------------------------------
create or replace function private.legacy_save_completed_workout(p_workout jsonb, p_expected_version bigint DEFAULT NULL::bigint)
 returns uuid
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  actor_id uuid := auth.uid();
  root_trainer uuid;
  original_sub text := actor_id::text;
  workout_id_value uuid := nullif(p_workout->>'id', '')::uuid;
  result uuid;
  client_id_value uuid := (p_workout->>'clientId')::uuid;
  exercise_item jsonb;
  set_item jsonb;
  exercise_id_value uuid;
  set_id_value uuid;
  inserted_exercise_id uuid;
begin
  if workout_id_value is null then
    root_trainer := public.authorize_client_mutation(client_id_value, true);
    perform set_config('request.jwt.claim.sub', root_trainer::text, true);
    begin
      result := private.legacy_save_workout(p_workout, p_expected_version, actor_id);
      update public.workout_sets set
        fact_weight_kg = plan_weight_kg, fact_reps = plan_reps,
        fact_duration_min = plan_duration_min, fact_duration_sec = plan_duration_sec,
        fact_distance_km = plan_distance_km, fact_rpe = plan_rpe,
        confirmed_at = now(), version = version + 1, updated_by = actor_id
      where workout_exercise_id in (select id from public.workout_exercises where workout_id = result);
      update public.workouts set status = 'done', completed_at = now(), created_by = actor_id, updated_by = actor_id, version = version + 1 where id = result;
    exception when others then
      perform set_config('request.jwt.claim.sub', original_sub, true);
      raise;
    end;
    perform set_config('request.jwt.claim.sub', original_sub, true);
    return result;
  end if;

  root_trainer := public.authorize_workout_mutation(workout_id_value, false);
  perform set_config('request.jwt.claim.sub', root_trainer::text, true);
  begin
    update public.workouts set
      workout_date = (p_workout->>'workoutDate')::date,
      start_time = nullif(p_workout->>'startTime', '')::time,
      end_time = nullif(p_workout->>'endTime', '')::time,
      notes = nullif(btrim(p_workout->>'notes'), ''),
      stage_id = nullif(p_workout->>'stageId', '')::uuid,
      version = version + 1,
      updated_by = actor_id
    where id = workout_id_value and client_id = client_id_value and status = 'done'
      and deleted_at is null and version = p_expected_version
    returning id into result;
    if result is null then raise exception 'workout_conflict' using errcode = 'PT409'; end if;

    -- Сначала исключаем старый факт: строки, отсутствующие в форме, остаются
    -- частью плана, но больше не считаются выполненными.
    update public.workout_sets workout_set set
      fact_weight_kg = null, fact_reps = null, fact_duration_min = null,
      fact_duration_sec = null, fact_distance_km = null, fact_rpe = null,
      confirmed_at = null, version = version + 1, updated_by = actor_id
    from public.workout_exercises exercise
    where exercise.id = workout_set.workout_exercise_id and exercise.workout_id = result;

    for exercise_item in select value from jsonb_array_elements(coalesce(p_workout->'exercises', '[]'::jsonb)) loop
      exercise_id_value := nullif(exercise_item->>'sourceExerciseId', '')::uuid;
      if exercise_id_value is not null and exists (
        select 1 from public.workout_exercises where id = exercise_id_value and workout_id = result
      ) then
        update public.workout_exercises set position = (exercise_item->>'position')::smallint, updated_by = actor_id
        where id = exercise_id_value;
        inserted_exercise_id := exercise_id_value;
      else
        insert into public.workout_exercises (
          workout_id, trainer_id, client_id, position, exercise_source, exercise_ref,
          custom_exercise_id, exercise_name, muscle_group, input_kind, block_id, block_type,
          block_rounds, trainer_comment, block_preset, rest_between_exercises_sec,
          rest_between_rounds_sec, rest_between_sets_sec, updated_by
        ) values (
          result, root_trainer, client_id_value, (exercise_item->>'position')::smallint,
          exercise_item->>'source', exercise_item->>'ref', nullif(exercise_item->>'customExerciseId', '')::uuid,
          exercise_item->>'name', exercise_item->>'muscleGroup', exercise_item->>'inputKind',
          coalesce(nullif(exercise_item->>'blockId', '')::uuid, gen_random_uuid()),
          coalesce(nullif(exercise_item->>'blockType', ''), 'single'),
          greatest(coalesce(nullif(exercise_item->>'blockRounds', '')::smallint, 1), 1),
          nullif(btrim(exercise_item->>'trainerComment'), ''),
          coalesce(nullif(exercise_item->>'blockPreset', ''), 'set'),
          coalesce(nullif(exercise_item->>'restBetweenExercisesSec', '')::smallint, 0),
          coalesce(nullif(exercise_item->>'restBetweenRoundsSec', '')::smallint, 90),
          coalesce(nullif(exercise_item->>'restBetweenSetsSec', '')::smallint, 90),
          actor_id
        ) returning id into inserted_exercise_id;
      end if;

      for set_item in select value from jsonb_array_elements(coalesce(exercise_item->'sets', '[]'::jsonb)) loop
        set_id_value := nullif(set_item->>'sourceSetId', '')::uuid;
        if set_id_value is not null and exists (
          select 1 from public.workout_sets where id = set_id_value and workout_exercise_id = inserted_exercise_id
        ) then
          update public.workout_sets set
            position = (set_item->>'position')::smallint,
            fact_weight_kg = nullif(set_item->>'weightKg', '')::numeric,
            fact_reps = nullif(set_item->>'reps', '')::integer,
            fact_duration_min = nullif(set_item->>'durationMin', '')::numeric,
            fact_duration_sec = nullif(set_item->>'durationSec', '')::integer,
            fact_distance_km = nullif(set_item->>'distanceKm', '')::numeric,
            fact_rpe = nullif(set_item->>'rpe', '')::numeric,
            confirmed_at = now(), version = version + 1, updated_by = actor_id
          where id = set_id_value;
        else
          insert into public.workout_sets (
            workout_exercise_id, trainer_id, client_id, position,
            fact_weight_kg, fact_reps, fact_duration_min, fact_duration_sec,
            fact_distance_km, fact_rpe, confirmed_at, updated_by
          ) values (
            inserted_exercise_id, root_trainer, client_id_value, (set_item->>'position')::smallint,
            nullif(set_item->>'weightKg', '')::numeric, nullif(set_item->>'reps', '')::integer,
            nullif(set_item->>'durationMin', '')::numeric, nullif(set_item->>'durationSec', '')::integer,
            nullif(set_item->>'distanceKm', '')::numeric, nullif(set_item->>'rpe', '')::numeric, now(), actor_id
          );
        end if;
      end loop;
    end loop;
  exception when others then
    perform set_config('request.jwt.claim.sub', original_sub, true);
    raise;
  end;
  perform set_config('request.jwt.claim.sub', original_sub, true);
  return result;
end $function$;

-- ---------------------------------------------------------------------
-- private.legacy_save_completed_workout_request (без нового параметра, добавлен локальный actor_id)
-- ---------------------------------------------------------------------
create or replace function private.legacy_save_completed_workout_request(p_workout jsonb, p_expected_version bigint DEFAULT NULL::bigint)
 returns uuid
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  actor_id uuid := auth.uid();
  result uuid;
  exercise_item jsonb;
  source_exercise_id uuid;
begin
  result := private.legacy_save_completed_workout(p_workout, p_expected_version);

  -- clearFact приходит только из явной замены упражнения в уже завершённой
  -- тренировке. Старые подходы остаются в плане, но не считаются фактом.
  if nullif(p_workout->>'id', '') is not null then
    for exercise_item in select value from jsonb_array_elements(coalesce(p_workout->'exercises', '[]'::jsonb)) loop
      if not coalesce((exercise_item->>'clearFact')::boolean, false) then continue; end if;
      source_exercise_id := nullif(exercise_item->>'sourceExerciseId', '')::uuid;
      if source_exercise_id is null then continue; end if;

      update public.workout_exercises set
        exercise_source = exercise_item->>'source',
        exercise_ref = exercise_item->>'ref',
        custom_exercise_id = nullif(exercise_item->>'customExerciseId', '')::uuid,
        exercise_name = exercise_item->>'name',
        muscle_group = exercise_item->>'muscleGroup',
        input_kind = exercise_item->>'inputKind',
        updated_by = actor_id
      where id = source_exercise_id and workout_id = result;

      update public.workout_sets set
        fact_weight_kg = null, fact_reps = null, fact_duration_min = null,
        fact_duration_sec = null, fact_distance_km = null, fact_rpe = null,
        confirmed_at = null, version = version + 1, updated_by = actor_id
      where workout_exercise_id = source_exercise_id;
    end loop;
  end if;

  return result;
end;
$function$;

-- ---------------------------------------------------------------------
-- private.legacy_save_live_set_draft
-- ---------------------------------------------------------------------
create or replace function private.legacy_save_live_set_draft(p_set_id uuid, p_draft jsonb, p_expected_version bigint, p_actor_id uuid)
 returns bigint
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare next_version bigint;
begin
  update public.workout_sets s set
    fact_weight_kg = nullif(p_draft->>'weightKg', '')::numeric,
    fact_reps = nullif(p_draft->>'reps', '')::integer,
    fact_duration_min = nullif(p_draft->>'durationMin', '')::numeric,
    fact_duration_sec = coalesce(
      nullif(p_draft->>'durationSec', '')::integer,
      round(nullif(p_draft->>'durationMin', '')::numeric * 60)::integer
    ),
    fact_distance_km = nullif(p_draft->>'distanceKm', '')::numeric,
    fact_rpe = nullif(p_draft->>'rpe', '')::numeric,
    version = s.version + 1,
    updated_by = p_actor_id
  from public.workout_exercises e, public.workouts w
  where s.id = p_set_id and s.version = p_expected_version
    and e.id = s.workout_exercise_id and w.id = e.workout_id
    and w.trainer_id = auth.uid() and w.status = 'in_progress' and w.deleted_at is null
  returning s.version into next_version;
  if next_version is null then
    raise exception 'live_set_conflict' using errcode = 'PT409';
  end if;
  return next_version;
end;
$function$;

-- ---------------------------------------------------------------------
-- private.legacy_save_progress
-- ---------------------------------------------------------------------
create or replace function private.legacy_save_progress(p_progress jsonb, p_expected_version bigint DEFAULT NULL::bigint, p_actor_id uuid DEFAULT NULL::uuid)
 returns uuid
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  actor_id uuid := auth.uid();
  root_id uuid := nullif(p_progress->>'id', '')::uuid;
  client_id_value uuid := (p_progress->>'clientId')::uuid;
  metric jsonb;
begin
  if not exists (
    select 1 from public.clients c
    where c.id = client_id_value and c.trainer_id = actor_id and c.archived_at is null
  ) then
    raise exception 'client_not_found' using errcode = 'PT404';
  end if;

  if root_id is null then
    insert into public.client_progress (
      trainer_id, client_id, recorded_on, weight_kg, chest_cm, waist_cm, hip_cm, notes, updated_by
    ) values (
      actor_id, client_id_value, (p_progress->>'recordedOn')::date,
      nullif(p_progress->>'weightKg', '')::numeric,
      nullif(p_progress->>'chestCm', '')::numeric,
      nullif(p_progress->>'waistCm', '')::numeric,
      nullif(p_progress->>'hipCm', '')::numeric,
      nullif(btrim(p_progress->>'notes'), ''),
      p_actor_id
    ) returning id into root_id;
  else
    update public.client_progress set
      recorded_on = (p_progress->>'recordedOn')::date,
      weight_kg = nullif(p_progress->>'weightKg', '')::numeric,
      chest_cm = nullif(p_progress->>'chestCm', '')::numeric,
      waist_cm = nullif(p_progress->>'waistCm', '')::numeric,
      hip_cm = nullif(p_progress->>'hipCm', '')::numeric,
      notes = nullif(btrim(p_progress->>'notes'), ''),
      version = version + 1,
      updated_by = p_actor_id
    where id = root_id and trainer_id = actor_id and client_id = client_id_value
      and deleted_at is null and version = p_expected_version;
    if not found then
      raise exception 'progress_conflict' using errcode = 'PT409';
    end if;
    delete from public.client_progress_custom where progress_id = root_id and trainer_id = actor_id;
  end if;

  for metric in select value from jsonb_array_elements(coalesce(p_progress->'customMetrics', '[]'::jsonb))
  loop
    if not exists (
      select 1 from public.client_custom_metrics m
      where m.id = (metric->>'metricId')::uuid and m.client_id = client_id_value
        and m.trainer_id = actor_id and m.archived_at is null
    ) then
      raise exception 'metric_not_found' using errcode = 'PT404';
    end if;
    insert into public.client_progress_custom (
      trainer_id, client_id, progress_id, metric_id, value
    ) values (
      actor_id, client_id_value, root_id, (metric->>'metricId')::uuid, (metric->>'value')::numeric
    );
  end loop;
  return root_id;
end;
$function$;

-- ---------------------------------------------------------------------
-- private.legacy_save_workout
-- ---------------------------------------------------------------------
create or replace function private.legacy_save_workout(p_workout jsonb, p_expected_version bigint DEFAULT NULL::bigint, p_actor_id uuid DEFAULT NULL::uuid)
 returns uuid
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  actor_id uuid := auth.uid();
  root_id uuid := nullif(p_workout->>'id', '')::uuid;
  client_id_value uuid := (p_workout->>'clientId')::uuid;
  stage_id_value uuid := nullif(p_workout->>'stageId', '')::uuid;
  exercise jsonb;
  set_item jsonb;
  exercise_id uuid;
begin
  if actor_id is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;
  if not exists (
    select 1 from public.clients c
    where c.id = client_id_value and c.trainer_id = actor_id and c.archived_at is null
  ) then
    raise exception 'client_not_found' using errcode = 'PT404';
  end if;
  if stage_id_value is not null and not exists (
    select 1 from public.goal_stages stage
    where stage.id = stage_id_value and stage.client_id = client_id_value
  ) then
    stage_id_value := null;
  end if;

  if root_id is null then
    insert into public.workouts (
      trainer_id, client_id, workout_date, start_time, end_time, notes, stage_id
    ) values (
      actor_id, client_id_value, (p_workout->>'workoutDate')::date,
      nullif(p_workout->>'startTime', '')::time,
      nullif(p_workout->>'endTime', '')::time,
      nullif(btrim(p_workout->>'notes'), ''), stage_id_value
    ) returning id into root_id;
  else
    perform 1 from public.workouts
      where id = root_id and trainer_id = actor_id and deleted_at is null
      for update;
    if not found then
      raise exception 'workout_not_found' using errcode = 'PT404';
    end if;
    update public.workouts set
      client_id = client_id_value,
      workout_date = (p_workout->>'workoutDate')::date,
      start_time = nullif(p_workout->>'startTime', '')::time,
      end_time = nullif(p_workout->>'endTime', '')::time,
      notes = nullif(btrim(p_workout->>'notes'), ''),
      stage_id = stage_id_value,
      version = version + 1
    where id = root_id and trainer_id = actor_id
      and status = 'planned' and version = p_expected_version;
    if not found then
      raise exception 'workout_conflict' using errcode = 'PT409';
    end if;
    delete from public.workout_exercises where workout_id = root_id and trainer_id = actor_id;
  end if;

  for exercise in select value from jsonb_array_elements(coalesce(p_workout->'exercises', '[]'::jsonb))
  loop
    insert into public.workout_exercises (
      workout_id, trainer_id, client_id, position, exercise_source, exercise_ref,
      custom_exercise_id, exercise_name, muscle_group, input_kind, block_id, block_type, block_rounds, trainer_comment,
      block_preset, rest_between_exercises_sec, rest_between_rounds_sec, rest_between_sets_sec, updated_by
    ) values (
      root_id, actor_id, client_id_value, (exercise->>'position')::smallint,
      exercise->>'source', exercise->>'ref', nullif(exercise->>'customExerciseId', '')::uuid,
      exercise->>'name', exercise->>'muscleGroup', exercise->>'inputKind',
      coalesce(nullif(exercise->>'blockId', '')::uuid, gen_random_uuid()),
      coalesce(nullif(exercise->>'blockType', ''), 'single'),
      greatest(coalesce(nullif(exercise->>'blockRounds', '')::smallint, 1), 1),
      nullif(btrim(exercise->>'trainerComment'), ''),
      coalesce(nullif(exercise->>'blockPreset', ''), 'set'),
      coalesce(nullif(exercise->>'restBetweenExercisesSec', '')::smallint, 0),
      coalesce(nullif(exercise->>'restBetweenRoundsSec', '')::smallint, 90),
      coalesce(nullif(exercise->>'restBetweenSetsSec', '')::smallint, 90),
      p_actor_id
    ) returning id into exercise_id;

    for set_item in select value from jsonb_array_elements(coalesce(exercise->'sets', '[]'::jsonb))
    loop
      insert into public.workout_sets (
        workout_exercise_id, trainer_id, client_id, position,
        plan_weight_kg, plan_reps, plan_duration_min, plan_duration_sec, plan_distance_km, plan_rpe, updated_by
      ) values (
        exercise_id, actor_id, client_id_value, (set_item->>'position')::smallint,
        nullif(set_item->>'weightKg', '')::numeric,
        nullif(set_item->>'reps', '')::integer,
        nullif(set_item->>'durationMin', '')::numeric,
        nullif(set_item->>'durationSec', '')::integer,
        nullif(set_item->>'distanceKm', '')::numeric,
        nullif(set_item->>'rpe', '')::numeric,
        p_actor_id
      );
    end loop;
  end loop;
  return root_id;
end;
$function$;

-- ---------------------------------------------------------------------
-- private.legacy_save_workout_request (собственный actor_id, без нового параметра)
-- ---------------------------------------------------------------------
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
  return result;
end $function$;

-- ---------------------------------------------------------------------
-- private.legacy_set_exercise_comment
-- ---------------------------------------------------------------------
create or replace function private.legacy_set_exercise_comment(p_exercise_id uuid, p_comment text, p_expected_version bigint, p_actor_id uuid)
 returns bigint
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  actor_id uuid := auth.uid();
  workout_id_value uuid;
  next_version bigint;
begin
  if actor_id is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;

  select e.workout_id into workout_id_value
  from public.workout_exercises e
  where e.id = p_exercise_id and e.trainer_id = actor_id;
  if workout_id_value is null then
    raise exception 'exercise_not_found' using errcode = 'PT404';
  end if;

  update public.workouts
  set version = version + 1, updated_by = p_actor_id
  where id = workout_id_value and trainer_id = actor_id and status = 'in_progress'
    and deleted_at is null and version = p_expected_version
  returning version into next_version;
  if next_version is null then
    raise exception 'workout_conflict' using errcode = 'PT409';
  end if;

  update public.workout_exercises
  set trainer_comment = nullif(btrim(p_comment), ''), updated_by = p_actor_id
  where id = p_exercise_id;

  return next_version;
end;
$function$;

-- ---------------------------------------------------------------------
-- private.legacy_soft_delete_progress
-- ---------------------------------------------------------------------
create or replace function private.legacy_soft_delete_progress(p_progress_id uuid, p_expected_version bigint, p_actor_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  update public.client_progress set deleted_at = now(), version = version + 1, updated_by = p_actor_id
  where id = p_progress_id and trainer_id = auth.uid() and deleted_at is null
    and version = p_expected_version;
  if not found then raise exception 'progress_conflict' using errcode = 'PT409'; end if;
end;
$function$;

-- ---------------------------------------------------------------------
-- private.legacy_soft_delete_workout
-- ---------------------------------------------------------------------
create or replace function private.legacy_soft_delete_workout(p_workout_id uuid, p_expected_version bigint, p_actor_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  update public.workouts set deleted_at = now(), version = version + 1, updated_by = p_actor_id
  where id = p_workout_id and trainer_id = auth.uid() and deleted_at is null
    and version = p_expected_version;
  if not found then raise exception 'workout_conflict' using errcode = 'PT409'; end if;
end;
$function$;

-- ---------------------------------------------------------------------
-- private.legacy_start_workout
-- ---------------------------------------------------------------------
create or replace function private.legacy_start_workout(p_workout_id uuid, p_expected_version bigint, p_actor_id uuid)
 returns bigint
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  actor_id uuid := auth.uid();
  client_archived boolean;
  next_version bigint;
begin
  select c.archived_at is not null into client_archived
  from public.workouts w
  join public.clients c on c.id = w.client_id and c.trainer_id = w.trainer_id
  where w.id = p_workout_id and w.trainer_id = actor_id and w.deleted_at is null;

  if client_archived is null or client_archived then
    raise exception 'client_not_found' using errcode = 'PT404';
  end if;

  update public.workouts set status = 'in_progress', started_at = now(), version = version + 1, updated_by = p_actor_id
  where id = p_workout_id and trainer_id = actor_id and status = 'planned'
    and deleted_at is null and version = p_expected_version
  returning version into next_version;
  if next_version is null then
    raise exception 'workout_conflict' using errcode = 'PT409';
  end if;
  return next_version;
end;
$function$;

-- =======================================================================
-- Публичные обёртки: захватываем actor_id ДО подмены identity и прокидываем
-- в legacy-функции явным параметром.
-- =======================================================================

create or replace function public.append_live_exercise(p_workout_id uuid, p_exercise jsonb, p_expected_version bigint)
 returns bigint
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare actor_id uuid := auth.uid(); original_sub text := actor_id::text; root_trainer uuid; result bigint;
begin
  root_trainer := public.authorize_workout_mutation(p_workout_id, true);
  perform set_config('request.jwt.claim.sub', root_trainer::text, true);
  begin result := private.legacy_append_live_exercise(p_workout_id, p_exercise, p_expected_version, actor_id);
  exception when others then perform set_config('request.jwt.claim.sub', original_sub, true); raise; end;
  perform set_config('request.jwt.claim.sub', original_sub, true); return result;
end $function$;

create or replace function public.append_live_set(p_workout_exercise_id uuid, p_expected_version bigint)
 returns bigint
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare actor_id uuid := auth.uid(); original_sub text := actor_id::text; root_trainer uuid; workout_id_value uuid; result bigint;
begin
  select workout_id into workout_id_value from public.workout_exercises where id = p_workout_exercise_id;
  root_trainer := public.authorize_workout_mutation(workout_id_value, true);
  perform set_config('request.jwt.claim.sub', root_trainer::text, true);
  begin result := private.legacy_append_live_set(p_workout_exercise_id, p_expected_version, actor_id);
  exception when others then perform set_config('request.jwt.claim.sub', original_sub, true); raise; end;
  perform set_config('request.jwt.claim.sub', original_sub, true); return result;
end $function$;

create or replace function public.confirm_live_set(p_set_id uuid, p_expected_version bigint)
 returns bigint
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  actor_id uuid := auth.uid();
  original_sub text := actor_id::text;
  root_trainer uuid;
  workout_id_value uuid;
  result bigint;
begin
  select exercise.workout_id into workout_id_value
  from public.workout_sets workout_set
  join public.workout_exercises exercise on exercise.id = workout_set.workout_exercise_id
  where workout_set.id = p_set_id;

  root_trainer := public.authorize_workout_mutation(workout_id_value, true);
  perform set_config('request.jwt.claim.sub', root_trainer::text, true);
  begin
    perform 1
    from public.workout_sets workout_set
    join public.workout_exercises exercise on exercise.id = workout_set.workout_exercise_id
    join public.workouts workout on workout.id = exercise.workout_id
    where workout_set.id = p_set_id
      and workout.trainer_id = root_trainer
      and workout.status = 'in_progress'
      and workout.deleted_at is null
    for update of workout;
    if not found then raise exception 'live_set_conflict' using errcode = 'PT409'; end if;

    result := private.legacy_confirm_live_set(p_set_id, p_expected_version, actor_id);
  exception when others then
    perform set_config('request.jwt.claim.sub', original_sub, true);
    raise;
  end;
  perform set_config('request.jwt.claim.sub', original_sub, true);
  return result;
end;
$function$;

create or replace function public.finish_workout(p_workout_id uuid, p_expected_version bigint)
 returns bigint
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare actor_id uuid := auth.uid(); original_sub text := actor_id::text; root_trainer uuid; result bigint;
begin
  root_trainer := public.authorize_workout_mutation(p_workout_id, true);
  perform set_config('request.jwt.claim.sub', root_trainer::text, true);
  begin result := private.legacy_finish_workout(p_workout_id, p_expected_version, actor_id);
  exception when others then perform set_config('request.jwt.claim.sub', original_sub, true); raise; end;
  perform set_config('request.jwt.claim.sub', original_sub, true); return result;
end $function$;

create or replace function public.remove_live_set(p_set_id uuid, p_expected_version bigint)
 returns bigint
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare actor_id uuid := auth.uid(); original_sub text := actor_id::text; root_trainer uuid; workout_id_value uuid; result bigint;
begin
  select exercise.workout_id into workout_id_value
  from public.workout_sets workout_set
  join public.workout_exercises exercise on exercise.id = workout_set.workout_exercise_id
  where workout_set.id = p_set_id;
  root_trainer := public.authorize_workout_mutation(workout_id_value, true);
  perform set_config('request.jwt.claim.sub', root_trainer::text, true);
  begin result := private.legacy_remove_live_set(p_set_id, p_expected_version, actor_id);
  exception when others then perform set_config('request.jwt.claim.sub', original_sub, true); raise; end;
  perform set_config('request.jwt.claim.sub', original_sub, true); return result;
end $function$;

create or replace function public.reorder_live_block(p_workout_id uuid, p_block_id uuid, p_direction smallint, p_expected_version bigint)
 returns bigint
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare actor_id uuid := auth.uid(); original_sub text := actor_id::text; root_trainer uuid; result bigint;
begin
  root_trainer := public.authorize_workout_mutation(p_workout_id, true);
  perform set_config('request.jwt.claim.sub', root_trainer::text, true);
  begin result := private.legacy_reorder_live_block(p_workout_id, p_block_id, p_direction, p_expected_version, actor_id);
  exception when others then perform set_config('request.jwt.claim.sub', original_sub, true); raise; end;
  perform set_config('request.jwt.claim.sub', original_sub, true); return result;
end $function$;

create or replace function public.replace_live_exercise(p_workout_id uuid, p_exercise_id uuid, p_exercise jsonb, p_expected_version bigint)
 returns bigint
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare actor_id uuid := auth.uid(); original_sub text := actor_id::text; root_trainer uuid; result bigint;
begin
  root_trainer := public.authorize_workout_mutation(p_workout_id, true);
  perform set_config('request.jwt.claim.sub', root_trainer::text, true);
  begin result := private.legacy_replace_live_exercise(p_workout_id, p_exercise_id, p_exercise, p_expected_version, actor_id);
  exception when others then perform set_config('request.jwt.claim.sub', original_sub, true); raise; end;
  perform set_config('request.jwt.claim.sub', original_sub, true); return result;
end $function$;

create or replace function public.save_live_set_draft(p_set_id uuid, p_draft jsonb, p_expected_version bigint)
 returns bigint
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare actor_id uuid := auth.uid(); original_sub text := actor_id::text; root_trainer uuid; workout_id_value uuid; result bigint;
begin
  select exercise.workout_id into workout_id_value
  from public.workout_sets workout_set
  join public.workout_exercises exercise on exercise.id = workout_set.workout_exercise_id
  where workout_set.id = p_set_id;
  root_trainer := public.authorize_workout_mutation(workout_id_value, true);
  perform set_config('request.jwt.claim.sub', root_trainer::text, true);
  begin result := private.legacy_save_live_set_draft(p_set_id, p_draft, p_expected_version, actor_id);
  exception when others then perform set_config('request.jwt.claim.sub', original_sub, true); raise; end;
  perform set_config('request.jwt.claim.sub', original_sub, true); return result;
end $function$;

create or replace function public.save_progress(p_progress jsonb, p_expected_version bigint DEFAULT NULL::bigint)
 returns uuid
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  actor_id uuid := auth.uid();
  original_sub text := actor_id::text;
  root_id uuid := nullif(p_progress->>'id', '')::uuid;
  client_id_value uuid := (p_progress->>'clientId')::uuid;
  actor_role text;
  root_trainer uuid;
  result uuid;
begin
  root_trainer := public.authorize_client_mutation(client_id_value, true);
  select account_role into actor_role from public.profiles where id = actor_id;
  if root_id is not null and actor_role = 'trainer' and not exists (
    select 1 from public.client_progress progress
    where progress.id = root_id and progress.client_id = client_id_value
      and progress.created_by = actor_id and progress.deleted_at is null
  ) then
    raise exception 'progress_edit_denied' using errcode = 'PT403';
  end if;
  perform set_config('request.jwt.claim.sub', root_trainer::text, true);
  begin result := private.legacy_save_progress(p_progress, p_expected_version, actor_id);
  exception when others then perform set_config('request.jwt.claim.sub', original_sub, true); raise; end;
  perform set_config('request.jwt.claim.sub', original_sub, true);
  if root_id is null then update public.client_progress set created_by = actor_id where id = result; end if;
  return result;
end $function$;

create or replace function public.set_exercise_comment(p_exercise_id uuid, p_comment text, p_expected_version bigint)
 returns bigint
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare actor_id uuid := auth.uid(); original_sub text := actor_id::text; root_trainer uuid; workout_id_value uuid; result bigint;
begin
  select workout_id into workout_id_value from public.workout_exercises where id = p_exercise_id;
  root_trainer := public.authorize_workout_mutation(workout_id_value, false);
  perform set_config('request.jwt.claim.sub', root_trainer::text, true);
  begin result := private.legacy_set_exercise_comment(p_exercise_id, p_comment, p_expected_version, actor_id);
  exception when others then perform set_config('request.jwt.claim.sub', original_sub, true); raise; end;
  perform set_config('request.jwt.claim.sub', original_sub, true); return result;
end $function$;

create or replace function public.soft_delete_progress(p_progress_id uuid, p_expected_version bigint)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  actor_id uuid := auth.uid();
  original_sub text := actor_id::text;
  actor_role text;
  root_trainer uuid;
  client_id_value uuid;
begin
  select client_id into client_id_value from public.client_progress where id = p_progress_id;
  root_trainer := public.authorize_client_mutation(client_id_value, true);
  select account_role into actor_role from public.profiles where id = actor_id;
  if actor_role = 'trainer' and not exists (
    select 1 from public.client_progress progress
    where progress.id = p_progress_id and progress.created_by = actor_id
      and progress.deleted_at is null
  ) then
    raise exception 'progress_delete_denied' using errcode = 'PT403';
  end if;
  perform set_config('request.jwt.claim.sub', root_trainer::text, true);
  begin perform private.legacy_soft_delete_progress(p_progress_id, p_expected_version, actor_id);
  exception when others then perform set_config('request.jwt.claim.sub', original_sub, true); raise; end;
  perform set_config('request.jwt.claim.sub', original_sub, true);
end $function$;

create or replace function public.soft_delete_workout(p_workout_id uuid, p_expected_version bigint)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare actor_id uuid := auth.uid(); original_sub text := actor_id::text; root_trainer uuid;
begin
  root_trainer := public.authorize_workout_mutation(p_workout_id, false);
  perform set_config('request.jwt.claim.sub', root_trainer::text, true);
  begin perform private.legacy_soft_delete_workout(p_workout_id, p_expected_version, actor_id);
  exception when others then perform set_config('request.jwt.claim.sub', original_sub, true); raise; end;
  perform set_config('request.jwt.claim.sub', original_sub, true);
end $function$;

create or replace function public.start_workout(p_workout_id uuid, p_expected_version bigint)
 returns bigint
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  actor_id uuid := auth.uid();
  original_sub text := actor_id::text;
  root_trainer uuid;
  target_client_id uuid;
  active_workout_id uuid;
  result bigint;
begin
  root_trainer := public.authorize_workout_mutation(p_workout_id, true);

  select client_id into target_client_id
  from public.workouts
  where id = p_workout_id and deleted_at is null;

  select id into active_workout_id
  from public.workouts
  where client_id = target_client_id
    and id <> p_workout_id
    and status = 'in_progress'
    and deleted_at is null;

  if active_workout_id is not null then
    raise exception 'active_workout_exists' using errcode = 'PT409';
  end if;

  perform set_config('request.jwt.claim.sub', root_trainer::text, true);
  begin
    result := private.legacy_start_workout(p_workout_id, p_expected_version, actor_id);
  exception
    when unique_violation then
      perform set_config('request.jwt.claim.sub', original_sub, true);
      raise exception 'active_workout_exists' using errcode = 'PT409';
    when others then
      perform set_config('request.jwt.claim.sub', original_sub, true);
      raise;
  end;
  perform set_config('request.jwt.claim.sub', original_sub, true);
  return result;
end;
$function$;
