-- Up Migration

-- A client can have only one active workout regardless of which permitted
-- actor started it. Preserve every aggregate while making legacy duplicates
-- planned before the invariant is installed.
with ranked_active_workouts as (
  select
    id,
    row_number() over (
      partition by client_id
      order by started_at desc nulls last, updated_at desc, created_at desc, id
    ) as active_position
  from public.workouts
  where status = 'in_progress' and deleted_at is null
)
update public.workouts workout
set
  status = 'planned',
  started_at = null,
  version = workout.version + 1
from ranked_active_workouts ranked
where workout.id = ranked.id and ranked.active_position > 1;

create unique index workouts_one_active_per_client_uidx
  on public.workouts (client_id)
  where status = 'in_progress' and deleted_at is null;

-- A committed operation record makes an ambiguous network result safe to
-- retry. The same actor + operation UUID returns the original version, while
-- reusing the UUID for different input is rejected.
create table app_private.live_workout_operations (
  actor_id uuid not null references public.profiles (id) on delete cascade,
  operation_id uuid not null,
  action text not null,
  resource_id uuid not null,
  request_sha256 text not null,
  result_version bigint,
  created_at timestamptz not null default now(),
  primary key (actor_id, operation_id),
  constraint live_workout_operations_action_allowed check (
    action in ('start', 'save_set', 'confirm_set', 'finish')
  ),
  constraint live_workout_operations_result_positive check (
    result_version is null or result_version >= 1
  ),
  constraint live_workout_operations_request_sha256_format check (
    request_sha256 ~ '^[0-9a-f]{64}$'
  )
);

revoke all on app_private.live_workout_operations from public, fit_api;

create or replace function app_private.authorize_live_workout(
  p_workout_id uuid
)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_actor_id uuid := auth.uid();
  actor_role text;
  root_trainer_id uuid;
begin
  select profile.account_role
  into actor_role
  from public.profiles profile
  where profile.id = current_actor_id;

  select workout.trainer_id
  into root_trainer_id
  from public.workouts workout
  join public.clients client on client.id = workout.client_id
  where workout.id = p_workout_id
    and workout.deleted_at is null
    and client.archived_at is null
    and (
      (
        actor_role = 'trainer'
        and (
          workout.created_by = current_actor_id
          or (
            workout.created_by is null
            and workout.trainer_id = current_actor_id
          )
        )
        and (
          client.trainer_id = current_actor_id
          or exists (
            select 1
            from public.client_trainers membership
            where membership.client_id = client.id
              and membership.trainer_id = current_actor_id
          )
        )
      )
      or (
        actor_role = 'client'
        and client.auth_user_id = current_actor_id
      )
    );

  if root_trainer_id is null then
    raise exception 'workout_forbidden' using errcode = 'PT403';
  end if;
  return root_trainer_id;
end;
$$;

