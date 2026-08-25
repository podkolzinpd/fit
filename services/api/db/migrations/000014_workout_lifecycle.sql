-- Up Migration

alter table public.workouts
  add column client_comment text,
  add constraint workouts_client_comment_length
    check (client_comment is null or char_length(client_comment) <= 5000);

create table app_private.workout_create_requests (
  actor_id uuid not null references public.profiles (id) on delete cascade,
  request_id uuid not null,
  workout_id uuid references public.workouts (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (actor_id, request_id)
);

alter table public.workout_exercises
  drop constraint workout_exercises_position_unique,
  add constraint workout_exercises_position_unique
    unique (workout_id, position) deferrable initially immediate;
alter table public.workout_sets
  drop constraint workout_sets_position_unique,
  add constraint workout_sets_position_unique
    unique (workout_exercise_id, position) deferrable initially immediate;

create or replace function app_private.authorize_workout_lifecycle(
  p_workout_id uuid,
  p_client_can_execute boolean
)
returns table (
  actor_role text,
  root_trainer_id uuid,
  client_id uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
begin
  return query
  select
    profile.account_role,
    workout.trainer_id,
    workout.client_id
  from public.workouts workout
  join public.clients client on client.id = workout.client_id
  join public.profiles profile on profile.id = actor_id
  where workout.id = p_workout_id
    and workout.deleted_at is null
    and (
      (
        profile.account_role = 'trainer'
        and (
          workout.created_by = actor_id
          or (workout.created_by is null and workout.trainer_id = actor_id)
        )
        and (
          client.trainer_id = actor_id
          or exists (
            select 1
            from public.client_trainers membership
            where membership.client_id = workout.client_id
              and membership.trainer_id = actor_id
          )
        )
      )
      or (
        profile.account_role = 'client'
        and client.auth_user_id = actor_id
        and (p_client_can_execute or workout.created_by = actor_id)
      )
    );

  if not found then
    raise exception 'workout_forbidden' using errcode = 'PT403';
  end if;
end;
$$;

revoke all on function app_private.authorize_workout_lifecycle(uuid, boolean)
  from public;

create or replace function app_private.replace_completed_workout_fact(
  p_workout_id uuid,
  p_workout jsonb,
  p_actor_id uuid,
  p_actor_role text,
  p_root_trainer_id uuid,
  p_client_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  exercise_item jsonb;
  set_item jsonb;
  exercise_id_value uuid;
  set_id_value uuid;
  custom_exercise_id_value uuid;
begin
  set constraints public.workout_exercises_position_unique,
    public.workout_sets_position_unique deferred;

  update public.workout_exercises exercise
  set position = shifted.position
  from (
    select id, (16000 + row_number() over (order by position, id))::smallint
      as position
    from public.workout_exercises
    where workout_id = p_workout_id
  ) shifted
  where exercise.id = shifted.id;

  update public.workout_sets workout_set
  set
    position = shifted.position,
    fact_weight_kg = null,
    fact_reps = null,
    fact_duration_min = null,
    fact_duration_sec = null,
    fact_distance_km = null,
    fact_rpe = null,
    confirmed_at = null,
    updated_by = p_actor_id,
    version = workout_set.version + 1
  from (
    select
      workout_set.id,
      (
        16000 + row_number() over (
          partition by workout_set.workout_exercise_id
          order by workout_set.position, workout_set.id
        )
      )::smallint as position
    from public.workout_sets workout_set
    join public.workout_exercises exercise
      on exercise.id = workout_set.workout_exercise_id
    where exercise.workout_id = p_workout_id
  ) shifted
  where workout_set.id = shifted.id;

  for exercise_item in
    select value
    from jsonb_array_elements(coalesce(p_workout->'exercises', '[]'::jsonb))
  loop
    exercise_id_value := nullif(exercise_item->>'sourceExerciseId', '')::uuid;
    custom_exercise_id_value := nullif(
      exercise_item->>'customExerciseId',
      ''
    )::uuid;

    if exercise_id_value is not null then
      update public.workout_exercises exercise
      set
        position = (exercise_item->>'position')::smallint,
        updated_by = p_actor_id
      where exercise.id = exercise_id_value
        and exercise.workout_id = p_workout_id;
      if not found then
        raise exception 'workout_invalid' using errcode = 'PT422';
      end if;
    else
      if exercise_item->>'source' = 'custom' then
        if custom_exercise_id_value is null or not exists (
          select 1
          from public.custom_exercises custom_exercise
          where custom_exercise.id = custom_exercise_id_value
            and custom_exercise.trainer_id = p_root_trainer_id
            and custom_exercise.archived_at is null
        ) then
          raise exception 'workout_invalid' using errcode = 'PT422';
        end if;
      elsif exercise_item->>'source' <> 'system'
        or custom_exercise_id_value is not null
      then
        raise exception 'workout_invalid' using errcode = 'PT422';
      end if;

      insert into public.workout_exercises (
        workout_id, trainer_id, client_id, position,
        exercise_source, exercise_ref, custom_exercise_id, exercise_name,
        muscle_group, input_kind, block_id, block_type, block_preset,
        block_rounds, rest_between_exercises_sec, rest_between_rounds_sec,
        rest_between_sets_sec, trainer_comment, updated_by
      ) values (
        p_workout_id,
        p_root_trainer_id,
        p_client_id,
        (exercise_item->>'position')::smallint,
        exercise_item->>'source',
        exercise_item->>'ref',
        custom_exercise_id_value,
        exercise_item->>'name',
        exercise_item->>'muscleGroup',
        exercise_item->>'inputKind',
        (exercise_item->>'blockId')::uuid,
        exercise_item->>'blockType',
        exercise_item->>'blockPreset',
        (exercise_item->>'blockRounds')::smallint,
        (exercise_item->>'restBetweenExercisesSec')::smallint,
        (exercise_item->>'restBetweenRoundsSec')::smallint,
        (exercise_item->>'restBetweenSetsSec')::smallint,
        case
          when p_actor_role = 'client' then null
          else nullif(btrim(exercise_item->>'trainerComment'), '')
        end,
        p_actor_id
      )
      returning id into exercise_id_value;
    end if;

    for set_item in
      select value
      from jsonb_array_elements(coalesce(exercise_item->'sets', '[]'::jsonb))
    loop
      set_id_value := nullif(set_item->>'sourceSetId', '')::uuid;
      if set_id_value is not null then
        update public.workout_sets workout_set
        set
          position = (set_item->>'position')::smallint,
          fact_weight_kg = nullif(set_item->>'weightKg', '')::numeric,
          fact_reps = nullif(set_item->>'reps', '')::integer,
          fact_duration_min = nullif(set_item->>'durationMin', '')::numeric,
          fact_duration_sec = nullif(set_item->>'durationSec', '')::integer,
          fact_distance_km = nullif(set_item->>'distanceKm', '')::numeric,
          fact_rpe = nullif(set_item->>'rpe', '')::numeric,
          confirmed_at = now(),
          updated_by = p_actor_id,
          version = workout_set.version + 1
        where workout_set.id = set_id_value
          and workout_set.workout_exercise_id = exercise_id_value;
        if not found then
          raise exception 'workout_invalid' using errcode = 'PT422';
        end if;
      else
        insert into public.workout_sets (
          workout_exercise_id, trainer_id, client_id, position,
          fact_weight_kg, fact_reps, fact_duration_min, fact_duration_sec,
          fact_distance_km, fact_rpe, confirmed_at, updated_by
        ) values (
          exercise_id_value,
          p_root_trainer_id,
          p_client_id,
          (set_item->>'position')::smallint,
          nullif(set_item->>'weightKg', '')::numeric,
          nullif(set_item->>'reps', '')::integer,
          nullif(set_item->>'durationMin', '')::numeric,
          nullif(set_item->>'durationSec', '')::integer,
          nullif(set_item->>'distanceKm', '')::numeric,
          nullif(set_item->>'rpe', '')::numeric,
          now(),
          p_actor_id
        );
      end if;
    end loop;
  end loop;

  set constraints public.workout_exercises_position_unique,
    public.workout_sets_position_unique immediate;
exception
  when check_violation
    or foreign_key_violation
    or unique_violation
    or invalid_text_representation
    or numeric_value_out_of_range
  then
    raise exception 'workout_invalid' using errcode = 'PT422';
end;
$$;

revoke all on function app_private.replace_completed_workout_fact(
  uuid, jsonb, uuid, text, uuid, uuid
) from public;

create or replace function public.save_completed_workout(
  p_workout jsonb,
  p_expected_version bigint default null
)
returns table (workout_id uuid, version bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id_value uuid := auth.uid();
  actor_role_value text;
  root_trainer_id_value uuid;
  requested_client_id_value uuid := nullif(p_workout->>'clientId', '')::uuid;
  client_id_value uuid;
  workout_id_value uuid := nullif(p_workout->>'id', '')::uuid;
  request_id_value uuid := nullif(p_workout->>'requestId', '')::uuid;
  existing_workout_id uuid;
  next_version bigint;
begin
  if workout_id_value is null then
    if request_id_value is not null then
      insert into app_private.workout_create_requests (actor_id, request_id)
      values (actor_id_value, request_id_value)
      on conflict (actor_id, request_id) do nothing;

      select request.workout_id into existing_workout_id
      from app_private.workout_create_requests request
      where request.actor_id = actor_id_value
        and request.request_id = request_id_value
      for update;

      if existing_workout_id is not null then
        return query
        select workout.id, workout.version
        from public.workouts workout
        where workout.id = existing_workout_id;
        return;
      end if;
    end if;

    select saved.workout_id, saved.version
    into workout_id_value, next_version
    from public.save_planned_workout(p_workout, null) saved;

    update public.workout_sets workout_set
    set
      fact_weight_kg = workout_set.plan_weight_kg,
      fact_reps = workout_set.plan_reps,
      fact_duration_min = workout_set.plan_duration_min,
      fact_duration_sec = workout_set.plan_duration_sec,
      fact_distance_km = workout_set.plan_distance_km,
      fact_rpe = workout_set.plan_rpe,
      confirmed_at = now(),
      updated_by = actor_id_value,
      version = workout_set.version + 1
    from public.workout_exercises exercise
    where exercise.id = workout_set.workout_exercise_id
      and exercise.workout_id = workout_id_value;

    update public.workouts workout
    set
      status = 'done',
      completed_at = now(),
      updated_by = actor_id_value,
      version = workout.version + 1
    where workout.id = workout_id_value
    returning workout.version into next_version;

    if request_id_value is not null then
      update app_private.workout_create_requests request
      set workout_id = workout_id_value
      where request.actor_id = actor_id_value
        and request.request_id = request_id_value;
    end if;

    return query select workout_id_value, next_version;
    return;
  end if;

  select access_check.actor_role,
    access_check.root_trainer_id,
    access_check.client_id
  into actor_role_value, root_trainer_id_value, client_id_value
  from app_private.authorize_workout_lifecycle(workout_id_value, false)
    as access_check;

  if requested_client_id_value is distinct from client_id_value then
    raise exception 'workout_invalid' using errcode = 'PT422';
  end if;

  update public.workouts workout
  set
    workout_date = (p_workout->>'workoutDate')::date,
    start_time = nullif(p_workout->>'startTime', '')::time,
    end_time = nullif(p_workout->>'endTime', '')::time,
    notes = nullif(btrim(p_workout->>'notes'), ''),
    updated_by = actor_id_value,
    version = workout.version + 1
  where workout.id = workout_id_value
    and workout.client_id = client_id_value
    and workout.status = 'done'
    and workout.deleted_at is null
    and workout.version = p_expected_version
  returning workout.version into next_version;

  if next_version is null then
    raise exception 'workout_conflict' using errcode = 'PT409';
  end if;

  perform app_private.replace_completed_workout_fact(
    workout_id_value,
    p_workout,
    actor_id_value,
    actor_role_value,
    root_trainer_id_value,
    client_id_value
  );

  return query select workout_id_value, next_version;
exception
  when check_violation
    or foreign_key_violation
    or unique_violation
    or invalid_text_representation
    or numeric_value_out_of_range
  then
    raise exception 'workout_invalid' using errcode = 'PT422';
end;
$$;

create or replace function public.record_planned_workout_result(
  p_workout jsonb,
  p_expected_version bigint
)
returns table (workout_id uuid, version bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  workout_id_value uuid := nullif(p_workout->>'id', '')::uuid;
  client_id_value uuid := nullif(p_workout->>'clientId', '')::uuid;
  transitioned_version bigint;
begin
  if workout_id_value is null or client_id_value is null then
    raise exception 'workout_invalid' using errcode = 'PT422';
  end if;

  perform 1
  from app_private.authorize_workout_lifecycle(workout_id_value, false);

  update public.workouts workout
  set
    status = 'done',
    completed_at = now(),
    updated_by = actor_id,
    version = workout.version + 1
  where workout.id = workout_id_value
    and workout.client_id = client_id_value
    and workout.status = 'planned'
    and workout.deleted_at is null
    and workout.version = p_expected_version
  returning workout.version into transitioned_version;

  if transitioned_version is null then
    raise exception 'workout_conflict' using errcode = 'PT409';
  end if;

  return query
  select saved.workout_id, saved.version
  from public.save_completed_workout(p_workout, transitioned_version) saved;
end;
$$;

create or replace function public.cancel_planned_workout(
  p_workout_id uuid,
  p_expected_version bigint
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  client_timezone text;
  today_value date;
  next_version bigint;
begin
  perform 1
  from app_private.authorize_workout_lifecycle(p_workout_id, true);

  select coalesce(
    case when exists (
      select 1 from pg_catalog.pg_timezone_names zone
      where zone.name = client_profile.timezone
    ) then client_profile.timezone end,
    case when exists (
      select 1 from pg_catalog.pg_timezone_names zone
      where zone.name = trainer_profile.timezone
    ) then trainer_profile.timezone end,
    'Europe/Moscow'
  )
  into client_timezone
  from public.workouts workout
  join public.clients client on client.id = workout.client_id
  left join public.profiles client_profile
    on client_profile.id = client.auth_user_id
  left join public.profiles trainer_profile
    on trainer_profile.id = client.trainer_id
  where workout.id = p_workout_id
    and workout.deleted_at is null;

  today_value := (now() at time zone client_timezone)::date;

  if not exists (
    select 1 from public.workouts workout
    where workout.id = p_workout_id
      and workout.deleted_at is null
      and workout.status = 'planned'
      and workout.workout_date < today_value
  ) then
    raise exception 'workout_not_resolvable' using errcode = 'PT422';
  end if;

  update public.workouts workout
  set
    status = 'cancelled',
    started_at = null,
    completed_at = null,
    updated_by = actor_id,
    version = workout.version + 1
  where workout.id = p_workout_id
    and workout.status = 'planned'
    and workout.workout_date < today_value
    and workout.deleted_at is null
    and workout.version = p_expected_version
  returning workout.version into next_version;

  if next_version is null then
    raise exception 'workout_conflict' using errcode = 'PT409';
  end if;
  return next_version;
end;
$$;

create or replace function public.reschedule_workout(
  p_workout_id uuid,
  p_workout_date date,
  p_start_time time,
  p_expected_version bigint
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  client_timezone text;
  today_value date;
  next_version bigint;
begin
  perform 1
  from app_private.authorize_workout_lifecycle(p_workout_id, true);

  select coalesce(
    case when exists (
      select 1 from pg_catalog.pg_timezone_names zone
      where zone.name = client_profile.timezone
    ) then client_profile.timezone end,
    case when exists (
      select 1 from pg_catalog.pg_timezone_names zone
      where zone.name = trainer_profile.timezone
    ) then trainer_profile.timezone end,
    'Europe/Moscow'
  )
  into client_timezone
  from public.workouts workout
  join public.clients client on client.id = workout.client_id
  left join public.profiles client_profile
    on client_profile.id = client.auth_user_id
  left join public.profiles trainer_profile
    on trainer_profile.id = client.trainer_id
  where workout.id = p_workout_id
    and workout.deleted_at is null;

  today_value := (now() at time zone client_timezone)::date;
  if p_workout_date is null or p_workout_date < today_value then
    raise exception 'workout_date_in_past' using errcode = 'PT422';
  end if;

  if not exists (
    select 1 from public.workouts workout
    where workout.id = p_workout_id
      and workout.deleted_at is null
      and (
        workout.status = 'cancelled'
        or (
          workout.status = 'planned'
          and workout.workout_date < today_value
        )
      )
  ) then
    raise exception 'workout_not_resolvable' using errcode = 'PT422';
  end if;

  update public.workouts workout
  set
    workout_date = p_workout_date,
    start_time = p_start_time,
    end_time = null,
    status = 'planned',
    started_at = null,
    completed_at = null,
    updated_by = actor_id,
    version = workout.version + 1
  where workout.id = p_workout_id
    and workout.deleted_at is null
    and workout.version = p_expected_version
    and (
      workout.status = 'cancelled'
      or (
        workout.status = 'planned'
        and workout.workout_date < today_value
      )
    )
  returning workout.version into next_version;

  if next_version is null then
    raise exception 'workout_conflict' using errcode = 'PT409';
  end if;
  return next_version;
end;
$$;

create or replace function public.set_client_workout_comment(
  p_workout_id uuid,
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
  next_version bigint;
begin
  if not exists (
    select 1
    from public.workouts workout
    join public.clients client on client.id = workout.client_id
    join public.profiles profile on profile.id = actor_id
    where workout.id = p_workout_id
      and workout.deleted_at is null
      and client.auth_user_id = actor_id
      and profile.account_role = 'client'
  ) then
    raise exception 'workout_forbidden' using errcode = 'PT403';
  end if;

  update public.workouts workout
  set
    client_comment = nullif(btrim(p_comment), ''),
    updated_by = actor_id,
    version = workout.version + 1
  where workout.id = p_workout_id
    and workout.deleted_at is null
    and workout.version = p_expected_version
  returning workout.version into next_version;

  if next_version is null then
    raise exception 'workout_conflict' using errcode = 'PT409';
  end if;
  return next_version;
end;
$$;

create or replace function public.soft_delete_workout(
  p_workout_id uuid,
  p_expected_version bigint
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  next_version bigint;
begin
  perform 1
  from app_private.authorize_workout_lifecycle(p_workout_id, false);

  update public.workouts workout
  set
    deleted_at = now(),
    updated_by = actor_id,
    version = workout.version + 1
  where workout.id = p_workout_id
    and workout.deleted_at is null
    and workout.version = p_expected_version
  returning workout.version into next_version;

  if next_version is null then
    raise exception 'workout_conflict' using errcode = 'PT409';
  end if;
  return next_version;
end;
$$;

revoke all on function public.save_completed_workout(jsonb, bigint) from public;
revoke all on function public.record_planned_workout_result(jsonb, bigint)
  from public;
revoke all on function public.cancel_planned_workout(uuid, bigint) from public;
revoke all on function public.reschedule_workout(uuid, date, time, bigint)
  from public;
revoke all on function public.set_client_workout_comment(uuid, text, bigint)
  from public;
revoke all on function public.soft_delete_workout(uuid, bigint) from public;

grant execute on function public.save_completed_workout(jsonb, bigint)
  to fit_api;
grant execute on function public.record_planned_workout_result(jsonb, bigint)
  to fit_api;
grant execute on function public.cancel_planned_workout(uuid, bigint)
  to fit_api;
grant execute on function public.reschedule_workout(uuid, date, time, bigint)
  to fit_api;
grant execute on function public.set_client_workout_comment(uuid, text, bigint)
  to fit_api;
grant execute on function public.soft_delete_workout(uuid, bigint)
  to fit_api;

-- Down Migration

revoke execute on function public.soft_delete_workout(uuid, bigint)
  from fit_api;
revoke execute on function public.set_client_workout_comment(uuid, text, bigint)
  from fit_api;
revoke execute on function public.reschedule_workout(uuid, date, time, bigint)
  from fit_api;
revoke execute on function public.cancel_planned_workout(uuid, bigint)
  from fit_api;
revoke execute on function public.record_planned_workout_result(jsonb, bigint)
  from fit_api;
revoke execute on function public.save_completed_workout(jsonb, bigint)
  from fit_api;

drop function public.soft_delete_workout(uuid, bigint);
drop function public.set_client_workout_comment(uuid, text, bigint);
drop function public.reschedule_workout(uuid, date, time, bigint);
drop function public.cancel_planned_workout(uuid, bigint);
drop function public.record_planned_workout_result(jsonb, bigint);
drop function public.save_completed_workout(jsonb, bigint);
drop function app_private.replace_completed_workout_fact(
  uuid, jsonb, uuid, text, uuid, uuid
);
drop function app_private.authorize_workout_lifecycle(uuid, boolean);

alter table public.workout_sets
  drop constraint workout_sets_position_unique,
  add constraint workout_sets_position_unique
    unique (workout_exercise_id, position);
alter table public.workout_exercises
  drop constraint workout_exercises_position_unique,
  add constraint workout_exercises_position_unique
    unique (workout_id, position);

drop table app_private.workout_create_requests;
alter table public.workouts drop column client_comment;
