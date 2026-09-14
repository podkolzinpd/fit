-- Up Migration

create or replace function app_private.normalize_workout_custom_exercises(
  p_workout jsonb,
  p_owner_id uuid,
  p_actor_id uuid,
  p_preserve_linked_exercises boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  exercise_item jsonb;
  effective_exercise jsonb;
  effective_exercises jsonb := '[]'::jsonb;
  custom_exercise_id_value uuid;
  custom_exercise_record record;
begin
  for exercise_item in
    select value
    from jsonb_array_elements(coalesce(p_workout->'exercises', '[]'::jsonb))
  loop
    effective_exercise := exercise_item;

    if exercise_item->>'source' = 'custom'
      and not (
        p_preserve_linked_exercises
        and nullif(exercise_item->>'sourceExerciseId', '') is not null
        and not coalesce((exercise_item->>'clearFact')::boolean, false)
      )
    then
      custom_exercise_id_value := nullif(
        exercise_item->>'customExerciseId',
        ''
      )::uuid;

      if custom_exercise_id_value is null
        or exercise_item->>'ref' not in (
          custom_exercise_id_value::text,
          'custom:' || custom_exercise_id_value::text
        )
      then
        raise exception 'workout_invalid' using errcode = 'PT422';
      end if;

      select
        custom_exercise.trainer_id,
        custom_exercise.name,
        custom_exercise.muscle_group,
        custom_exercise.input_kind
      into custom_exercise_record
      from public.custom_exercises custom_exercise
      where custom_exercise.id = custom_exercise_id_value
        and custom_exercise.archived_at is null
        and (
          custom_exercise.created_by = p_actor_id
          or custom_exercise.trainer_id = p_actor_id
          or exists (
            select 1
            from public.clients client
            where client.auth_user_id = custom_exercise.created_by
              and client.trainer_id = custom_exercise.trainer_id
              and public.can_access_client(client.id)
          )
          or (
            custom_exercise.created_by = custom_exercise.trainer_id
            and exists (
              select 1
              from public.clients client
              where client.auth_user_id = p_actor_id
                and client.trainer_id = custom_exercise.trainer_id
                and client.archived_at is null
            )
          )
        );

      if not found then
        raise exception 'exercise_not_found' using errcode = 'PT404';
      end if;

      if custom_exercise_record.trainer_id = p_owner_id then
        effective_exercise := effective_exercise || jsonb_build_object(
          'source', 'custom',
          'customExerciseId', custom_exercise_id_value::text,
          'name', custom_exercise_record.name,
          'muscleGroup', custom_exercise_record.muscle_group,
          'inputKind', custom_exercise_record.input_kind
        );
      else
        effective_exercise := effective_exercise || jsonb_build_object(
          'source', 'system',
          'ref', 'snapshot:custom:' || custom_exercise_id_value::text,
          'customExerciseId', null,
          'name', custom_exercise_record.name,
          'muscleGroup', custom_exercise_record.muscle_group,
          'inputKind', custom_exercise_record.input_kind
        );
      end if;
    end if;

    effective_exercises := effective_exercises || jsonb_build_array(effective_exercise);
  end loop;

  return jsonb_set(p_workout, '{exercises}', effective_exercises, true);
end;
$$;

revoke all on function app_private.normalize_workout_custom_exercises(
  jsonb, uuid, uuid, boolean
) from public;

alter function public.save_planned_workout(jsonb, bigint)
  rename to save_planned_workout_without_cross_partition_snapshots;
alter function public.save_planned_workout_without_cross_partition_snapshots(
  jsonb, bigint
) set schema app_private;
revoke all on function app_private.save_planned_workout_without_cross_partition_snapshots(
  jsonb, bigint
) from public;

create or replace function public.save_planned_workout(
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
  client_id_value uuid := nullif(p_workout->>'clientId', '')::uuid;
  owner_id_value uuid;
  effective_workout jsonb;
begin
  select profile.account_role into actor_role_value
  from public.profiles profile
  where profile.id = actor_id_value;

  select client.trainer_id into owner_id_value
  from public.clients client
  where client.id = client_id_value
    and client.archived_at is null
    and (
      (
        actor_role_value = 'trainer'
        and (
          client.trainer_id = actor_id_value
          or exists (
            select 1
            from public.client_trainers membership
            where membership.client_id = client.id
              and membership.trainer_id = actor_id_value
          )
        )
      )
      or (
        actor_role_value = 'client'
        and client.auth_user_id = actor_id_value
      )
    );

  if owner_id_value is null then
    raise exception 'workout_forbidden' using errcode = 'PT403';
  end if;

  effective_workout := app_private.normalize_workout_custom_exercises(
    p_workout,
    owner_id_value,
    actor_id_value,
    false
  );

  return query
  select saved.workout_id, saved.version
  from app_private.save_planned_workout_without_cross_partition_snapshots(
    effective_workout,
    p_expected_version
  ) saved;
end;
$$;

revoke all on function public.save_planned_workout(jsonb, bigint) from public;
grant execute on function public.save_planned_workout(jsonb, bigint) to fit_api;

alter function app_private.replace_completed_workout_fact(
  uuid, jsonb, uuid, text, uuid, uuid
) rename to replace_completed_workout_fact_without_cross_partition_snapshots;

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
begin
  perform app_private.replace_completed_workout_fact_without_cross_partition_snapshots(
    p_workout_id,
    app_private.normalize_workout_custom_exercises(
      p_workout,
      p_root_trainer_id,
      p_actor_id,
      true
    ),
    p_actor_id,
    p_actor_role,
    p_root_trainer_id,
    p_client_id
  );
end;
$$;

revoke all on function app_private.replace_completed_workout_fact(
  uuid, jsonb, uuid, text, uuid, uuid
) from public;
revoke all on function app_private.replace_completed_workout_fact_without_cross_partition_snapshots(
  uuid, jsonb, uuid, text, uuid, uuid
) from public;

alter function public.attach_workout_stage(uuid, uuid)
  rename to attach_workout_stage_without_shared_trainer_access;
alter function public.attach_workout_stage_without_shared_trainer_access(
  uuid, uuid
) set schema app_private;
revoke all on function app_private.attach_workout_stage_without_shared_trainer_access(
  uuid, uuid
) from public;

create or replace function public.attach_workout_stage(
  p_workout_id uuid,
  p_stage_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  client_id_value uuid;
begin
  select access_check.client_id into client_id_value
  from app_private.authorize_workout_lifecycle(p_workout_id, false)
    as access_check;

  if p_stage_id is not null and not exists (
    select 1
    from public.goal_stages stage
    join public.client_goals goal on goal.id = stage.goal_id
    where stage.id = p_stage_id
      and goal.client_id = client_id_value
      and goal.status = 'active'
  ) then
    raise exception 'workout_invalid' using errcode = 'PT422';
  end if;

  update public.workouts
  set stage_id = p_stage_id
  where id = p_workout_id
    and deleted_at is null;

  if not found then
    raise exception 'workout_invalid' using errcode = 'PT422';
  end if;
end;
$$;

revoke all on function public.attach_workout_stage(uuid, uuid) from public;
grant execute on function public.attach_workout_stage(uuid, uuid) to fit_api;

-- Down Migration

revoke execute on function public.attach_workout_stage(uuid, uuid)
  from fit_api;
drop function public.attach_workout_stage(uuid, uuid);
alter function app_private.attach_workout_stage_without_shared_trainer_access(
  uuid, uuid
) set schema public;
alter function public.attach_workout_stage_without_shared_trainer_access(
  uuid, uuid
) rename to attach_workout_stage;
grant execute on function public.attach_workout_stage(uuid, uuid) to fit_api;

drop function app_private.replace_completed_workout_fact(
  uuid, jsonb, uuid, text, uuid, uuid
);
alter function app_private.replace_completed_workout_fact_without_cross_partition_snapshots(
  uuid, jsonb, uuid, text, uuid, uuid
) rename to replace_completed_workout_fact;

revoke execute on function public.save_planned_workout(jsonb, bigint)
  from fit_api;
drop function public.save_planned_workout(jsonb, bigint);
alter function app_private.save_planned_workout_without_cross_partition_snapshots(
  jsonb, bigint
) set schema public;
alter function public.save_planned_workout_without_cross_partition_snapshots(
  jsonb, bigint
) rename to save_planned_workout;
grant execute on function public.save_planned_workout(jsonb, bigint) to fit_api;

drop function app_private.normalize_workout_custom_exercises(
  jsonb, uuid, uuid, boolean
);
