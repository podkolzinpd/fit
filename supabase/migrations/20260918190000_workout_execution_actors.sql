alter table public.workouts
  add column started_by uuid references public.profiles(id) on delete set null,
  add column completed_by uuid references public.profiles(id) on delete set null;

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

  update public.workouts
  set
    status = 'in_progress',
    started_at = now(),
    started_by = p_actor_id,
    completed_by = null,
    version = version + 1,
    updated_by = p_actor_id
  where id = p_workout_id and trainer_id = actor_id and status = 'planned'
    and deleted_at is null and version = p_expected_version
  returning version into next_version;
  if next_version is null then
    raise exception 'workout_conflict' using errcode = 'PT409';
  end if;
  return next_version;
end;
$function$;

create or replace function private.legacy_finish_workout(p_workout_id uuid, p_expected_version bigint, p_actor_id uuid)
 returns bigint
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare next_version bigint;
begin
  update public.workouts
  set
    status = 'done',
    completed_at = now(),
    completed_by = p_actor_id,
    version = version + 1,
    updated_by = p_actor_id
  where id = p_workout_id and trainer_id = auth.uid() and status = 'in_progress'
    and deleted_at is null and version = p_expected_version
  returning version into next_version;
  if next_version is null then
    raise exception 'workout_conflict' using errcode = 'PT409';
  end if;
  return next_version;
end;
$function$;

drop function if exists public.list_workouts(date, date, uuid, integer, integer);
create function public.list_workouts(
  p_from date default null,
  p_to date default null,
  p_client_id uuid default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  id uuid, client_id uuid, trainer_id uuid, client_name text, created_by uuid,
  started_by uuid, completed_by uuid,
  workout_date date, start_time time, end_time time,
  started_at timestamptz, completed_at timestamptz,
  status text, notes text, trainer_review text, trainer_reaction text,
  trainer_review_author_id uuid, trainer_reviewed_at timestamptz,
  client_comment text, session_rpe smallint, wellbeing text, discomfort boolean,
  has_pr boolean, version bigint, stage_id uuid, stage_title text,
  total_count bigint, exercises jsonb
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

  return query
  with paged_workouts as materialized (
    select
      workout.id, workout.trainer_id, workout.client_id, client.full_name as client_name,
      workout.created_by, workout.started_by, workout.completed_by,
      workout.workout_date, workout.start_time, workout.end_time,
      workout.started_at, workout.completed_at, workout.status, workout.notes,
      workout.trainer_review, workout.trainer_reaction,
      workout.trainer_review_author_id, workout.trainer_reviewed_at,
      workout.client_comment, workout.session_rpe, workout.wellbeing,
      workout.discomfort,
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
    workout.created_by, workout.started_by, workout.completed_by,
    workout.workout_date, workout.start_time, workout.end_time,
    workout.started_at, workout.completed_at, workout.status, workout.notes,
    workout.trainer_review, workout.trainer_reaction,
    workout.trainer_review_author_id, workout.trainer_reviewed_at,
    workout.client_comment, workout.session_rpe, workout.wellbeing,
    workout.discomfort, workout.has_pr, workout.version,
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
$$;

comment on function public.list_workouts(date, date, uuid, integer, integer) is
  'Accessible paginated workouts with explicit start and completion actors.';

revoke all on function public.list_workouts(date, date, uuid, integer, integer)
  from public, anon;
grant execute on function public.list_workouts(date, date, uuid, integer, integer)
  to authenticated;
