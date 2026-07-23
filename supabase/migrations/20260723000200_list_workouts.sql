create index if not exists workouts_active_trainer_client_date_idx
  on public.workouts (trainer_id, client_id, workout_date, start_time, created_at, id)
  where deleted_at is null;

create or replace function public.list_workouts(
  p_from date default null,
  p_to date default null,
  p_client_id uuid default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  id uuid,
  client_id uuid,
  client_name text,
  workout_date date,
  start_time time,
  end_time time,
  status text,
  notes text,
  version bigint,
  exercises jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  page_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  page_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  if actor_id is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;
  if not exists (select 1 from public.trainers where profile_id = actor_id) then
    raise exception 'trainer_not_initialized' using errcode = 'P0001';
  end if;

  return query
  select
    workout.id,
    workout.client_id,
    client.full_name,
    workout.workout_date,
    workout.start_time,
    workout.end_time,
    workout.status,
    workout.notes,
    workout.version,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', exercise.id,
          'position', exercise.position,
          'exercise_source', exercise.exercise_source,
          'exercise_ref', exercise.exercise_ref,
          'custom_exercise_id', exercise.custom_exercise_id,
          'exercise_name', exercise.exercise_name,
          'muscle_group', exercise.muscle_group,
          'input_kind', exercise.input_kind,
          'sets', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', workout_set.id,
                'position', workout_set.position,
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
              )
              order by workout_set.position
            )
            from public.workout_sets workout_set
            where workout_set.workout_exercise_id = exercise.id
              and workout_set.trainer_id = actor_id
              and workout_set.client_id = workout.client_id
          ), '[]'::jsonb)
        )
        order by exercise.position
      )
      from public.workout_exercises exercise
      where exercise.workout_id = workout.id
        and exercise.trainer_id = actor_id
        and exercise.client_id = workout.client_id
    ), '[]'::jsonb)
  from public.workouts workout
  join public.clients client
    on client.id = workout.client_id
    and client.trainer_id = workout.trainer_id
  where workout.trainer_id = actor_id
    and workout.deleted_at is null
    and (p_from is null or workout.workout_date >= p_from)
    and (p_to is null or workout.workout_date <= p_to)
    and (p_client_id is null or workout.client_id = p_client_id)
  order by workout.workout_date, workout.start_time nulls last, workout.created_at, workout.id
  limit page_limit
  offset page_offset;
end;
$$;

revoke all on function public.list_workouts(date, date, uuid, integer, integer) from public, anon;
grant execute on function public.list_workouts(date, date, uuid, integer, integer) to authenticated;

create or replace function public.list_workout_summaries(p_client_id uuid)
returns table (
  id uuid,
  workout_date date,
  status text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
begin
  if actor_id is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;
  if not exists (select 1 from public.trainers where profile_id = actor_id) then
    raise exception 'trainer_not_initialized' using errcode = 'P0001';
  end if;

  return query
  select workout.id, workout.workout_date, workout.status
  from public.workouts workout
  where workout.trainer_id = actor_id
    and workout.client_id = p_client_id
    and workout.deleted_at is null
  order by workout.workout_date, workout.created_at, workout.id;
end;
$$;

revoke all on function public.list_workout_summaries(uuid) from public, anon;
grant execute on function public.list_workout_summaries(uuid) to authenticated;
