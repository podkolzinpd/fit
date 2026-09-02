-- Up Migration

-- Yandex Managed PostgreSQL does not provide pg_net. Delivery therefore uses
-- a private timer-triggered Serverless Container: SQL remains responsible for
-- producing and atomically leasing outbox rows, while the container calls the
-- existing Web Push sender and finalizes every result.

alter table app_private.push_notifications_outbox
  add column dispatch_token uuid,
  add column discarded_at timestamptz,
  add constraint push_notifications_outbox_dispatch_lease_complete
    check ((dispatch_started_at is null) = (dispatch_token is null)),
  add constraint push_notifications_outbox_terminal_state
    check (num_nonnulls(sent_at, discarded_at) <= 1);

drop index app_private.push_notifications_outbox_pending_idx;
create index push_notifications_outbox_pending_idx
  on app_private.push_notifications_outbox (created_at)
  where sent_at is null
    and discarded_at is null
    and dispatch_started_at is null;

create or replace function app_private.enqueue_workout_reminders(
  p_now timestamptz default now()
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  inserted_count integer;
begin
  insert into app_private.push_notifications_outbox (
    kind, user_id, title, body, data
  )
  select
    'workout_reminder',
    client.auth_user_id,
    'Тренировка сегодня',
    case
      when workout.start_time is not null
        then format('Запланирована на %s', to_char(workout.start_time, 'HH24:MI'))
      else 'Загляните в расписание на сегодня'
    end,
    jsonb_build_object('workout_id', workout.id)
  from public.workouts workout
  join public.clients client on client.id = workout.client_id
  join public.profiles profile on profile.id = client.auth_user_id
  where workout.status = 'planned'
    and workout.deleted_at is null
    and client.auth_user_id is not null
    and exists (
      select 1
      from public.push_subscriptions subscription
      where subscription.user_id = client.auth_user_id
    )
    and coalesce((
      select preference.enabled
      from public.notification_preferences preference
      where preference.user_id = client.auth_user_id
        and preference.kind = 'workout_reminder'
    ), true)
    and (p_now at time zone profile.timezone)::date = workout.workout_date
    and (p_now at time zone profile.timezone)::time >= time '09:00'
    and (p_now at time zone profile.timezone)::time < time '09:05'
  on conflict (kind, user_id, data) do nothing;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

create or replace function app_private.enqueue_workout_scheduled_notification(
  p_workout_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_role text;
  actor_name text;
  target record;
  inserted_count integer;
begin
  select
    profile.account_role,
    nullif(btrim(
      coalesce(profile.first_name, '') || ' ' || coalesce(profile.last_name, '')
    ), '')
  into actor_role, actor_name
  from public.profiles profile
  where profile.id = actor_id;

  -- A client creating a self-managed plan must not receive a notification
  -- about their own action.
  if actor_role is distinct from 'trainer' then
    return false;
  end if;

  select
    workout.workout_date,
    workout.start_time,
    client.auth_user_id as client_user_id
  into target
  from public.workouts workout
  join public.clients client on client.id = workout.client_id
  where workout.id = p_workout_id
    and workout.status = 'planned'
    and workout.deleted_at is null
    and (
      workout.created_by = actor_id
      or (workout.created_by is null and workout.trainer_id = actor_id)
    )
    and (
      client.trainer_id = actor_id
      or exists (
        select 1
        from public.client_trainers membership
        where membership.client_id = client.id
          and membership.trainer_id = actor_id
      )
    );

  if not found or target.client_user_id is null then
    return false;
  end if;
  if not exists (
    select 1
    from public.push_subscriptions subscription
    where subscription.user_id = target.client_user_id
  ) then
    return false;
  end if;
  if not coalesce((
    select preference.enabled
    from public.notification_preferences preference
    where preference.user_id = target.client_user_id
      and preference.kind = 'workout_scheduled'
  ), true) then
    return false;
  end if;

  insert into app_private.push_notifications_outbox (
    kind, user_id, title, body, data
  ) values (
    'workout_scheduled',
    target.client_user_id,
    'Новая тренировка',
    case
      when actor_name is null then format(
        'Тренер запланировал вам тренировку на %s%s',
        to_char(target.workout_date, 'DD.MM.YYYY'),
        case when target.start_time is not null
          then ' в ' || to_char(target.start_time, 'HH24:MI')
          else ''
        end
      )
      else format(
        'Тренер %s запланировал вам тренировку на %s%s',
        actor_name,
        to_char(target.workout_date, 'DD.MM.YYYY'),
        case when target.start_time is not null
          then ' в ' || to_char(target.start_time, 'HH24:MI')
          else ''
        end
      )
    end,
    jsonb_build_object('workout_id', p_workout_id)
  )
  on conflict (kind, user_id, data) do nothing;

  get diagnostics inserted_count = row_count;
  return inserted_count = 1;
end;
$$;

create or replace function app_private.claim_push_notifications(
  p_limit integer default 20,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  lease_token uuid := gen_random_uuid();
  notifications jsonb;
begin
  if p_limit is null or p_limit not between 1 and 50 then
    raise exception 'push_dispatch_invalid' using errcode = 'PT422';
  end if;

  -- A process can stop after committing a lease and before finalization.
  -- Release such rows after ten minutes; the sender is at-least-once, so the
  -- producer dedupe key remains the primary duplicate guard.
  update app_private.push_notifications_outbox
  set
    dispatch_started_at = null,
    dispatch_token = null,
    attempts = attempts + 1,
    discarded_at = case
      when attempts + 1 >= 10 then p_now
      else discarded_at
    end,
    last_error = 'dispatch_timeout'
  where sent_at is null
    and discarded_at is null
    and dispatch_started_at < p_now - interval '10 minutes';

  -- A subscription may be removed after the producer wrote the outbox row.
  -- Keep that terminal outcome separate from successfully sent rows.
  update app_private.push_notifications_outbox notification
  set
    dispatch_started_at = null,
    dispatch_token = null,
    discarded_at = p_now,
    last_error = 'subscription_missing'
  where notification.sent_at is null
    and notification.discarded_at is null
    and not exists (
      select 1
      from public.push_subscriptions subscription
      where subscription.user_id = notification.user_id
    );

  with due as materialized (
    select
      notification.id,
      subscription.endpoint,
      subscription.p256dh,
      subscription.auth_key
    from app_private.push_notifications_outbox notification
    join public.push_subscriptions subscription
      on subscription.user_id = notification.user_id
    where notification.sent_at is null
      and notification.discarded_at is null
      and notification.dispatch_started_at is null
      and notification.attempts < 10
    order by notification.created_at
    limit p_limit
    for update of notification, subscription skip locked
  ), claimed as (
    update app_private.push_notifications_outbox notification
    set
      dispatch_started_at = p_now,
      dispatch_token = lease_token
    from due
    where notification.id = due.id
    returning
      notification.id,
      notification.title,
      notification.body,
      notification.data
  )
  select jsonb_agg(
    jsonb_build_object(
      'id', claimed.id,
      'subscription', jsonb_build_object(
        'endpoint', due.endpoint,
        'keys', jsonb_build_object(
          'p256dh', due.p256dh,
          'auth', due.auth_key
        )
      ),
      'title', claimed.title,
      'body', claimed.body,
      'data', claimed.data
    )
    order by claimed.id
  )
  into notifications
  from claimed
  join due using (id);

  if notifications is null then
    return null;
  end if;

  return jsonb_build_object(
    'dispatchToken', lease_token,
    'notifications', notifications
  );
end;
$$;

create or replace function app_private.finalize_push_notifications(
  p_dispatch_token uuid,
  p_results jsonb,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  item jsonb;
  notification_id uuid;
  notification_user_id uuid;
  notification_discarded_at timestamptz;
  delivered boolean;
  status_code integer;
  succeeded integer := 0;
  failed integer := 0;
  discarded integer := 0;
  claimed_count integer;
  processed_ids uuid[] := array[]::uuid[];
begin
  if p_dispatch_token is null
    or p_results is null
    or jsonb_typeof(p_results) <> 'array'
  then
    raise exception 'push_dispatch_invalid' using errcode = 'PT422';
  end if;

  select count(*)
  into claimed_count
  from app_private.push_notifications_outbox notification
  where notification.dispatch_token = p_dispatch_token;

  if claimed_count = 0 or jsonb_array_length(p_results) <> claimed_count then
    raise exception 'push_dispatch_invalid' using errcode = 'PT422';
  end if;

  for item in select value from jsonb_array_elements(p_results)
  loop
    if jsonb_typeof(item) <> 'object'
      or not (item ? 'id')
      or not (item ? 'ok')
      or jsonb_typeof(item->'ok') <> 'boolean'
    then
      raise exception 'push_dispatch_invalid' using errcode = 'PT422';
    end if;

    begin
      notification_id := (item->>'id')::uuid;
      delivered := (item->>'ok')::boolean;
      status_code := case
        when item ? 'status' then (item->>'status')::integer
        else 0
      end;
    exception
      when invalid_text_representation or numeric_value_out_of_range then
        raise exception 'push_dispatch_invalid' using errcode = 'PT422';
    end;

    if notification_id = any(processed_ids)
      or not exists (
        select 1
        from app_private.push_notifications_outbox notification
        where notification.id = notification_id
          and notification.dispatch_token = p_dispatch_token
      )
    then
      raise exception 'push_dispatch_invalid' using errcode = 'PT422';
    end if;
    processed_ids := array_append(processed_ids, notification_id);

    if delivered then
      update app_private.push_notifications_outbox notification
      set
        sent_at = p_now,
        dispatch_started_at = null,
        dispatch_token = null,
        last_error = null
      where notification.id = notification_id
        and notification.dispatch_token = p_dispatch_token;
      if found then
        succeeded := succeeded + 1;
      end if;
    else
      update app_private.push_notifications_outbox notification
      set
        discarded_at = case
          when status_code in (404, 410) or notification.attempts + 1 >= 10
            then p_now
          else notification.discarded_at
        end,
        dispatch_started_at = null,
        dispatch_token = null,
        attempts = notification.attempts + 1,
        last_error = case
          when status_code between 100 and 599
            then 'web_push_' || status_code::text
          else 'push_sender_unavailable'
        end
      where notification.id = notification_id
        and notification.dispatch_token = p_dispatch_token
      returning notification.user_id, notification.discarded_at
      into notification_user_id, notification_discarded_at;

      if found then
        failed := failed + 1;
        if notification_discarded_at is not null then
          discarded := discarded + 1;
        end if;
        if status_code in (404, 410) then
          delete from public.push_subscriptions
          where user_id = notification_user_id;
        end if;
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'succeeded', succeeded,
    'failed', failed,
    'discarded', discarded
  );
end;
$$;

revoke all on function app_private.enqueue_workout_reminders(timestamptz) from public;
revoke all on function app_private.enqueue_workout_scheduled_notification(uuid) from public;
revoke all on function app_private.claim_push_notifications(integer, timestamptz) from public;
revoke all on function app_private.finalize_push_notifications(uuid, jsonb, timestamptz) from public;

grant execute on function app_private.enqueue_workout_reminders(timestamptz) to fit_api;
grant execute on function app_private.enqueue_workout_scheduled_notification(uuid) to fit_api;
grant execute on function app_private.claim_push_notifications(integer, timestamptz) to fit_api;
grant execute on function app_private.finalize_push_notifications(uuid, jsonb, timestamptz) to fit_api;

-- Down Migration

revoke execute on function app_private.finalize_push_notifications(uuid, jsonb, timestamptz) from fit_api;
revoke execute on function app_private.claim_push_notifications(integer, timestamptz) from fit_api;
revoke execute on function app_private.enqueue_workout_scheduled_notification(uuid) from fit_api;
revoke execute on function app_private.enqueue_workout_reminders(timestamptz) from fit_api;

drop function app_private.finalize_push_notifications(uuid, jsonb, timestamptz);
drop function app_private.claim_push_notifications(integer, timestamptz);
drop function app_private.enqueue_workout_scheduled_notification(uuid);
drop function app_private.enqueue_workout_reminders(timestamptz);

drop index app_private.push_notifications_outbox_pending_idx;
alter table app_private.push_notifications_outbox
  drop constraint push_notifications_outbox_terminal_state,
  drop constraint push_notifications_outbox_dispatch_lease_complete,
  drop column discarded_at,
  drop column dispatch_token;

create index push_notifications_outbox_pending_idx
  on app_private.push_notifications_outbox (created_at)
  where sent_at is null and dispatch_started_at is null;
