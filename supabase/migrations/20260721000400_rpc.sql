create or replace function public.initialize_trainer(
  p_first_name text default null,
  p_last_name text default null,
  p_timezone text default 'Europe/Moscow'
)
returns public.trainers
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  result public.trainers;
begin
  if actor_id is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;

  insert into public.profiles (id, first_name, last_name, timezone)
  values (
    actor_id,
    nullif(btrim(p_first_name), ''),
    nullif(btrim(p_last_name), ''),
    coalesce(nullif(btrim(p_timezone), ''), 'Europe/Moscow')
  )
  on conflict (id) do update set
    first_name = coalesce(excluded.first_name, public.profiles.first_name),
    last_name = coalesce(excluded.last_name, public.profiles.last_name),
    timezone = excluded.timezone;

  insert into public.trainers (profile_id)
  values (actor_id)
  on conflict (profile_id) do nothing;

  select * into result from public.trainers where profile_id = actor_id;
  return result;
end;
$$;

create or replace function public.create_client(p_client jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  created_id uuid;
  initial_weight numeric;
begin
  if actor_id is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;
  if not exists (select 1 from public.trainers where profile_id = actor_id) then
    raise exception 'trainer_not_initialized' using errcode = 'P0001';
  end if;

  insert into public.clients (
    trainer_id, full_name, gender, age_years, age_updated_at, height_cm, goal
  ) values (
    actor_id,
    p_client->>'fullName',
    p_client->>'gender',
    (p_client->>'ageYears')::smallint,
    coalesce((p_client->>'ageUpdatedAt')::date, current_date),
    (p_client->>'heightCm')::numeric,
    nullif(btrim(p_client->>'goal'), '')
  ) returning id into created_id;

  insert into public.client_private_details (client_id, trainer_id, note)
  values (created_id, actor_id, nullif(btrim(p_client->>'note'), ''));

  initial_weight := nullif(p_client->>'initialWeightKg', '')::numeric;
  if initial_weight is not null then
    insert into public.client_progress (trainer_id, client_id, recorded_on, weight_kg)
    values (
      actor_id,
      created_id,
      coalesce((p_client->>'initialWeightRecordedOn')::date, current_date),
      initial_weight
    );
  end if;

  return created_id;
end;
$$;

create or replace function public.update_client(p_client jsonb, p_expected_version bigint)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  client_id_value uuid := (p_client->>'id')::uuid;
  next_version bigint;
begin
  update public.clients set
    full_name = p_client->>'fullName',
    gender = p_client->>'gender',
    age_years = (p_client->>'ageYears')::smallint,
    age_updated_at = (p_client->>'ageUpdatedAt')::date,
    height_cm = (p_client->>'heightCm')::numeric,
    goal = nullif(btrim(p_client->>'goal'), ''),
    version = version + 1
  where id = client_id_value and trainer_id = actor_id and version = p_expected_version
  returning version into next_version;
  if next_version is null then
    raise exception 'client_conflict' using errcode = '40001';
  end if;

  update public.client_private_details
  set note = nullif(btrim(p_client->>'note'), '')
  where client_id = client_id_value and trainer_id = actor_id;

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
    select 1 from public.clients c
    where c.id = client_id_value and c.trainer_id = actor_id and c.archived_at is null
  ) then
    raise exception 'client_not_found' using errcode = 'P0002';
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
      raise exception 'workout_not_found' using errcode = 'P0002';
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
      raise exception 'workout_conflict' using errcode = '40001';
    end if;
    delete from public.workout_exercises where workout_id = root_id and trainer_id = actor_id;
  end if;

  for exercise in select value from jsonb_array_elements(coalesce(p_workout->'exercises', '[]'::jsonb))
  loop
    insert into public.workout_exercises (
      workout_id, trainer_id, client_id, position, exercise_source, exercise_ref,
      custom_exercise_id, exercise_name, muscle_group, input_kind
    ) values (
      root_id, actor_id, client_id_value, (exercise->>'position')::smallint,
      exercise->>'source', exercise->>'ref', nullif(exercise->>'customExerciseId', '')::uuid,
      exercise->>'name', exercise->>'muscleGroup', exercise->>'inputKind'
    ) returning id into exercise_id;

    for set_item in select value from jsonb_array_elements(coalesce(exercise->'sets', '[]'::jsonb))
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

create or replace function public.start_workout(p_workout_id uuid, p_expected_version bigint)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare next_version bigint;
begin
  update public.workouts set status = 'in_progress', started_at = now(), version = version + 1
  where id = p_workout_id and trainer_id = auth.uid() and status = 'planned'
    and deleted_at is null and version = p_expected_version
  returning version into next_version;
  if next_version is null then
    raise exception 'workout_conflict' using errcode = '40001';
  end if;
  return next_version;
end;
$$;

