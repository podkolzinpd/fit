-- Up Migration
-- Пауза Live-тренировки (YAFIT-627): клиент ставит всю тренировку на паузу,
-- накопленное время пауз вычитается из длительности при завершении.
alter table public.workouts
  add column paused_at timestamptz,
  add column paused_seconds integer not null default 0
    constraint workouts_paused_seconds_valid check (paused_seconds >= 0);
comment on column public.workouts.paused_at is
  'Live workout is paused since this moment; null while it runs.';
comment on column public.workouts.paused_seconds is
  'Seconds of finished pauses; subtracted from the Live duration on finish.';

create function public.set_live_workout_pause(
  p_workout_id uuid, p_paused boolean, p_operation_id uuid
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
  if p_paused is null then
    raise exception 'workout_invalid' using errcode = 'PT422';
  end if;
  -- Как move в 000140: отдельного действия в журнале нет, повтор отличает
  -- собственный хэш. Пауза — переключатель без ожидаемой версии: подтверждения
  -- подходов в это время не должны превращать её в конфликт.
  replayed_version := app_private.claim_live_workout_operation(
    'start', p_workout_id, p_operation_id,
    encode(sha256(convert_to(
      case when p_paused then 'pause:' else 'resume:' end || p_workout_id::text, 'UTF8'
    )), 'hex')
  );
  if replayed_version is not null then
    return query select replayed_version, true;
    return;
  end if;
  update public.workouts workout
  set paused_seconds = workout.paused_seconds + case
        when not p_paused and workout.paused_at is not null
          then greatest(0, round(extract(epoch from now() - workout.paused_at)))::integer
        else 0 end,
      paused_at = case when p_paused then coalesce(workout.paused_at, now()) else null end,
      updated_by = actor_id, version = workout.version + 1
  where workout.id = p_workout_id and workout.status = 'in_progress'
    and workout.deleted_at is null
  returning workout.version into next_version;
  if next_version is null then
    raise exception 'workout_conflict' using errcode = 'PT409';
  end if;
  perform app_private.complete_live_workout_operation(p_operation_id, next_version);
  return query select next_version, false;
end;
$$;
revoke all on function public.set_live_workout_pause(uuid, boolean, uuid) from public;
grant execute on function public.set_live_workout_pause(uuid, boolean, uuid) to fit_api;

alter function public.finish_live_workout(uuid, bigint, uuid)
  rename to finish_live_workout_without_pause;
alter function public.finish_live_workout_without_pause(uuid, bigint, uuid)
  set schema app_private;
revoke all on function app_private.finish_live_workout_without_pause(uuid, bigint, uuid) from public, fit_api;

-- Завершение закрывает незакрытую паузу и записывает длительность без пауз как
-- фактическую: её уже берут экран, калории (триггер) и прогресс.
create function public.finish_live_workout(
  p_workout_id uuid, p_expected_version bigint, p_operation_id uuid
)
returns table (version bigint, replayed boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  finished_version bigint;
  finished_replayed boolean;
begin
  select finished.version, finished.replayed into finished_version, finished_replayed
  from app_private.finish_live_workout_without_pause(p_workout_id, p_expected_version, p_operation_id) finished;
  if not finished_replayed then
    update public.workouts workout
    set paused_seconds = workout.paused_seconds + case
          when workout.paused_at is not null
            then greatest(0, round(extract(epoch from workout.completed_at - workout.paused_at)))::integer
          else 0 end,
        paused_at = null
    where workout.id = p_workout_id;
    update public.workouts workout
    set actual_duration_sec = least(43200, greatest(1,
          round(extract(epoch from workout.completed_at - workout.started_at))::integer - workout.paused_seconds))
    where workout.id = p_workout_id and workout.paused_seconds > 0
      and workout.actual_duration_sec is null and workout.started_at is not null;
  end if;
  return query select finished_version, finished_replayed;
end;
$$;
revoke all on function public.finish_live_workout(uuid, bigint, uuid) from public;
grant execute on function public.finish_live_workout(uuid, bigint, uuid) to fit_api;

-- Down Migration
drop function public.finish_live_workout(uuid, bigint, uuid);
alter function app_private.finish_live_workout_without_pause(uuid, bigint, uuid)
  set schema public;
alter function public.finish_live_workout_without_pause(uuid, bigint, uuid)
  rename to finish_live_workout;
revoke all on function public.finish_live_workout(uuid, bigint, uuid) from public;
grant execute on function public.finish_live_workout(uuid, bigint, uuid) to fit_api;
drop function public.set_live_workout_pause(uuid, boolean, uuid);
alter table public.workouts drop column paused_seconds, drop column paused_at;
