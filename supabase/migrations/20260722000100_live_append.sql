create or replace function public.append_live_exercise(
  p_workout_id uuid,
  p_exercise jsonb,
  p_expected_version bigint
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
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
      raise exception 'exercise_not_found' using errcode = 'P0002';
    end if;
  elsif source_value <> 'system' then
    raise exception 'exercise_not_found' using errcode = 'P0002';
  end if;

  update public.workouts
  set version = version + 1
  where id = p_workout_id and trainer_id = actor_id and status = 'in_progress'
    and deleted_at is null and version = p_expected_version
  returning client_id, version into client_id_value, next_version;
  if next_version is null then
    raise exception 'workout_conflict' using errcode = '40001';
  end if;

  select coalesce(max(e.position) + 1, 0)::smallint into next_position
  from public.workout_exercises e where e.workout_id = p_workout_id;

  insert into public.workout_exercises (
    workout_id, trainer_id, client_id, position, exercise_source, exercise_ref,
    custom_exercise_id, exercise_name, muscle_group, input_kind
  ) values (
    p_workout_id, actor_id, client_id_value, next_position, source_value, ref_value,
    custom_id, name_value, group_value, kind_value
  ) returning id into exercise_id;

  insert into public.workout_sets (
    workout_exercise_id, trainer_id, client_id, position
  ) values (exercise_id, actor_id, client_id_value, 0);

  return next_version;
end;
$$;

create or replace function public.append_live_set(
  p_workout_exercise_id uuid,
  p_expected_version bigint
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  workout_id_value uuid;
  client_id_value uuid;
  next_version bigint;
  next_position smallint;
begin
  if actor_id is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;

  select e.workout_id, e.client_id into workout_id_value, client_id_value
  from public.workout_exercises e
  where e.id = p_workout_exercise_id and e.trainer_id = actor_id;
  if not found then
    raise exception 'exercise_not_found' using errcode = 'P0002';
  end if;

  update public.workouts
  set version = version + 1
  where id = workout_id_value and trainer_id = actor_id and status = 'in_progress'
    and deleted_at is null and version = p_expected_version
  returning version into next_version;
  if next_version is null then
    raise exception 'workout_conflict' using errcode = '40001';
  end if;

  select coalesce(max(s.position) + 1, 0)::smallint into next_position
  from public.workout_sets s where s.workout_exercise_id = p_workout_exercise_id;

  insert into public.workout_sets (
    workout_exercise_id, trainer_id, client_id, position
  ) values (p_workout_exercise_id, actor_id, client_id_value, next_position);

  return next_version;
end;
$$;

revoke all on function public.append_live_exercise(uuid, jsonb, bigint) from public, anon;
revoke all on function public.append_live_set(uuid, bigint) from public, anon;
grant execute on function public.append_live_exercise(uuid, jsonb, bigint) to authenticated;
grant execute on function public.append_live_set(uuid, bigint) to authenticated;
