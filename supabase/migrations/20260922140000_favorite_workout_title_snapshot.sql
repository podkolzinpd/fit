-- Part 2 of docs/design/workout-origin-and-favorite-title.md. Snapshots the
-- favorite's title onto the workout at creation time (not a live reference
-- to favorite_workouts.title - the favorite can be renamed or deleted
-- afterwards without changing already-planned workouts). Written once at
-- creation, only in the insert branch below, never updated. Card display
-- (variant C3) is a pure client-side truncation, no server logic needed.
alter table public.workouts
  add column favorite_title text;

create or replace function private.legacy_save_workout(p_workout jsonb, p_expected_version bigint default null::bigint, p_actor_id uuid default null::uuid)
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
      trainer_id, client_id, workout_date, start_time, end_time, notes, stage_id, origin, favorite_title
    ) values (
      actor_id, client_id_value, (p_workout->>'workoutDate')::date,
      nullif(p_workout->>'startTime', '')::time,
      nullif(p_workout->>'endTime', '')::time,
      nullif(btrim(p_workout->>'notes'), ''), stage_id_value,
      case when p_workout->>'origin' = 'ai' then 'ai' else 'manual' end,
      nullif(btrim(p_workout->>'favoriteTitle'), '')
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

-- RETURNS TABLE column list is changing (new favorite_title column), which
-- CREATE OR REPLACE cannot do - drop first.
drop function public.list_workouts(date, date, uuid, integer, integer);

create function public.list_workouts(p_from date default null::date, p_to date default null::date, p_client_id uuid default null::uuid, p_limit integer default 50, p_offset integer default 0)
returns table(id uuid, client_id uuid, trainer_id uuid, client_name text, created_by uuid, origin text, favorite_title text, started_by uuid, completed_by uuid, workout_date date, start_time time without time zone, end_time time without time zone, started_at timestamp with time zone, completed_at timestamp with time zone, status text, notes text, trainer_review text, trainer_reaction text, trainer_review_author_id uuid, trainer_reviewed_at timestamp with time zone, client_comment text, session_rpe smallint, wellbeing text, discomfort boolean, active_calories_kcal integer, has_pr boolean, version bigint, stage_id uuid, stage_title text, total_count bigint, exercises jsonb)
language plpgsql
stable security definer
set search_path to ''
as $function$
declare
  actor_id uuid := auth.uid();
  page_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  page_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  if actor_id is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;

  return query
  with paged_workouts as materialized (
    select
      workout.id, workout.trainer_id, workout.client_id, client.full_name as client_name,
      workout.created_by, workout.origin, workout.favorite_title, workout.started_by, workout.completed_by,
      workout.workout_date, workout.start_time, workout.end_time,
      workout.started_at, workout.completed_at, workout.status, workout.notes,
      workout.trainer_review, workout.trainer_reaction,
      workout.trainer_review_author_id, workout.trainer_reviewed_at,
      workout.client_comment, workout.session_rpe, workout.wellbeing,
      workout.discomfort, workout.active_calories_kcal,
      case when workout.status = 'done'
        then public.workout_has_personal_record(workout.id)
        else false
      end as has_pr,
      workout.version, workout.stage_id, stage.title as stage_title,
      workout.created_at, count(*) over() as total_count
    from public.workouts workout
    join public.clients client
      on client.id = workout.client_id and client.trainer_id = workout.trainer_id
    left join public.goal_stages stage on stage.id = workout.stage_id
    where workout.deleted_at is null
      and (p_from is null or workout.workout_date >= p_from)
      and (p_to is null or workout.workout_date <= p_to)
      and (p_client_id is null or workout.client_id = p_client_id)
      and (
        client.auth_user_id = actor_id
        or (
          (
            client.trainer_id = actor_id
            or exists (
              select 1
              from public.client_trainers membership
              where membership.client_id = workout.client_id
                and membership.trainer_id = actor_id
            )
          )
          and (
            workout.created_by = actor_id
            or (workout.created_by is null and workout.trainer_id = actor_id)
            or (
              workout.status = 'done'
              and workout.created_by = client.auth_user_id
            )
          )
        )
      )
    order by workout.workout_date desc, workout.start_time desc nulls last,
      workout.created_at desc, workout.id desc
    limit page_limit offset page_offset
  )
  select
    workout.id, workout.client_id, workout.trainer_id, workout.client_name,
    workout.created_by, workout.origin, workout.favorite_title, workout.started_by, workout.completed_by,
    workout.workout_date, workout.start_time, workout.end_time,
    workout.started_at, workout.completed_at, workout.status, workout.notes,
    workout.trainer_review, workout.trainer_reaction,
    workout.trainer_review_author_id, workout.trainer_reviewed_at,
    workout.client_comment, workout.session_rpe, workout.wellbeing,
    workout.discomfort, workout.active_calories_kcal, workout.has_pr, workout.version,
    workout.stage_id, workout.stage_title, workout.total_count,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', exercise.id, 'position', exercise.position,
        'exercise_source', exercise.exercise_source,
        'exercise_ref', exercise.exercise_ref,
        'custom_exercise_id', exercise.custom_exercise_id,
        'exercise_name', exercise.exercise_name,
        'muscle_group', exercise.muscle_group,
        'input_kind', exercise.input_kind,
        'block_id', exercise.block_id, 'block_type', exercise.block_type,
        'block_rounds', exercise.block_rounds,
        'trainer_comment', exercise.trainer_comment,
        'block_preset', exercise.block_preset,
        'rest_between_exercises_sec', exercise.rest_between_exercises_sec,
        'rest_between_rounds_sec', exercise.rest_between_rounds_sec,
        'rest_between_sets_sec', exercise.rest_between_sets_sec,
        'sets', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', workout_set.id, 'position', workout_set.position,
            'plan_weight_kg', workout_set.plan_weight_kg,
            'plan_reps', workout_set.plan_reps,
            'plan_duration_min', workout_set.plan_duration_min,
            'plan_duration_sec', workout_set.plan_duration_sec,
            'plan_distance_km', workout_set.plan_distance_km,
            'plan_rpe', workout_set.plan_rpe,
            'fact_weight_kg', workout_set.fact_weight_kg,
            'fact_reps', workout_set.fact_reps,
            'fact_duration_min', workout_set.fact_duration_min,
            'fact_duration_sec', workout_set.fact_duration_sec,
            'fact_distance_km', workout_set.fact_distance_km,
            'fact_rpe', workout_set.fact_rpe,
            'confirmed_at', workout_set.confirmed_at,
            'version', workout_set.version
          ) order by workout_set.position)
          from public.workout_sets workout_set
          where workout_set.workout_exercise_id = exercise.id
            and workout_set.trainer_id = workout.trainer_id
            and workout_set.client_id = workout.client_id
        ), '[]'::jsonb)
      ) order by exercise.position)
      from public.workout_exercises exercise
      where exercise.workout_id = workout.id
        and exercise.trainer_id = workout.trainer_id
        and exercise.client_id = workout.client_id
    ), '[]'::jsonb)
  from paged_workouts workout
  order by workout.workout_date desc, workout.start_time desc nulls last,
    workout.created_at desc, workout.id desc;
end;
$function$;

revoke all on function public.list_workouts(date, date, uuid, integer, integer)
  from public, anon;
grant execute on function public.list_workouts(date, date, uuid, integer, integer)
  to authenticated;
