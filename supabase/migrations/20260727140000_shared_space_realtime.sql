alter table public.workout_exercises
  rename column trainer_comment to comment;

create or replace function public.authorize_client_mutation(
  p_client_id uuid,
  p_allow_owner boolean
)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_role text;
  root_trainer_id uuid;
begin
  if actor_id is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;

  select profile.account_role into actor_role
  from public.profiles profile
  where profile.id = actor_id;

  select client.trainer_id into root_trainer_id
  from public.clients client
  where client.id = p_client_id
    and (
      client.auth_user_id = actor_id
      or client.trainer_id = actor_id
      or exists (
        select 1
        from public.client_trainers membership
        where membership.client_id = client.id
          and membership.trainer_id = actor_id
      )
    );

  if root_trainer_id is null and actor_role = 'trainer' then
    return actor_id;
  end if;
  if root_trainer_id is null then
    raise exception 'client_access_denied' using errcode = 'PT403';
  end if;
  return root_trainer_id;
end;
$$;

create or replace function private.legacy_save_workout(
  p_workout jsonb,
  p_expected_version bigint default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  root_id uuid := nullif(p_workout->>'id', '')::uuid;
  client_id_value uuid := (p_workout->>'clientId')::uuid;
  exercise jsonb;
  set_item jsonb;
  exercise_id uuid;
begin
  if actor_id is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;
  if not exists (
    select 1 from public.clients client
    where client.id = client_id_value
      and client.trainer_id = actor_id
      and client.archived_at is null
  ) then
    raise exception 'client_not_found' using errcode = 'PT404';
  end if;

  if root_id is null then
    insert into public.workouts (
      trainer_id, client_id, workout_date, start_time, end_time, notes
    ) values (
      actor_id, client_id_value, (p_workout->>'workoutDate')::date,
      nullif(p_workout->>'startTime', '')::time,
      nullif(p_workout->>'endTime', '')::time,
      nullif(btrim(p_workout->>'notes'), '')
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
      version = version + 1
    where id = root_id and trainer_id = actor_id
      and status = 'planned'
      and version = p_expected_version;
    if not found then
      raise exception 'workout_conflict' using errcode = 'PT409';
    end if;
    delete from public.workout_exercises
    where workout_id = root_id and trainer_id = actor_id;
  end if;

  for exercise in
    select value from jsonb_array_elements(coalesce(p_workout->'exercises', '[]'::jsonb))
  loop
    insert into public.workout_exercises (
      workout_id, trainer_id, client_id, position, exercise_source, exercise_ref,
      custom_exercise_id, exercise_name, muscle_group, input_kind,
      block_id, block_type, block_rounds, comment, block_preset,
      rest_between_exercises_sec, rest_between_rounds_sec, rest_between_sets_sec
    ) values (
      root_id, actor_id, client_id_value, (exercise->>'position')::smallint,
      exercise->>'source', exercise->>'ref',
      nullif(exercise->>'customExerciseId', '')::uuid,
      exercise->>'name', exercise->>'muscleGroup', exercise->>'inputKind',
      coalesce(nullif(exercise->>'blockId', '')::uuid, gen_random_uuid()),
      coalesce(nullif(exercise->>'blockType', ''), 'single'),
      greatest(coalesce(nullif(exercise->>'blockRounds', '')::smallint, 1), 1),
      nullif(btrim(exercise->>'comment'), ''),
      coalesce(nullif(exercise->>'blockPreset', ''), 'set'),
      coalesce(nullif(exercise->>'restBetweenExercisesSec', '')::smallint, 0),
      coalesce(nullif(exercise->>'restBetweenRoundsSec', '')::smallint, 90),
      coalesce(nullif(exercise->>'restBetweenSetsSec', '')::smallint, 90)
    ) returning id into exercise_id;

    for set_item in
      select value from jsonb_array_elements(coalesce(exercise->'sets', '[]'::jsonb))
    loop
      insert into public.workout_sets (
        workout_exercise_id, trainer_id, client_id, position,
        plan_weight_kg, plan_reps, plan_duration_min, plan_distance_km
      ) values (
        exercise_id, actor_id, client_id_value, (set_item->>'position')::smallint,
        nullif(set_item->>'weightKg', '')::numeric,
        nullif(set_item->>'reps', '')::integer,
        nullif(set_item->>'durationMin', '')::numeric,
        nullif(set_item->>'distanceKm', '')::numeric
      );
    end loop;
  end loop;
  return root_id;
end;
$$;

create or replace function private.legacy_set_exercise_comment(
  p_exercise_id uuid,
  p_comment text,
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
  next_version bigint;
begin
  select exercise.workout_id into workout_id_value
  from public.workout_exercises exercise
  where exercise.id = p_exercise_id and exercise.trainer_id = actor_id;
  if workout_id_value is null then
    raise exception 'exercise_not_found' using errcode = 'PT404';
  end if;

  update public.workouts
  set version = version + 1
  where id = workout_id_value and trainer_id = actor_id
    and status = 'in_progress' and deleted_at is null
    and version = p_expected_version
  returning version into next_version;
  if next_version is null then
    raise exception 'workout_conflict' using errcode = '40001';
  end if;

  update public.workout_exercises
  set comment = nullif(btrim(p_comment), '')
  where id = p_exercise_id;
  return next_version;
end;
$$;

create or replace function public.save_workout(
  p_workout jsonb,
  p_expected_version bigint default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  original_sub text := actor_id::text;
  workout_id_value uuid := nullif(p_workout->>'id', '')::uuid;
  root_trainer uuid;
  result uuid;
begin
  root_trainer := public.authorize_client_mutation((p_workout->>'clientId')::uuid, true);
  perform set_config('request.jwt.claim.sub', root_trainer::text, true);
  begin
    result := private.legacy_save_workout(p_workout, p_expected_version);
  exception when others then
    perform set_config('request.jwt.claim.sub', original_sub, true);
    raise;
  end;
  perform set_config('request.jwt.claim.sub', original_sub, true);

  if workout_id_value is null then
    update public.workouts set created_by = actor_id where id = result;
    if not found then
      raise exception 'workout_not_found' using errcode = 'PT404';
    end if;
  end if;
  return result;
end;
$$;

create or replace function public.soft_delete_workout(
  p_workout_id uuid,
  p_expected_version bigint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  original_sub text := auth.uid()::text;
  root_trainer uuid;
  client_id_value uuid;
begin
  select workout.client_id into client_id_value
  from public.workouts workout
  where workout.id = p_workout_id and workout.deleted_at is null;
  root_trainer := public.authorize_client_mutation(client_id_value, true);
  perform set_config('request.jwt.claim.sub', root_trainer::text, true);
  begin
    perform private.legacy_soft_delete_workout(p_workout_id, p_expected_version);
  exception when others then
    perform set_config('request.jwt.claim.sub', original_sub, true);
    raise;
  end;
  perform set_config('request.jwt.claim.sub', original_sub, true);
end;
$$;

create or replace function public.list_workouts(
  p_from date default null,
  p_to date default null,
  p_client_id uuid default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  id uuid, client_id uuid, client_name text, workout_date date,
  start_time time, end_time time, started_at timestamptz, completed_at timestamptz,
  status text, notes text, version bigint, total_count bigint, exercises jsonb
)
language plpgsql stable security definer set search_path = ''
as $$
declare
  page_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  page_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  if auth.uid() is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;
  return query
  select workout.id, workout.client_id, client.full_name, workout.workout_date,
    workout.start_time, workout.end_time, workout.started_at, workout.completed_at,
    workout.status, workout.notes, workout.version, count(*) over(),
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', exercise.id, 'position', exercise.position,
          'exercise_source', exercise.exercise_source, 'exercise_ref', exercise.exercise_ref,
          'custom_exercise_id', exercise.custom_exercise_id, 'exercise_name', exercise.exercise_name,
          'muscle_group', exercise.muscle_group, 'input_kind', exercise.input_kind,
          'block_id', exercise.block_id, 'block_type', exercise.block_type,
          'block_rounds', exercise.block_rounds, 'comment', exercise.comment,
          'block_preset', exercise.block_preset,
          'rest_between_exercises_sec', exercise.rest_between_exercises_sec,
          'rest_between_rounds_sec', exercise.rest_between_rounds_sec,
          'rest_between_sets_sec', exercise.rest_between_sets_sec,
          'sets', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', workout_set.id, 'position', workout_set.position,
                'plan_weight_kg', workout_set.plan_weight_kg,
                'plan_reps', workout_set.plan_reps,
                'plan_duration_min', workout_set.plan_duration_min,
                'plan_distance_km', workout_set.plan_distance_km,
                'fact_weight_kg', workout_set.fact_weight_kg,
                'fact_reps', workout_set.fact_reps,
                'fact_duration_min', workout_set.fact_duration_min,
                'fact_distance_km', workout_set.fact_distance_km,
                'confirmed_at', workout_set.confirmed_at,
                'version', workout_set.version
              ) order by workout_set.position
            )
            from public.workout_sets workout_set
            where workout_set.workout_exercise_id = exercise.id
              and workout_set.trainer_id = workout.trainer_id
              and workout_set.client_id = workout.client_id
          ), '[]'::jsonb)
        ) order by exercise.position
      )
      from public.workout_exercises exercise
      where exercise.workout_id = workout.id
        and exercise.trainer_id = workout.trainer_id
        and exercise.client_id = workout.client_id
    ), '[]'::jsonb)
  from public.workouts workout
  join public.clients client on client.id = workout.client_id
    and client.trainer_id = workout.trainer_id
  where public.can_access_client(workout.client_id)
    and workout.deleted_at is null
    and (p_from is null or workout.workout_date >= p_from)
    and (p_to is null or workout.workout_date <= p_to)
    and (p_client_id is null or workout.client_id = p_client_id)
  order by workout.workout_date, workout.start_time nulls last,
    workout.created_at, workout.id
  limit page_limit offset page_offset;
end;
$$;

revoke all on function public.authorize_client_mutation(uuid, boolean) from public, anon, authenticated;
revoke all on function private.legacy_save_workout(jsonb, bigint) from public, anon, authenticated;
revoke all on function private.legacy_set_exercise_comment(uuid, text, bigint) from public, anon, authenticated;
revoke all on function public.save_workout(jsonb, bigint) from public, anon;
revoke all on function public.soft_delete_workout(uuid, bigint) from public, anon;
grant execute on function public.save_workout(jsonb, bigint) to authenticated;
grant execute on function public.soft_delete_workout(uuid, bigint) to authenticated;
