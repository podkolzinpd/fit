-- Up Migration

alter table public.workouts
  add column started_by uuid references public.profiles(id) on delete set null,
  add column completed_by uuid references public.profiles(id) on delete set null;

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
    'start', p_workout_id, p_operation_id,
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
      started_by = actor_id,
      completed_by = null,
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
  perform app_private.complete_live_workout_operation(p_operation_id, next_version);
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
    'finish', p_workout_id, p_operation_id,
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
    completed_by = actor_id,
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
  perform app_private.complete_live_workout_operation(p_operation_id, next_version);
  return query select next_version, false;
end;
$$;

-- Down Migration

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
    'start', p_workout_id, p_operation_id,
    encode(sha256(convert_to(p_expected_version::text, 'UTF8')), 'hex')
  );
  if replayed_version is not null then
    return query select replayed_version, true;
    return;
  end if;
  begin
    update public.workouts workout
    set status = 'in_progress', started_at = now(), updated_by = actor_id,
      version = workout.version + 1
    where workout.id = p_workout_id and workout.status = 'planned'
      and workout.deleted_at is null and workout.version = p_expected_version
    returning workout.version into next_version;
  exception when unique_violation then
    raise exception 'active_workout_exists' using errcode = 'PT409';
  end;
  if next_version is null then
    raise exception 'workout_conflict' using errcode = 'PT409';
  end if;
  perform app_private.complete_live_workout_operation(p_operation_id, next_version);
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
    'finish', p_workout_id, p_operation_id,
    encode(sha256(convert_to(p_expected_version::text, 'UTF8')), 'hex')
  );
  if replayed_version is not null then
    return query select replayed_version, true;
    return;
  end if;
  update public.workouts workout
  set status = 'done', completed_at = now(), updated_by = actor_id,
    version = workout.version + 1
  where workout.id = p_workout_id and workout.status = 'in_progress'
    and workout.deleted_at is null and workout.version = p_expected_version
  returning workout.version into next_version;
  if next_version is null then
    raise exception 'workout_conflict' using errcode = 'PT409';
  end if;
  perform app_private.complete_live_workout_operation(p_operation_id, next_version);
  return query select next_version, false;
end;
$$;

alter table public.workouts
  drop column completed_by,
  drop column started_by;
