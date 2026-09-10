-- Up Migration

-- Keep the Yandex backend compatible with the multi-device push contract
-- already used by the primary Supabase backend. One outbox row is addressed
-- to one concrete browser subscription, so a dead endpoint cannot disable a
-- user's other devices.
alter table public.push_subscriptions
  add column id uuid not null default gen_random_uuid();

alter table public.push_subscriptions
  drop constraint push_subscriptions_pkey;
alter table public.push_subscriptions
  add constraint push_subscriptions_pkey primary key (id),
  add constraint push_subscriptions_user_endpoint_key unique (user_id, endpoint);
create index push_subscriptions_user_id_idx
  on public.push_subscriptions (user_id);

alter table app_private.push_notifications_outbox
  add column subscription_id uuid
    references public.push_subscriptions (id) on delete set null;

-- Before this migration only one subscription per user was possible, so the
-- backfill is deterministic. Rows whose subscription was already removed stay
-- null and are discarded by the dispatcher as missing subscriptions.
update app_private.push_notifications_outbox notification
set subscription_id = subscription.id
from public.push_subscriptions subscription
where notification.subscription_id is null
  and subscription.user_id = notification.user_id;

drop index app_private.push_notifications_outbox_dedupe_idx;
create unique index push_notifications_outbox_dedupe_idx
  on app_private.push_notifications_outbox (
    kind, user_id, data, subscription_id
  );

create or replace function public.upsert_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth_key text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  normalized_endpoint text := btrim(p_endpoint);
  normalized_p256dh text := btrim(p_p256dh);
  normalized_auth_key text := btrim(p_auth_key);
begin
  if actor_id is null
    or not exists (select 1 from public.profiles where id = actor_id)
  then
    raise exception 'push_notifications_forbidden' using errcode = 'PT403';
  end if;
  if normalized_endpoint is null
    or char_length(normalized_endpoint) not between 1 and 2048
    or normalized_endpoint !~ '^https://'
    or normalized_p256dh is null
    or char_length(normalized_p256dh) not between 1 and 512
    or normalized_auth_key is null
    or char_length(normalized_auth_key) not between 1 and 512
  then
    raise exception 'push_notifications_invalid' using errcode = 'PT422';
  end if;

  insert into public.push_subscriptions (
    user_id, endpoint, p256dh, auth_key
  ) values (
    actor_id, normalized_endpoint, normalized_p256dh, normalized_auth_key
  )
  on conflict (user_id, endpoint) do update set
    p256dh = excluded.p256dh,
    auth_key = excluded.auth_key;

  insert into public.notification_preferences (user_id, kind, enabled)
  values (actor_id, 'workout_reminder', true)
  on conflict (user_id, kind) do update set enabled = excluded.enabled;
exception
  when check_violation then
    raise exception 'push_notifications_invalid' using errcode = 'PT422';
end;
$$;