create or replace function public.save_live_set_draft(
  p_set_id uuid,
  p_draft jsonb,
  p_expected_version bigint
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare next_version bigint;
begin
  update public.workout_sets s set
    fact_weight_kg = nullif(p_draft->>'weightKg', '')::numeric,
    fact_reps = nullif(p_draft->>'reps', '')::integer,
    fact_duration_min = nullif(p_draft->>'durationMin', '')::numeric,
    fact_distance_km = nullif(p_draft->>'distanceKm', '')::numeric,
    version = s.version + 1
  from public.workout_exercises e, public.workouts w
  where s.id = p_set_id and s.version = p_expected_version
    and e.id = s.workout_exercise_id and w.id = e.workout_id
    and w.trainer_id = auth.uid() and w.status = 'in_progress' and w.deleted_at is null
  returning s.version into next_version;
  if next_version is null then
    raise exception 'live_set_conflict' using errcode = '40001';
  end if;
  return next_version;
end;
$$;

create or replace function public.confirm_live_set(p_set_id uuid, p_expected_version bigint)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare next_version bigint;
begin
  update public.workout_sets s set confirmed_at = now(), version = s.version + 1
  from public.workout_exercises e, public.workouts w
  where s.id = p_set_id and s.version = p_expected_version
    and e.id = s.workout_exercise_id and w.id = e.workout_id
    and w.trainer_id = auth.uid() and w.status = 'in_progress' and w.deleted_at is null
  returning s.version into next_version;
  if next_version is null then
    raise exception 'live_set_conflict' using errcode = '40001';
  end if;
  return next_version;
end;
$$;

create or replace function public.finish_workout(p_workout_id uuid, p_expected_version bigint)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare next_version bigint;
begin
  update public.workouts set status = 'done', completed_at = now(), version = version + 1
  where id = p_workout_id and trainer_id = auth.uid() and status = 'in_progress'
    and deleted_at is null and version = p_expected_version
  returning version into next_version;
  if next_version is null then
    raise exception 'workout_conflict' using errcode = '40001';
  end if;
  return next_version;
end;
$$;

create or replace function public.save_progress(
  p_progress jsonb,
  p_expected_version bigint default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
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
    raise exception 'client_not_found' using errcode = 'P0002';
  end if;

  if root_id is null then
    insert into public.client_progress (
      trainer_id, client_id, recorded_on, weight_kg, chest_cm, waist_cm, hip_cm, notes
    ) values (
      actor_id, client_id_value, (p_progress->>'recordedOn')::date,
      nullif(p_progress->>'weightKg', '')::numeric,
      nullif(p_progress->>'chestCm', '')::numeric,
      nullif(p_progress->>'waistCm', '')::numeric,
      nullif(p_progress->>'hipCm', '')::numeric,
      nullif(btrim(p_progress->>'notes'), '')
    ) returning id into root_id;
  else
    update public.client_progress set
      recorded_on = (p_progress->>'recordedOn')::date,
      weight_kg = nullif(p_progress->>'weightKg', '')::numeric,
      chest_cm = nullif(p_progress->>'chestCm', '')::numeric,
      waist_cm = nullif(p_progress->>'waistCm', '')::numeric,
      hip_cm = nullif(p_progress->>'hipCm', '')::numeric,
      notes = nullif(btrim(p_progress->>'notes'), ''),
      version = version + 1
    where id = root_id and trainer_id = actor_id and client_id = client_id_value
      and deleted_at is null and version = p_expected_version;
    if not found then
      raise exception 'progress_conflict' using errcode = '40001';
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
      raise exception 'metric_not_found' using errcode = 'P0002';
    end if;
    insert into public.client_progress_custom (
      trainer_id, client_id, progress_id, metric_id, value
    ) values (
      actor_id, client_id_value, root_id, (metric->>'metricId')::uuid, (metric->>'value')::numeric
    );
  end loop;
  return root_id;
end;
$$;

create or replace function public.soft_delete_workout(p_workout_id uuid, p_expected_version bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.workouts set deleted_at = now(), version = version + 1
  where id = p_workout_id and trainer_id = auth.uid() and deleted_at is null
    and version = p_expected_version;
  if not found then raise exception 'workout_conflict' using errcode = '40001'; end if;
end;
$$;

create or replace function public.soft_delete_progress(p_progress_id uuid, p_expected_version bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.client_progress set deleted_at = now(), version = version + 1
  where id = p_progress_id and trainer_id = auth.uid() and deleted_at is null
    and version = p_expected_version;
  if not found then raise exception 'progress_conflict' using errcode = '40001'; end if;
end;
$$;

revoke all on function public.initialize_trainer(text, text, text) from public, anon;
revoke all on function public.create_client(jsonb) from public, anon;
revoke all on function public.update_client(jsonb, bigint) from public, anon;
revoke all on function public.save_workout(jsonb, bigint) from public, anon;
revoke all on function public.start_workout(uuid, bigint) from public, anon;
revoke all on function public.save_live_set_draft(uuid, jsonb, bigint) from public, anon;
revoke all on function public.confirm_live_set(uuid, bigint) from public, anon;
revoke all on function public.finish_workout(uuid, bigint) from public, anon;
revoke all on function public.save_progress(jsonb, bigint) from public, anon;
revoke all on function public.soft_delete_workout(uuid, bigint) from public, anon;
revoke all on function public.soft_delete_progress(uuid, bigint) from public, anon;

grant execute on function public.initialize_trainer(text, text, text) to authenticated;
grant execute on function public.create_client(jsonb) to authenticated;
grant execute on function public.update_client(jsonb, bigint) to authenticated;
grant execute on function public.save_workout(jsonb, bigint) to authenticated;
grant execute on function public.start_workout(uuid, bigint) to authenticated;
grant execute on function public.save_live_set_draft(uuid, jsonb, bigint) to authenticated;
grant execute on function public.confirm_live_set(uuid, bigint) to authenticated;
grant execute on function public.finish_workout(uuid, bigint) to authenticated;
grant execute on function public.save_progress(jsonb, bigint) to authenticated;
grant execute on function public.soft_delete_workout(uuid, bigint) to authenticated;
grant execute on function public.soft_delete_progress(uuid, bigint) to authenticated;
