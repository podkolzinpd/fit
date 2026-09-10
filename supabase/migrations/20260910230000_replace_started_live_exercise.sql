-- Preserve completed history when a live exercise is replaced after it starts.
create or replace function private.legacy_replace_live_exercise(
  p_workout_id uuid, p_exercise_id uuid, p_exercise jsonb,
  p_expected_version bigint, p_actor_id uuid
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  next_version bigint;
  source_value text := p_exercise->>'source';
  ref_value text := p_exercise->>'ref';
  custom_id uuid := nullif(p_exercise->>'customExerciseId', '')::uuid;
  name_value text := p_exercise->>'name';
  group_value text := p_exercise->>'muscleGroup';
  kind_value text := p_exercise->>'inputKind';
  old_exercise public.workout_exercises%rowtype;
  completed_exercise_id uuid;
  completed_count integer;
  next_position integer;
  shifted record;
  set_item record;
begin
  if actor_id is null then raise exception 'authentication_required' using errcode = '28000'; end if;
  if source_value = 'custom' then
    select custom.id::text, custom.id, custom.name, custom.muscle_group, custom.input_kind
    into ref_value, custom_id, name_value, group_value, kind_value
    from public.custom_exercises custom
    where custom.id = custom_id and custom.trainer_id = actor_id and custom.archived_at is null;
    if not found then raise exception 'exercise_not_found' using errcode = 'PT404'; end if;
  elsif source_value <> 'system' then
    raise exception 'exercise_not_found' using errcode = 'PT404';
  end if;

  update public.workouts
  set version = version + 1, updated_by = p_actor_id
  where id = p_workout_id and trainer_id = actor_id and status = 'in_progress'
    and deleted_at is null and version = p_expected_version
  returning version into next_version;
  if next_version is null then raise exception 'workout_conflict' using errcode = 'PT409'; end if;

  select exercise.* into old_exercise
  from public.workout_exercises exercise
  where exercise.id = p_exercise_id and exercise.workout_id = p_workout_id and exercise.trainer_id = actor_id;
  if old_exercise.id is null then raise exception 'exercise_not_found' using errcode = 'PT404'; end if;

  select count(*) into completed_count
  from public.workout_sets workout_set
  where workout_set.workout_exercise_id = p_exercise_id and workout_set.confirmed_at is not null;

  if completed_count > 0 then
    for shifted in
      select exercise.id from public.workout_exercises exercise
      where exercise.workout_id = p_workout_id and exercise.position >= old_exercise.position
      order by exercise.position desc
    loop
      update public.workout_exercises set position = position + 1, updated_by = p_actor_id where id = shifted.id;
    end loop;

    insert into public.workout_exercises (
      workout_id, trainer_id, client_id, position, exercise_source, exercise_ref,
      custom_exercise_id, exercise_name, muscle_group, input_kind, block_id,
      block_type, block_preset, block_rounds, rest_between_exercises_sec,
      rest_between_rounds_sec, rest_between_sets_sec, trainer_comment, client_note, updated_by
    ) values (
      old_exercise.workout_id, old_exercise.trainer_id, old_exercise.client_id,
      old_exercise.position, old_exercise.exercise_source, old_exercise.exercise_ref,
      old_exercise.custom_exercise_id, old_exercise.exercise_name, old_exercise.muscle_group,
      old_exercise.input_kind, gen_random_uuid(), 'single', 'set', completed_count::smallint,
      old_exercise.rest_between_exercises_sec, old_exercise.rest_between_rounds_sec,
      old_exercise.rest_between_sets_sec, old_exercise.trainer_comment, old_exercise.client_note, p_actor_id
    ) returning id into completed_exercise_id;

    next_position := 0;
    for set_item in
      select workout_set.id from public.workout_sets workout_set
      where workout_set.workout_exercise_id = p_exercise_id and workout_set.confirmed_at is not null
      order by workout_set.position
    loop
      update public.workout_sets
      set workout_exercise_id = completed_exercise_id, position = next_position::smallint,
        version = public.workout_sets.version + 1, updated_by = p_actor_id
      where public.workout_sets.id = set_item.id;
      next_position := next_position + 1;
    end loop;
  end if;

  update public.workout_exercises exercise
  set exercise_source = source_value, exercise_ref = ref_value, custom_exercise_id = custom_id,
    exercise_name = name_value, muscle_group = group_value, input_kind = kind_value,
    trainer_comment = case when completed_count > 0 then null else exercise.trainer_comment end,
    client_note = case when completed_count > 0 then null else exercise.client_note end,
    updated_by = p_actor_id
  where exercise.id = p_exercise_id;

  update public.workout_sets workout_set
  set
    plan_weight_kg = case when old_exercise.input_kind is distinct from kind_value then null else workout_set.plan_weight_kg end,
    plan_reps = case when old_exercise.input_kind is distinct from kind_value then null else workout_set.plan_reps end,
    plan_duration_min = case when old_exercise.input_kind is distinct from kind_value then null else workout_set.plan_duration_min end,
    plan_duration_sec = case when old_exercise.input_kind is distinct from kind_value then null else workout_set.plan_duration_sec end,
    plan_distance_km = case when old_exercise.input_kind is distinct from kind_value then null else workout_set.plan_distance_km end,
    plan_rpe = case when old_exercise.input_kind is distinct from kind_value then null else workout_set.plan_rpe end,
    fact_weight_kg = null, fact_reps = null, fact_duration_min = null,
    fact_duration_sec = null, fact_distance_km = null, fact_rpe = null,
    version = workout_set.version + 1, updated_by = p_actor_id
  where workout_set.workout_exercise_id = p_exercise_id;

  next_position := 0;
  for set_item in
    select workout_set.id from public.workout_sets workout_set
    where workout_set.workout_exercise_id = p_exercise_id order by workout_set.position
  loop
    update public.workout_sets set position = next_position::smallint where id = set_item.id;
    next_position := next_position + 1;
  end loop;
  if next_position = 0 then
    insert into public.workout_sets (
      workout_exercise_id, trainer_id, client_id, position, updated_by
    ) values (p_exercise_id, old_exercise.trainer_id, old_exercise.client_id, 0, p_actor_id);
  end if;

  return next_version;
end;
$$;

