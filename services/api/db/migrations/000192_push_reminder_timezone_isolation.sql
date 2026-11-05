-- Up Migration

-- Only the PostgreSQL timezone parser decides which zones are supported.
-- Invalid profile data is reported explicitly; never invent a replacement zone.
create or replace function app_private.push_reminder_local_time(p_now timestamptz, p_timezone text)
returns timestamp without time zone
language plpgsql stable strict
set search_path = ''
as $$
begin
  return pg_catalog.timezone(p_timezone, p_now);
exception when sqlstate '22023' then
  return null;
end;
$$;
revoke all on function app_private.push_reminder_local_time(timestamptz,text) from public;

create or replace function app_private.prepare_workout_reminders(p_now timestamptz default now())
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare result jsonb;
begin
  -- The previous integer entry point returned zero for an explicit NULL clock.
  -- Do not misclassify every valid profile as an invalid timezone in that case.
  if p_now is null then return '{"enqueued":0,"invalidTimezoneProfiles":0}'::jsonb; end if;
  with candidates as materialized (
    select workout.id, workout.workout_date, workout.start_time,
      client.auth_user_id as user_id, subscription.id as subscription_id,
      app_private.push_reminder_local_time(p_now, profile.timezone) as local_time
    from public.workouts workout
    join public.clients client on client.id = workout.client_id
    join public.profiles profile on profile.id = client.auth_user_id
    join public.push_subscriptions subscription on subscription.user_id = client.auth_user_id
    where workout.status = 'planned' and workout.deleted_at is null
      and client.auth_user_id is not null
      and coalesce((select preference.enabled from public.notification_preferences preference
        where preference.user_id = client.auth_user_id and preference.kind = 'workout_reminder'), true)
  ), inserted as (
    insert into app_private.push_notifications_outbox(kind,user_id,title,body,data,subscription_id)
    select 'workout_reminder', candidate.user_id, 'Тренировка сегодня',
      case when candidate.start_time is not null
        then format('Запланирована на %s', to_char(candidate.start_time, 'HH24:MI'))
        else 'Загляните в расписание на сегодня' end,
      jsonb_build_object('workout_id',candidate.id,'url','/workouts/' || candidate.id),candidate.subscription_id
    from candidates candidate
    where candidate.local_time::date = candidate.workout_date
      and candidate.local_time::time >= time '09:00' and candidate.local_time::time < time '09:05'
    on conflict (kind,user_id,data,subscription_id) do nothing
    returning 1
  )
  select jsonb_build_object('enqueued',(select count(*)::integer from inserted),
    'invalidTimezoneProfiles',(select count(distinct user_id)::integer from candidates where local_time is null))
  into result;
  return result;
end;
$$;
revoke all on function app_private.prepare_workout_reminders(timestamptz) from public;
grant execute on function app_private.prepare_workout_reminders(timestamptz) to fit_api;

-- Preserve the existing integer RPC for older callers and API rollback.
create or replace function app_private.enqueue_workout_reminders(p_now timestamptz default now())
returns integer
language plpgsql security definer
set search_path = ''
as $$
declare result jsonb;
begin
  result := app_private.prepare_workout_reminders(p_now);
  if (result->>'invalidTimezoneProfiles')::integer > 0 then
    raise warning 'push_reminder_invalid_timezone_profiles:%', result->>'invalidTimezoneProfiles';
  end if;
  return (result->>'enqueued')::integer;
end;
$$;
revoke all on function app_private.enqueue_workout_reminders(timestamptz) from public;
grant execute on function app_private.enqueue_workout_reminders(timestamptz) to fit_api;

-- Down Migration

-- Keep the data isolation and old integer contract during unrelated rollbacks.
-- Restoring the unguarded conversion would reintroduce the production outage.
do $$ begin raise notice 'push_reminder_timezone_isolation_retained'; end; $$;
