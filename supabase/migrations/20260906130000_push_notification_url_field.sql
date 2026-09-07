-- Deep-link общего вида для push-уведомлений: `data.url`.
--
-- До сих пор `public/sw.js` при клике на уведомление жёстко читал
-- `data.workout_id` и сам собирал '/workouts/' || id — это работало только
-- для двух существующих сценариев (`workout_reminder`, `workout_scheduled`)
-- и не масштабируется на будущие сценарии, которые не всегда ведут на
-- тренировку. Producer знает, какой маршрут правильный для получателя (роль
-- клиента/тренера учитывается уже на этом уровне — см. AGENTS.md), поэтому
-- готовый url кладём в data здесь, а не в service worker.
--
-- `workout_id` оставляем в data — очередь разбирается in-flight за минуту
-- (cron `sync-push-notifications` раз в минуту), так что риск встретить уже
-- поставленную в очередь запись старой формы практически нулевой, но ломать
-- обратную совместимость бесплатно незачем.

create or replace function private.enqueue_workout_reminders()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.push_notifications_outbox (kind, user_id, title, body, data)
  select
    'workout_reminder',
    c.auth_user_id,
    'Тренировка сегодня',
    case when w.start_time is not null
      then format('Запланирована на %s', to_char(w.start_time, 'HH24:MI'))
      else 'Загляните в расписание на сегодня'
    end,
    jsonb_build_object('workout_id', w.id, 'url', '/workouts/' || w.id)
  from public.workouts w
  join public.clients c on c.id = w.client_id
  join public.profiles p on p.id = c.auth_user_id
  where w.status = 'planned'
    and w.deleted_at is null
    and c.auth_user_id is not null
    and exists (select 1 from public.push_subscriptions ps where ps.user_id = c.auth_user_id)
    and coalesce(
      (select np.enabled from public.notification_preferences np
        where np.user_id = c.auth_user_id and np.kind = 'workout_reminder'),
      true
    )
    and (current_timestamp at time zone p.timezone)::date = w.workout_date
    and (current_timestamp at time zone p.timezone)::time >= time '09:00'
    and (current_timestamp at time zone p.timezone)::time < time '09:05'
  on conflict (kind, user_id, data) do nothing;
end;
$$;

create or replace function private.enqueue_workout_scheduled_notification(p_workout_id uuid, p_trainer_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target record;
begin
  select
    w.workout_date,
    w.start_time,
    w.status,
    c.auth_user_id as client_user_id,
    trainer.first_name as trainer_first_name,
    trainer.last_name as trainer_last_name
  into target
  from public.workouts w
  join public.clients c on c.id = w.client_id
  join public.profiles trainer on trainer.id = p_trainer_id
  where w.id = p_workout_id;

  if not found or target.status <> 'planned' or target.client_user_id is null then
    return;
  end if;
  if not exists (select 1 from public.push_subscriptions ps where ps.user_id = target.client_user_id) then
    return;
  end if;
  if not coalesce(
    (select np.enabled from public.notification_preferences np
      where np.user_id = target.client_user_id and np.kind = 'workout_scheduled'),
    true
  ) then
    return;
  end if;

  insert into private.push_notifications_outbox (kind, user_id, title, body, data)
  values (
    'workout_scheduled',
    target.client_user_id,
    'Новая тренировка',
    format(
      'Тренер %s запланировал вам тренировку на %s%s',
      nullif(btrim(coalesce(target.trainer_first_name, '') || ' ' || coalesce(target.trainer_last_name, '')), ''),
      to_char(target.workout_date, 'DD.MM.YYYY'),
      case when target.start_time is not null then ' в ' || to_char(target.start_time, 'HH24:MI') else '' end
    ),
    jsonb_build_object('workout_id', p_workout_id, 'url', '/workouts/' || p_workout_id)
  )
  on conflict (kind, user_id, data) do nothing;
end;
$$;