create or replace function app_private.claim_live_workout_operation(
  p_action text,
  p_resource_id uuid,
  p_operation_id uuid,
  p_request_sha256 text
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_actor_id uuid := auth.uid();
  stored_action text;
  stored_resource_id uuid;
  stored_request_sha256 text;
  stored_result bigint;
begin
  if current_actor_id is null then
    raise exception 'workout_forbidden' using errcode = 'PT403';
  end if;
  if p_operation_id is null
    or p_resource_id is null
    or p_request_sha256 !~ '^[0-9a-f]{64}$'
    or p_action not in ('start', 'save_set', 'confirm_set', 'finish')
  then
    raise exception 'workout_invalid' using errcode = 'PT422';
  end if;

  delete from app_private.live_workout_operations operation
  where operation.actor_id = current_actor_id
    and operation.created_at < now() - interval '30 days';

  insert into app_private.live_workout_operations (
    actor_id, operation_id, action, resource_id, request_sha256
  ) values (
    current_actor_id, p_operation_id, p_action, p_resource_id, p_request_sha256
  )
  on conflict (actor_id, operation_id) do nothing;

  select
    operation.action,
    operation.resource_id,
    operation.request_sha256,
    operation.result_version
  into
    stored_action,
    stored_resource_id,
    stored_request_sha256,
    stored_result
  from app_private.live_workout_operations operation
  where operation.actor_id = current_actor_id
    and operation.operation_id = p_operation_id
  for update;

  if stored_action is distinct from p_action
    or stored_resource_id is distinct from p_resource_id
    or stored_request_sha256 is distinct from p_request_sha256
  then
    raise exception 'operation_reused' using errcode = 'PT422';
  end if;

  return stored_result;
end;
$$;

create or replace function app_private.complete_live_workout_operation(
  p_operation_id uuid,
  p_result_version bigint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update app_private.live_workout_operations operation
  set result_version = p_result_version
  where operation.actor_id = auth.uid()
    and operation.operation_id = p_operation_id
    and operation.result_version is null;

  if not found then
    raise exception 'operation_reused' using errcode = 'PT422';
  end if;
end;
$$;

revoke all on function app_private.authorize_live_workout(uuid)
  from public, fit_api;
revoke all on function app_private.claim_live_workout_operation(
  text, uuid, uuid, text
) from public, fit_api;
revoke all on function app_private.complete_live_workout_operation(uuid, bigint)
  from public, fit_api;

create or replace function public.start_live_workout(
  p_workout_id uuid,
  p_expected_version bigint,
  p_operation_id uuid
)
returns table (version bigint, replayed boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  replayed_version bigint;
  next_version bigint;
begin
  perform app_private.authorize_live_workout(p_workout_id);
  replayed_version := app_private.claim_live_workout_operation(
    'start',
    p_workout_id,
    p_operation_id,
    encode(sha256(convert_to(p_expected_version::text, 'UTF8')), 'hex')
  );
  if replayed_version is not null then
    return query select replayed_version, true;
    return;
  end if;

  begin
    update public.workouts workout
    set
      status = 'in_progress',
      started_at = now(),
      updated_by = actor_id,
      version = workout.version + 1
    where workout.id = p_workout_id
      and workout.status = 'planned'
      and workout.deleted_at is null
      and workout.version = p_expected_version
    returning workout.version into next_version;
  exception
    when unique_violation then
      raise exception 'active_workout_exists' using errcode = 'PT409';
  end;

  if next_version is null then
    raise exception 'workout_conflict' using errcode = 'PT409';
  end if;
  perform app_private.complete_live_workout_operation(
    p_operation_id, next_version
  );
  return query select next_version, false;
end;
$$;

create or replace function public.save_live_set_draft(
  p_set_id uuid,
  p_draft jsonb,
  p_expected_version bigint,
  p_operation_id uuid
)
returns table (version bigint, replayed boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  workout_id_value uuid;
  replayed_version bigint;
  next_version bigint;
begin
  select exercise.workout_id
  into workout_id_value
  from public.workout_sets workout_set
  join public.workout_exercises exercise
    on exercise.id = workout_set.workout_exercise_id
  where workout_set.id = p_set_id;
  perform app_private.authorize_live_workout(workout_id_value);
  replayed_version := app_private.claim_live_workout_operation(
    'save_set',
    p_set_id,
    p_operation_id,
    encode(sha256(convert_to(
      p_expected_version::text || ':' || p_draft::text,
      'UTF8'
    )), 'hex')
  );
  if replayed_version is not null then
    return query select replayed_version, true;
    return;
  end if;

  perform 1
  from public.workouts workout
  where workout.id = workout_id_value
    and workout.status = 'in_progress'
    and workout.deleted_at is null
  for update;
  if not found then
    raise exception 'workout_conflict' using errcode = 'PT409';
  end if;

  update public.workout_sets workout_set
  set
    fact_weight_kg = nullif(p_draft->>'weightKg', '')::numeric,
    fact_reps = nullif(p_draft->>'reps', '')::integer,
    fact_duration_min = nullif(p_draft->>'durationMin', '')::numeric,
    fact_duration_sec = coalesce(
      nullif(p_draft->>'durationSec', '')::integer,
      round(nullif(p_draft->>'durationMin', '')::numeric * 60)::integer
    ),
    fact_distance_km = nullif(p_draft->>'distanceKm', '')::numeric,
    fact_rpe = nullif(p_draft->>'rpe', '')::numeric,
    updated_by = actor_id,
    version = workout_set.version + 1
  where workout_set.id = p_set_id
    and workout_set.version = p_expected_version
  returning workout_set.version into next_version;

  if next_version is null then
    raise exception 'live_set_conflict' using errcode = 'PT409';
  end if;
  perform app_private.complete_live_workout_operation(
    p_operation_id, next_version
  );
  return query select next_version, false;
exception
  when check_violation
    or invalid_text_representation
    or numeric_value_out_of_range
  then
    raise exception 'workout_invalid' using errcode = 'PT422';
end;
$$;

create or replace function public.confirm_live_set(
  p_set_id uuid,
  p_expected_version bigint,
  p_operation_id uuid
)
returns table (version bigint, replayed boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  workout_id_value uuid;
  replayed_version bigint;
  next_version bigint;
begin
  select exercise.workout_id
  into workout_id_value
  from public.workout_sets workout_set
  join public.workout_exercises exercise
    on exercise.id = workout_set.workout_exercise_id
  where workout_set.id = p_set_id;
  perform app_private.authorize_live_workout(workout_id_value);
  replayed_version := app_private.claim_live_workout_operation(
    'confirm_set',
    p_set_id,
    p_operation_id,
    encode(sha256(convert_to(p_expected_version::text, 'UTF8')), 'hex')
  );
  if replayed_version is not null then
    return query select replayed_version, true;
    return;
  end if;

  perform 1
  from public.workouts workout
  where workout.id = workout_id_value
    and workout.status = 'in_progress'
    and workout.deleted_at is null
  for update;
  if not found then
    raise exception 'workout_conflict' using errcode = 'PT409';
  end if;

  if not exists (
    select 1
    from public.workout_sets workout_set
    where workout_set.id = p_set_id
      and workout_set.version = p_expected_version
  ) then
    raise exception 'live_set_conflict' using errcode = 'PT409';
  end if;

  if not exists (
    select 1
    from public.workout_sets workout_set
    where workout_set.id = p_set_id
      and coalesce(
        workout_set.fact_weight_kg,
        workout_set.fact_reps,
        workout_set.fact_duration_min,
        workout_set.fact_duration_sec,
        workout_set.fact_distance_km,
        workout_set.fact_rpe,
        workout_set.plan_weight_kg,
        workout_set.plan_reps,
        workout_set.plan_duration_min,
        workout_set.plan_duration_sec,
        workout_set.plan_distance_km,
        workout_set.plan_rpe
      ) is not null
  ) then
    raise exception 'live_set_empty' using errcode = 'PT422';
  end if;

  update public.workout_sets workout_set
  set
    confirmed_at = now(),
    fact_weight_kg = coalesce(
      workout_set.fact_weight_kg, workout_set.plan_weight_kg
    ),
    fact_reps = coalesce(workout_set.fact_reps, workout_set.plan_reps),
    fact_duration_min = coalesce(
      workout_set.fact_duration_min, workout_set.plan_duration_min
    ),
    fact_duration_sec = coalesce(
      workout_set.fact_duration_sec,
      workout_set.plan_duration_sec,
      round(workout_set.fact_duration_min * 60)::integer,
      round(workout_set.plan_duration_min * 60)::integer
    ),
    fact_distance_km = coalesce(
      workout_set.fact_distance_km, workout_set.plan_distance_km
    ),
    fact_rpe = coalesce(workout_set.fact_rpe, workout_set.plan_rpe),
    updated_by = actor_id,
    version = workout_set.version + 1
  where workout_set.id = p_set_id
    and workout_set.version = p_expected_version
  returning workout_set.version into next_version;

  if next_version is null then
    raise exception 'live_set_conflict' using errcode = 'PT409';
  end if;
  perform app_private.complete_live_workout_operation(
    p_operation_id, next_version
  );
  return query select next_version, false;
end;
$$;

create or replace function public.finish_live_workout(
  p_workout_id uuid,
  p_expected_version bigint,
  p_operation_id uuid
)
returns table (version bigint, replayed boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  replayed_version bigint;
  next_version bigint;
begin
  perform app_private.authorize_live_workout(p_workout_id);
  replayed_version := app_private.claim_live_workout_operation(
    'finish',
    p_workout_id,
    p_operation_id,
    encode(sha256(convert_to(p_expected_version::text, 'UTF8')), 'hex')
  );
  if replayed_version is not null then
    return query select replayed_version, true;
    return;
  end if;

  update public.workouts workout
  set
    status = 'done',
    completed_at = now(),
    updated_by = actor_id,
    version = workout.version + 1
  where workout.id = p_workout_id
    and workout.status = 'in_progress'
    and workout.deleted_at is null
    and workout.version = p_expected_version
  returning workout.version into next_version;

  if next_version is null then
    raise exception 'workout_conflict' using errcode = 'PT409';
  end if;
  perform app_private.complete_live_workout_operation(
    p_operation_id, next_version
  );
  return query select next_version, false;
end;
$$;

revoke all on function public.start_live_workout(uuid, bigint, uuid)
  from public;
revoke all on function public.save_live_set_draft(uuid, jsonb, bigint, uuid)
  from public;
revoke all on function public.confirm_live_set(uuid, bigint, uuid)
  from public;
revoke all on function public.finish_live_workout(uuid, bigint, uuid)
  from public;
grant execute on function public.start_live_workout(uuid, bigint, uuid)
  to fit_api;
grant execute on function public.save_live_set_draft(uuid, jsonb, bigint, uuid)
  to fit_api;
grant execute on function public.confirm_live_set(uuid, bigint, uuid)
  to fit_api;
grant execute on function public.finish_live_workout(uuid, bigint, uuid)
  to fit_api;

-- Down Migration

revoke execute on function public.finish_live_workout(uuid, bigint, uuid)
  from fit_api;
revoke execute on function public.confirm_live_set(uuid, bigint, uuid)
  from fit_api;
revoke execute on function public.save_live_set_draft(uuid, jsonb, bigint, uuid)
  from fit_api;
revoke execute on function public.start_live_workout(uuid, bigint, uuid)
  from fit_api;
drop function public.finish_live_workout(uuid, bigint, uuid);
drop function public.confirm_live_set(uuid, bigint, uuid);
drop function public.save_live_set_draft(uuid, jsonb, bigint, uuid);
drop function public.start_live_workout(uuid, bigint, uuid);
drop function app_private.complete_live_workout_operation(uuid, bigint);
drop function app_private.claim_live_workout_operation(text, uuid, uuid, text);
drop function app_private.authorize_live_workout(uuid);
drop table app_private.live_workout_operations;
drop index public.workouts_one_active_per_client_uidx;
