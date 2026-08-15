-- Ответ тренера остаётся одним редактируемым итогом, а не превращается в чат.
-- Для назначенной тренировки отвечает её автор; для самостоятельной тренировки
-- клиента — только основной тренер карточки. Так несколько подключённых
-- тренеров не перезаписывают один ответ друг друга.
alter table public.workouts
  add column trainer_reaction text,
  add column trainer_review_author_id uuid references public.profiles (id) on delete set null,
  add column trainer_reviewed_at timestamptz;

alter table public.workouts
  add constraint workouts_trainer_reaction_valid
    check (trainer_reaction is null or trainer_reaction in ('thumbs_up', 'fire', 'strong'));

drop function if exists public.set_workout_review(uuid, text, bigint);
create function public.set_workout_review(
  p_workout_id uuid,
  p_reaction text,
  p_review text,
  p_expected_version bigint
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_role text;
  workout_trainer_id uuid;
  workout_client_id uuid;
  workout_created_by uuid;
  workout_status text;
  workout_version bigint;
  stored_reaction text;
  stored_review text;
  stored_author_id uuid;
  client_root_trainer_id uuid;
  client_auth_user_id uuid;
  responsible_trainer_id uuid;
  normalized_review text := nullif(btrim(p_review), '');
  next_version bigint;
begin
  if actor_id is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;

  select profile.account_role into actor_role
  from public.profiles profile
  where profile.id = actor_id;

  select
    workout.trainer_id, workout.client_id, workout.created_by, workout.status,
    workout.version, workout.trainer_reaction, workout.trainer_review,
    workout.trainer_review_author_id, client.trainer_id, client.auth_user_id
    into
      workout_trainer_id, workout_client_id, workout_created_by, workout_status,
      workout_version, stored_reaction, stored_review, stored_author_id,
      client_root_trainer_id, client_auth_user_id
  from public.workouts workout
  join public.clients client on client.id = workout.client_id
  where workout.id = p_workout_id
    and workout.deleted_at is null
  for update of workout;

  if not found then
    raise exception 'workout_not_found' using errcode = 'PT404';
  end if;

  responsible_trainer_id := case
    when workout_created_by = client_auth_user_id then client_root_trainer_id
    when workout_created_by is null then workout_trainer_id
    else workout_created_by
  end;

  if actor_role is distinct from 'trainer'
     or actor_id is distinct from responsible_trainer_id
     or not (
       client_root_trainer_id = actor_id
       or exists (
         select 1
         from public.client_trainers membership
         where membership.client_id = workout_client_id
           and membership.trainer_id = actor_id
       )
     ) then
    raise exception 'workout_access_denied' using errcode = 'PT403';
  end if;

  if workout_status <> 'done' then
    raise exception 'workout_not_completed' using errcode = 'PT422';
  end if;

  if not (
    (p_reaction is null and normalized_review is null)
    or (
      p_reaction in ('thumbs_up', 'fire', 'strong')
      and normalized_review is not null
    )
  ) then
    raise exception 'invalid_trainer_response' using errcode = 'PT422';
  end if;

  if char_length(normalized_review) > 500 then
    raise exception 'trainer_response_too_long' using errcode = 'PT422';
  end if;

  -- Точный повтор после потерянного сетевого ответа не создаёт новую версию и
  -- не меняет время. Отличающийся stale payload по-прежнему конфликтует.
  if stored_reaction is not distinct from p_reaction
     and stored_review is not distinct from normalized_review
     and (
       normalized_review is null
       or stored_author_id = actor_id
     ) then
    return workout_version;
  end if;

  if workout_version <> p_expected_version then
    raise exception 'workout_conflict' using errcode = 'PT409';
  end if;

  update public.workouts workout
     set trainer_reaction = p_reaction,
         trainer_review = normalized_review,
         trainer_review_author_id = case when normalized_review is null then null else actor_id end,
         trainer_reviewed_at = case when normalized_review is null then null else now() end,
         version = workout.version + 1,
         updated_at = now()
   where workout.id = p_workout_id
  returning workout.version into next_version;

  return next_version;
end;
$$;

revoke all on function public.set_workout_review(uuid, text, text, bigint)
  from public, anon;
grant execute on function public.set_workout_review(uuid, text, text, bigint)
  to authenticated;

-- Новые поля должны доезжать и в paginated list, который использует история.
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
  workout_date date, start_time time, end_time time,
  started_at timestamptz, completed_at timestamptz,
  status text, notes text, trainer_review text, trainer_reaction text,
  trainer_review_author_id uuid, trainer_reviewed_at timestamptz,
  client_comment text, version bigint, stage_id uuid, stage_title text,
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
      workout.created_by, workout.workout_date, workout.start_time, workout.end_time,
      workout.started_at, workout.completed_at, workout.status, workout.notes,
      workout.trainer_review, workout.trainer_reaction,
      workout.trainer_review_author_id, workout.trainer_reviewed_at,
      workout.client_comment, workout.version,
      workout.stage_id, stage.title as stage_title, workout.created_at,
      count(*) over() as total_count
    from public.workouts workout
    join public.clients client on client.id = workout.client_id and client.trainer_id = workout.trainer_id
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
    order by workout.workout_date, workout.start_time nulls last, workout.created_at, workout.id
    limit page_limit offset page_offset
  )
  select
    workout.id, workout.client_id, workout.trainer_id, workout.client_name, workout.created_by,
    workout.workout_date, workout.start_time, workout.end_time,
    workout.started_at, workout.completed_at, workout.status, workout.notes,
    workout.trainer_review, workout.trainer_reaction,
    workout.trainer_review_author_id, workout.trainer_reviewed_at,
    workout.client_comment, workout.version,
    workout.stage_id, workout.stage_title, workout.total_count,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', exercise.id, 'position', exercise.position, 'exercise_source', exercise.exercise_source,
        'exercise_ref', exercise.exercise_ref, 'custom_exercise_id', exercise.custom_exercise_id,
        'exercise_name', exercise.exercise_name, 'muscle_group', exercise.muscle_group,
        'input_kind', exercise.input_kind, 'block_id', exercise.block_id, 'block_type', exercise.block_type,
        'block_rounds', exercise.block_rounds, 'trainer_comment', exercise.trainer_comment,
        'block_preset', exercise.block_preset, 'rest_between_exercises_sec', exercise.rest_between_exercises_sec,
        'rest_between_rounds_sec', exercise.rest_between_rounds_sec, 'rest_between_sets_sec', exercise.rest_between_sets_sec,
        'sets', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', workout_set.id, 'position', workout_set.position,
            'plan_weight_kg', workout_set.plan_weight_kg, 'plan_reps', workout_set.plan_reps,
            'plan_duration_min', workout_set.plan_duration_min, 'plan_duration_sec', workout_set.plan_duration_sec,
            'plan_distance_km', workout_set.plan_distance_km, 'plan_rpe', workout_set.plan_rpe,
            'fact_weight_kg', workout_set.fact_weight_kg, 'fact_reps', workout_set.fact_reps,
            'fact_duration_min', workout_set.fact_duration_min, 'fact_duration_sec', workout_set.fact_duration_sec,
            'fact_distance_km', workout_set.fact_distance_km, 'fact_rpe', workout_set.fact_rpe,
            'confirmed_at', workout_set.confirmed_at, 'version', workout_set.version
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
  order by workout.workout_date, workout.start_time nulls last, workout.created_at, workout.id;
end;
$$;

revoke all on function public.list_workouts(date, date, uuid, integer, integer)
  from public, anon;
grant execute on function public.list_workouts(date, date, uuid, integer, integer)
  to authenticated;
