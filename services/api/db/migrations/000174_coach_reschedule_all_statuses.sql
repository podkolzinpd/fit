-- Up Migration
-- Calendar slot corrections are available in every lifecycle state.
-- Preserve ownership, active client, version, replay and archived/deleted guards.
create or replace function public.reschedule_workout(
  p_workout_id uuid, p_workout_date date, p_start_time time,
  p_expected_version bigint, p_end_time time, p_operation_id uuid
)
returns bigint language plpgsql security definer set search_path='' as $$
declare
  actor_id uuid := auth.uid();
  actor_role text;
  workout_row public.workouts;
  replayed_version bigint;
  next_version bigint;
begin
  select permission.actor_role into actor_role
    from app_private.authorize_workout_lifecycle(p_workout_id,false) permission;
  if actor_role is distinct from 'trainer' then
    raise exception 'workout_forbidden' using errcode='PT403';
  end if;
  if p_workout_date is null or p_expected_version is null or p_expected_version<1
    or (p_end_time is not null and (p_start_time is null or p_end_time=p_start_time)) then
    raise exception 'workout_invalid' using errcode='PT422';
  end if;
  replayed_version := app_private.claim_live_workout_operation(
    'reschedule',p_workout_id,p_operation_id,
    encode(sha256(convert_to(jsonb_build_array(p_workout_date,p_start_time,
      p_expected_version,p_end_time)::text,'UTF8')),'hex')
  );
  -- A disconnected/archived client cannot replay a formerly permitted command.
  select w.* into workout_row from public.workouts w
    join public.clients c on c.id=w.client_id
    where w.id=p_workout_id and w.deleted_at is null and c.archived_at is null
    for update of w;
  if workout_row.id is null then raise exception 'workout_forbidden' using errcode='PT403'; end if;
  if replayed_version is not null then return replayed_version; end if;
  if workout_row.version<>p_expected_version then raise exception 'workout_conflict' using errcode='PT409'; end if;
  -- A slot correction never changes lifecycle state, execution facts or finance.
  update public.workouts w set workout_date=p_workout_date,start_time=p_start_time,
    end_time=p_end_time,updated_by=actor_id,version=w.version+1
    where w.id=p_workout_id returning w.version into next_version;
  perform app_private.complete_live_workout_operation(p_operation_id,next_version,p_workout_id);
  return next_version;
end;
$$;
revoke all on function public.reschedule_workout(uuid,date,time,bigint,time,uuid) from public;
grant execute on function public.reschedule_workout(uuid,date,time,bigint,time,uuid) to fit_api;


-- Down Migration
-- Restore the previous planned-only rule without rewriting stored workouts.
create or replace function public.reschedule_workout(
  p_workout_id uuid, p_workout_date date, p_start_time time,
  p_expected_version bigint, p_end_time time, p_operation_id uuid
)
returns bigint language plpgsql security definer set search_path='' as $$
declare
  actor_id uuid := auth.uid();
  actor_role text;
  workout_row public.workouts;
  replayed_version bigint;
  next_version bigint;
begin
  select permission.actor_role into actor_role
    from app_private.authorize_workout_lifecycle(p_workout_id,false) permission;
  if actor_role is distinct from 'trainer' then
    raise exception 'workout_forbidden' using errcode='PT403';
  end if;
  if p_workout_date is null or p_expected_version is null or p_expected_version<1
    or (p_end_time is not null and (p_start_time is null or p_end_time=p_start_time)) then
    raise exception 'workout_invalid' using errcode='PT422';
  end if;
  replayed_version := app_private.claim_live_workout_operation(
    'reschedule',p_workout_id,p_operation_id,
    encode(sha256(convert_to(jsonb_build_array(p_workout_date,p_start_time,
      p_expected_version,p_end_time)::text,'UTF8')),'hex')
  );
  -- A disconnected/archived client cannot replay a formerly permitted command.
  select w.* into workout_row from public.workouts w
    join public.clients c on c.id=w.client_id
    where w.id=p_workout_id and w.deleted_at is null and c.archived_at is null
    for update of w;
  if workout_row.id is null then raise exception 'workout_forbidden' using errcode='PT403'; end if;
  if replayed_version is not null then return replayed_version; end if;
  if workout_row.version<>p_expected_version then raise exception 'workout_conflict' using errcode='PT409'; end if;
  if workout_row.status<>'planned' then raise exception 'workout_not_resolvable' using errcode='PT422'; end if;
  update public.workouts w set workout_date=p_workout_date,start_time=p_start_time,
    end_time=p_end_time,updated_by=actor_id,version=w.version+1
    where w.id=p_workout_id returning w.version into next_version;
  perform app_private.complete_live_workout_operation(p_operation_id,next_version,p_workout_id);
  return next_version;
end;
$$;
revoke all on function public.reschedule_workout(uuid,date,time,bigint,time,uuid) from public;
grant execute on function public.reschedule_workout(uuid,date,time,bigint,time,uuid) to fit_api;