create or replace function public.has_push_subscription(p_endpoint text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  normalized_endpoint text := btrim(p_endpoint);
begin
  if actor_id is null
    or not exists (select 1 from public.profiles where id = actor_id)
  then
    raise exception 'push_notifications_forbidden' using errcode = 'PT403';
  end if;
  if normalized_endpoint is null
    or char_length(normalized_endpoint) not between 1 and 2048
    or normalized_endpoint !~ '^https://'
  then
    raise exception 'push_notifications_invalid' using errcode = 'PT422';
  end if;

  return exists (
    select 1
    from public.push_subscriptions subscription
    where subscription.user_id = actor_id
      and subscription.endpoint = normalized_endpoint
  );
end;
$$;

create or replace function public.delete_push_subscription(p_endpoint text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  normalized_endpoint text := btrim(p_endpoint);
begin
  if actor_id is null
    or not exists (select 1 from public.profiles where id = actor_id)
  then
    raise exception 'push_notifications_forbidden' using errcode = 'PT403';
  end if;
  if normalized_endpoint is null
    or char_length(normalized_endpoint) not between 1 and 2048
    or normalized_endpoint !~ '^https://'
  then
    raise exception 'push_notifications_invalid' using errcode = 'PT422';
  end if;

  insert into public.notification_preferences (user_id, kind, enabled)
  values (actor_id, 'workout_reminder', false)
  on conflict (user_id, kind) do update set enabled = excluded.enabled;

  delete from public.push_subscriptions
  where user_id = actor_id and endpoint = normalized_endpoint;
end;
$$;

-- Compatibility for a revision created before the API deployment completes.
-- It records the opt-out but deliberately does not remove every device.
create or replace function public.delete_push_subscription()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
begin
  if actor_id is null
    or not exists (select 1 from public.profiles where id = actor_id)
  then
    raise exception 'push_notifications_forbidden' using errcode = 'PT403';
  end if;

  insert into public.notification_preferences (user_id, kind, enabled)
  values (actor_id, 'workout_reminder', false)
  on conflict (user_id, kind) do update set enabled = excluded.enabled;
end;
$$;

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
    kind, user_id, title, body, data, subscription_id
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
    jsonb_build_object(
      'workout_id', workout.id,
      'url', '/workouts/' || workout.id
    ),
    subscription.id
  from public.workouts workout
  join public.clients client on client.id = workout.client_id
  join public.profiles profile on profile.id = client.auth_user_id
  join public.push_subscriptions subscription
    on subscription.user_id = client.auth_user_id
  where workout.status = 'planned'
    and workout.deleted_at is null
    and client.auth_user_id is not null
    and coalesce((
      select preference.enabled
      from public.notification_preferences preference
      where preference.user_id = client.auth_user_id
        and preference.kind = 'workout_reminder'
    ), true)
    and (p_now at time zone profile.timezone)::date = workout.workout_date
    and (p_now at time zone profile.timezone)::time >= time '09:00'
    and (p_now at time zone profile.timezone)::time < time '09:05'
  on conflict (kind, user_id, data, subscription_id) do nothing;

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
  if not coalesce((
    select preference.enabled
    from public.notification_preferences preference
    where preference.user_id = target.client_user_id
      and preference.kind = 'workout_scheduled'
  ), true) then
    return false;
  end if;

  insert into app_private.push_notifications_outbox (
    kind, user_id, title, body, data, subscription_id
  )
  select
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
    jsonb_build_object(
      'workout_id', p_workout_id,
      'url', '/workouts/' || p_workout_id
    ),
    subscription.id
  from public.push_subscriptions subscription
  where subscription.user_id = target.client_user_id
  on conflict (kind, user_id, data, subscription_id) do nothing;

  get diagnostics inserted_count = row_count;
  return inserted_count > 0;
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

  update app_private.push_notifications_outbox notification
  set
    dispatch_started_at = null,
    dispatch_token = null,
    discarded_at = p_now,
    last_error = 'subscription_missing'
  where notification.sent_at is null
    and notification.discarded_at is null
    and (
      notification.subscription_id is null
      or not exists (
        select 1
        from public.push_subscriptions subscription
        where subscription.id = notification.subscription_id
      )
    );

  with due as materialized (
    select
      notification.id,
      subscription.endpoint,
      subscription.p256dh,
      subscription.auth_key
    from app_private.push_notifications_outbox notification
    join public.push_subscriptions subscription
      on subscription.id = notification.subscription_id
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
  notification_subscription_id uuid;
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
      returning notification.subscription_id, notification.discarded_at
      into notification_subscription_id, notification_discarded_at;

      if found then
        failed := failed + 1;
        if notification_discarded_at is not null then
          discarded := discarded + 1;
        end if;
        if status_code in (404, 410) then
          delete from public.push_subscriptions
          where id = notification_subscription_id;
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

revoke all on function public.has_push_subscription(text) from public;
revoke all on function public.delete_push_subscription(text) from public;
revoke all on function public.delete_push_subscription() from public;
revoke all on function app_private.enqueue_workout_reminders(timestamptz) from public;
revoke all on function app_private.enqueue_workout_scheduled_notification(uuid) from public;
revoke all on function app_private.claim_push_notifications(integer, timestamptz) from public;
revoke all on function app_private.finalize_push_notifications(uuid, jsonb, timestamptz) from public;

grant execute on function public.has_push_subscription(text) to fit_api;
grant execute on function public.delete_push_subscription(text) to fit_api;
grant execute on function public.delete_push_subscription() to fit_api;
grant execute on function app_private.enqueue_workout_reminders(timestamptz) to fit_api;
grant execute on function app_private.enqueue_workout_scheduled_notification(uuid) to fit_api;
grant execute on function app_private.claim_push_notifications(integer, timestamptz) to fit_api;
grant execute on function app_private.finalize_push_notifications(uuid, jsonb, timestamptz) to fit_api;

-- Down Migration

-- Multiple rows for one user cannot be collapsed back to the former
-- user_id primary key without deleting a real browser subscription. Rollback
-- therefore uses a forward corrective migration instead of a destructive down.
do $$
begin
  raise exception '000038_push_subscriptions_multi_device_is_forward_only';
end;
$$;
