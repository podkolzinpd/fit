-- Up Migration

-- Тренировку, запланированную на будущее, можно провести раньше. Вне пилота
-- Fit Lime старт Live теперь тоже привязывает её к фактическому дню, но только
-- когда плановая дата ещё не наступила: иначе выполненная тренировка не попадает
-- ни в «Историю» (дата впереди), ни в «Предстоит» (уже не план). Прошедшие даты
-- вне пилота не трогаем — так записывают тренировку задним числом. Исходный план
-- сохраняется в planned_* тем же механизмом, что и у пилота (000120).
create or replace function app_private.capture_fit_lime_execution_date()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare local_start timestamp;
begin
  if old.status = 'planned' and new.status = 'in_progress'
    and old.started_at is null and new.started_at is not null then
    local_start := app_private.workout_client_local_time(new.client_id, new.started_at);
    if app_private.fit_lime_enabled() or old.workout_date > local_start::date then
      new.planned_date := coalesce(old.planned_date, old.workout_date);
      new.planned_start_time := old.start_time;
      new.planned_end_time := old.end_time;
      new.workout_date := local_start::date;
      new.start_time := date_trunc('second', local_start)::time;
      -- The planned end is not an actual completion time. Live completion remains
      -- in completed_at and does not move the workout to another calendar day.
      new.end_time := null;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function app_private.capture_fit_lime_execution_date() from public;

-- Down Migration

create or replace function app_private.capture_fit_lime_execution_date()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare local_start timestamp;
begin
  if old.status = 'planned' and new.status = 'in_progress'
    and old.started_at is null and new.started_at is not null
    and app_private.fit_lime_enabled() then
    local_start := app_private.workout_client_local_time(new.client_id, new.started_at);
    new.planned_date := coalesce(old.planned_date, old.workout_date);
    new.planned_start_time := old.start_time;
    new.planned_end_time := old.end_time;
    new.workout_date := local_start::date;
    new.start_time := date_trunc('second', local_start)::time;
    -- The planned end is not an actual completion time. Live completion remains
    -- in completed_at and does not move the workout to another calendar day.
    new.end_time := null;
  end if;
  return new;
end;
$$;
revoke all on function app_private.capture_fit_lime_execution_date() from public;
