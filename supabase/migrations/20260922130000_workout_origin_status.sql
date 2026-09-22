-- Third client-authored workout status: origin distinguishes a workout the
-- client typed themselves from one an assistant-generated program created.
-- Written once at creation (only in the insert branch below), never updated
-- - no "AI, but edited" intermediate state by design. The trainer-authored
-- branch never reads this column at all.
alter table public.workouts
  add column origin text not null default 'manual'
    check (origin in ('manual', 'ai'));

-- Backfill: workouts already created by an applied create_program_draft/
-- schedule_program assistant action are retroactively AI-authored. Anything
-- else (including record_workout - the client dictating an already-done
-- workout, not an AI-authored plan) stays at the 'manual' default.
update public.workouts workout
set origin = 'ai'
from public.assistant_actions action,
  jsonb_array_elements_text(action.result->'workoutIds') as workout_id
where action.status = 'applied'
  and action.tool in ('create_program_draft', 'schedule_program')
  and workout.id = workout_id::uuid;

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
      trainer_id, client_id, workout_date, start_time, end_time, notes, stage_id, origin
    ) values (
      actor_id, client_id_value, (p_workout->>'workoutDate')::date,
      nullif(p_workout->>'startTime', '')::time,
      nullif(p_workout->>'endTime', '')::time,
      nullif(btrim(p_workout->>'notes'), ''), stage_id_value,
      case when p_workout->>'origin' = 'ai' then 'ai' else 'manual' end
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

create or replace function public.apply_assistant_action(
  p_action_id uuid,
  p_input jsonb default '{}'::jsonb,
  p_expected_version bigint default 1
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_role text;
  actor_client_id uuid;
  action_row public.assistant_actions;
  workout_item jsonb;
  workout_id uuid;
  workout_ids jsonb := '[]'::jsonb;
  created_id uuid;
  error_text text;
begin
  if actor_id is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;
  select account_role into actor_role from public.profiles where id = actor_id;
  if actor_role = 'trainer' then
    if not exists (select 1 from public.trainers where profile_id = actor_id) then
      raise exception 'assistant_trainer_required' using errcode = 'PT403';
    end if;
  elsif actor_role = 'client' then
    select id into actor_client_id
    from public.clients
    where auth_user_id = actor_id and archived_at is null
    limit 1;
    if actor_client_id is null then
      raise exception 'assistant_client_card_required' using errcode = 'PT403';
    end if;
  else
    raise exception 'assistant_role_required' using errcode = 'PT403';
  end if;

  select * into action_row
  from public.assistant_actions
  where id = p_action_id and owner_id = actor_id
  for update;
  if not found then
    raise exception 'assistant_action_not_found' using errcode = 'PT404';
  end if;
  if actor_role = 'client' and (
    action_row.tool not in ('record_workout', 'create_program_draft', 'schedule_program')
    or nullif(action_row.payload->>'clientId', '')::uuid is distinct from actor_client_id
    or (
      action_row.tool in ('create_program_draft', 'schedule_program')
      and action_row.payload->>'schemaVersion' is distinct from 'program-v1'
    )
  ) then
    raise exception 'assistant_action_forbidden' using errcode = 'PT403';
  end if;
  if action_row.status = 'applied' then
    return coalesce(action_row.result, jsonb_build_object('status', 'applied'));
  end if;
  if action_row.status not in ('proposed', 'failed') or action_row.version <> p_expected_version then
    raise exception 'assistant_action_conflict' using errcode = 'PT409';
  end if;

  update public.assistant_actions
  set status = 'applying', updated_at = now(), error_code = null
  where id = action_row.id;

  begin
    if action_row.tool = 'record_workout' then
      workout_item := p_input->'workout';
      if jsonb_typeof(workout_item) <> 'object'
        or nullif(workout_item->>'clientId', '') is null
        or nullif(workout_item->>'requestId', '') is null
        or jsonb_typeof(workout_item->'exercises') <> 'array'
        or jsonb_array_length(workout_item->'exercises') < 1
        or (workout_item->>'clientId')::uuid <> (action_row.payload->>'clientId')::uuid then
        raise exception 'assistant_workout_invalid' using errcode = 'PT422';
      end if;
      -- No 'ai' origin here: the client is dictating a workout they already
      -- did, not applying an AI-authored plan (see design doc part 1).
      workout_id := public.save_completed_workout(workout_item, null);
      update public.assistant_actions
      set status = 'applied', result = jsonb_build_object('status', 'applied', 'workoutId', workout_id),
          version = version + 1, updated_at = now(), applied_at = now()
      where id = action_row.id;
      return jsonb_build_object('status', 'applied', 'workoutId', workout_id, 'version', action_row.version + 1);
    elsif action_row.tool = 'create_program_draft' or action_row.tool = 'schedule_program' then
      if jsonb_typeof(p_input->'workouts') is distinct from 'array'
        or jsonb_array_length(p_input->'workouts') < 1
        or jsonb_array_length(p_input->'workouts') > 12 then
        raise exception 'assistant_program_invalid' using errcode = 'PT422';
      end if;

      if action_row.payload->>'schemaVersion' = 'program-v1' then
        perform 1 from public.clients where id = (action_row.payload->>'clientId')::uuid for update;
        if jsonb_array_length(p_input->'workouts') not in (4, 8, 12)
          or p_input->'workouts' is distinct from action_row.payload->'canonicalWorkouts'
          or nullif(action_row.payload->>'sourceCapturedAt', '') is null
          or (action_row.payload->>'sourceCapturedAt')::timestamptz < now() - interval '24 hours'
        then
          raise exception 'assistant_program_requires_validation' using errcode = 'PT422';
        end if;
        if exists (
          select 1 from public.workouts workout
          where workout.client_id = (action_row.payload->>'clientId')::uuid
            and workout.updated_at > (action_row.payload->>'sourceCapturedAt')::timestamptz
        ) or exists (
          select 1 from public.clients client
          where client.id = (action_row.payload->>'clientId')::uuid
            and client.updated_at > (action_row.payload->>'sourceCapturedAt')::timestamptz
        ) then
          raise exception 'assistant_program_source_changed' using errcode = 'PT409';
        end if;
      elsif jsonb_array_length(p_input->'workouts') > 4 then
        raise exception 'assistant_program_invalid' using errcode = 'PT422';
      end if;

      for workout_item in select value from jsonb_array_elements(p_input->'workouts')
      loop
        if jsonb_typeof(workout_item) <> 'object'
          or nullif(workout_item->>'clientId', '') is null
          or nullif(workout_item->>'requestId', '') is null
          or jsonb_typeof(workout_item->'exercises') <> 'array'
          or jsonb_array_length(workout_item->'exercises') < 1 then
          raise exception 'assistant_program_invalid' using errcode = 'PT422';
        end if;
        if (workout_item->>'clientId')::uuid <> (action_row.payload->>'clientId')::uuid then
          raise exception 'assistant_action_client_mismatch' using errcode = 'PT403';
        end if;
        -- The assistant authored this workout as part of a generated
        -- program - the one place origin='ai' is legitimate.
        workout_id := public.save_workout(workout_item || jsonb_build_object('origin', 'ai'), null);
        workout_ids := workout_ids || jsonb_build_array(workout_id);
      end loop;
      update public.assistant_actions
      set status = 'applied', result = jsonb_build_object('status', 'applied', 'workoutIds', workout_ids),
          version = version + 1, updated_at = now(), applied_at = now()
      where id = action_row.id;
      return jsonb_build_object('status', 'applied', 'workoutIds', workout_ids, 'version', action_row.version + 1);
    elsif action_row.tool = 'create_client_draft' then
      if jsonb_typeof(p_input) <> 'object' or nullif(btrim(p_input->>'fullName'), '') is null then
        raise exception 'assistant_client_invalid' using errcode = 'PT422';
      end if;
      created_id := public.create_client(p_input);
      update public.assistant_actions
      set status = 'applied', result = jsonb_build_object('status', 'applied', 'clientId', created_id),
          version = version + 1, updated_at = now(), applied_at = now()
      where id = action_row.id;
      return jsonb_build_object('status', 'applied', 'clientId', created_id, 'version', action_row.version + 1);
    else
      raise exception 'assistant_action_external_only' using errcode = 'PT422';
    end if;
  exception when others then
    get stacked diagnostics error_text = message_text;
    update public.assistant_actions
    set status = 'failed', error_code = 'assistant_action_failed', updated_at = now()
    where id = action_row.id;
    return jsonb_build_object('status', 'failed', 'errorCode', 'assistant_action_failed', 'version', action_row.version);
  end;
end;
$$;

-- RETURNS TABLE column list is changing (new origin column), which
-- CREATE OR REPLACE cannot do - drop first.
drop function public.list_workouts(date, date, uuid, integer, integer);

create function public.list_workouts(p_from date default null::date, p_to date default null::date, p_client_id uuid default null::uuid, p_limit integer default 50, p_offset integer default 0)
returns table(id uuid, client_id uuid, trainer_id uuid, client_name text, created_by uuid, origin text, started_by uuid, completed_by uuid, workout_date date, start_time time without time zone, end_time time without time zone, started_at timestamp with time zone, completed_at timestamp with time zone, status text, notes text, trainer_review text, trainer_reaction text, trainer_review_author_id uuid, trainer_reviewed_at timestamp with time zone, client_comment text, session_rpe smallint, wellbeing text, discomfort boolean, active_calories_kcal integer, has_pr boolean, version bigint, stage_id uuid, stage_title text, total_count bigint, exercises jsonb)
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
      workout.created_by, workout.origin, workout.started_by, workout.completed_by,
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
    workout.created_by, workout.origin, workout.started_by, workout.completed_by,
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

-- DROP FUNCTION above reset grants to nothing - restore the standing
-- convention for this function (redone after every prior redefinition).
revoke all on function public.list_workouts(date, date, uuid, integer, integer)
  from public, anon;
grant execute on function public.list_workouts(date, date, uuid, integer, integer)
  to authenticated;
