-- Up Migration

-- The existing finish operation owns both strict Live and explicit attendance.
create or replace function app_private.finish_live_workout_without_pause(
  p_workout_id uuid, p_expected_version bigint, p_operation_id uuid,
  p_attendance boolean, p_disposition text, p_package_id uuid
)
returns table(version bigint, replayed boolean)
language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  replayed_version bigint;
  next_version bigint;
  workout_row public.workouts;
  finance_row public.trainer_finance_sessions;
begin
  if p_attendance is null then raise exception 'workout_invalid' using errcode='PT422'; end if;
  if p_attendance then
    if not exists(select 1 from public.profiles where id=actor_id and account_role='trainer') then
      raise exception 'workout_forbidden' using errcode='PT403';
    end if;
    perform 1 from app_private.authorize_workout_lifecycle(p_workout_id, false);
    if p_disposition is null or p_disposition not in ('auto','charged','unassigned','free','trial')
      or ((p_disposition='charged') <> (p_package_id is not null)) then
      raise exception 'workout_invalid' using errcode='PT422';
    end if;
  else
    perform app_private.authorize_live_workout(p_workout_id);
    if p_disposition is not null or p_package_id is not null then
      raise exception 'workout_invalid' using errcode='PT422';
    end if;
  end if;

  replayed_version := app_private.claim_live_workout_operation(
    'finish', p_workout_id, p_operation_id,
    encode(sha256(convert_to(case when p_attendance then
      'attendance:' || p_expected_version::text || ':' || p_disposition || ':' || coalesce(p_package_id::text,'')
      else p_expected_version::text end, 'UTF8')), 'hex')
  );
  if replayed_version is not null then return query select replayed_version,true; return; end if;

  select w.* into workout_row from public.workouts w
  join public.clients c on c.id=w.client_id
  where w.id=p_workout_id and w.deleted_at is null and c.archived_at is null
  for update of w;
  if workout_row.id is null then raise exception 'workout_forbidden' using errcode='PT403'; end if;
  if workout_row.version<>p_expected_version then raise exception 'workout_conflict' using errcode='PT409'; end if;
  if p_attendance then
    if workout_row.status not in ('planned','in_progress') then
      raise exception 'workout_conflict' using errcode='PT409';
    end if;
    if exists(select 1 from public.workout_exercises where workout_id=p_workout_id)
      or (workout_row.training_format<>'with_trainer' and p_disposition<>'auto') then
      raise exception 'workout_invalid' using errcode='PT422';
    end if;
  else
    if workout_row.status<>'in_progress' then raise exception 'workout_conflict' using errcode='PT409'; end if;
    if not exists(select 1 from public.workout_exercises where workout_id=p_workout_id) then
      raise exception 'workout_invalid' using errcode='PT422';
    end if;
  end if;

  update public.workouts w set status='done',completed_at=now(),completed_by=actor_id,
    updated_by=actor_id,version=w.version+1
  where w.id=p_workout_id returning w.version into next_version;

  -- Existing finance sync creates the normal automatic charge. An explicit
  -- override uses the existing validated updater in this same transaction.
  if p_attendance and p_disposition<>'auto' then
    if app_private.workout_finance_trainer(p_workout_id) is distinct from actor_id then
      raise exception 'workout_forbidden' using errcode='PT403';
    end if;
    insert into public.trainer_finance_sessions(workout_id,trainer_id,client_id,disposition,source)
      values(p_workout_id,actor_id,workout_row.client_id,'unassigned','automatic') on conflict do nothing;
    select s.* into finance_row from public.trainer_finance_sessions s
      where s.workout_id=p_workout_id and s.trainer_id=actor_id and s.voided_at is null;
    if finance_row.id is null then raise exception 'workout_invalid' using errcode='PT422'; end if;
    perform public.update_trainer_finance_session_details_v2(finance_row.id,finance_row.version,
      p_disposition,p_package_id,null,workout_row.workout_date);
  end if;
  perform app_private.complete_live_workout_operation(p_operation_id,next_version);
  return query select next_version,false;
end;
$$;
revoke all on function app_private.finish_live_workout_without_pause(uuid,bigint,uuid,boolean,text,uuid) from public,fit_api;

create or replace function app_private.finish_live_workout_without_pause(
  p_workout_id uuid,p_expected_version bigint,p_operation_id uuid
)
returns table(version bigint,replayed boolean)
language sql security definer set search_path='' as $$
  select * from app_private.finish_live_workout_without_pause(p_workout_id,p_expected_version,p_operation_id,false,null,null);
$$;

-- One public finalizer preserves the existing pause/duration accounting.
create or replace function public.finish_live_workout(
  p_workout_id uuid,p_expected_version bigint,p_operation_id uuid,
  p_attendance boolean,p_disposition text,p_package_id uuid
)
returns table(version bigint,replayed boolean)
language plpgsql security definer set search_path='' as $$
declare finished_version bigint; finished_replayed boolean;
begin
  select f.version,f.replayed into finished_version,finished_replayed
    from app_private.finish_live_workout_without_pause(p_workout_id,p_expected_version,p_operation_id,
      p_attendance,p_disposition,p_package_id) f;
  if not finished_replayed then
    update public.workouts w set paused_seconds=w.paused_seconds+case when w.paused_at is not null
      then greatest(0,round(extract(epoch from w.completed_at-w.paused_at)))::integer else 0 end,
      paused_at=null where w.id=p_workout_id;
    update public.workouts w set actual_duration_sec=least(43200,greatest(1,
      round(extract(epoch from w.completed_at-w.started_at))::integer-w.paused_seconds))
      where w.id=p_workout_id and w.paused_seconds>0 and w.actual_duration_sec is null and w.started_at is not null;
  end if;
  return query select finished_version,finished_replayed;
end;
$$;
revoke all on function public.finish_live_workout(uuid,bigint,uuid,boolean,text,uuid) from public;
grant execute on function public.finish_live_workout(uuid,bigint,uuid,boolean,text,uuid) to fit_api;

create or replace function public.finish_live_workout(p_workout_id uuid,p_expected_version bigint,p_operation_id uuid)
returns table(version bigint,replayed boolean)
language sql security definer set search_path='' as $$
  select * from public.finish_live_workout(p_workout_id,p_expected_version,p_operation_id,false,null,null);
$$;

-- Trainer plans may be cancelled on any date; client policy is unchanged.
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
  trainer_actor boolean;
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

  select account_role='trainer' into trainer_actor from public.profiles where id=actor_id;
  today_value := (now() at time zone client_timezone)::date;

  if not exists (
    select 1 from public.workouts workout
    where workout.id = p_workout_id
      and workout.deleted_at is null
      and workout.status = 'planned'
      and (trainer_actor or workout.workout_date < today_value)
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
    and (trainer_actor or workout.workout_date < today_value)
    and workout.deleted_at is null
    and workout.version = p_expected_version
  returning workout.version into next_version;

  if next_version is null then
    raise exception 'workout_conflict' using errcode = 'PT409';
  end if;
  return next_version;
end;
$$;

-- Down Migration
-- Forward-only; attendance and finance history must never be reconstructed.
