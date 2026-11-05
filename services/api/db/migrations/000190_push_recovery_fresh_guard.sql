-- Up Migration

-- Recovery is closed by default. Only the reviewed owner operation may open
-- delivery after archiving a verified historical snapshot. API rollback does
-- not remove this database protection. No source event/payload is deleted.
lock table app_private.push_notifications_outbox in share row exclusive mode;
do $$
begin
  if exists (select 1 from app_private.push_notifications_outbox
    where sent_at is null and discarded_at is null
      and (dispatch_started_at is not null or dispatch_token is not null)) then
    raise exception 'push_recovery_active_lease' using errcode = 'PT409';
  end if;
end;
$$;

create table app_private.push_delivery_control (
  singleton boolean primary key default true check (singleton),
  delivery_enabled boolean not null default false,
  fresh_after timestamptz,
  activated_at timestamptz,
  history_fingerprint text,
  history_cutoff timestamptz,
  constraint push_delivery_receipt_valid check (
    (history_fingerprint is null and history_cutoff is null) or
    (history_fingerprint is not null and history_fingerprint ~ '^[a-f0-9]{64}$' and history_cutoff is not null)),
  constraint push_delivery_activation_valid check
    (not delivery_enabled or (fresh_after is not null and activated_at is not null
      and fresh_after <= activated_at))
);
revoke all on app_private.push_delivery_control from public, fit_api;
insert into app_private.push_delivery_control(singleton) values (true);

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
  delivery_boundary timestamptz;
begin
  if p_limit is null or p_limit not between 1 and 50 then
    raise exception 'push_dispatch_invalid' using errcode = 'PT422';
  end if;

  -- The row lock serializes claims against maintenance/activation. Missing
  -- control, held delivery, or a future boundary must never expose history.
  select fresh_after into delivery_boundary
  from app_private.push_delivery_control
  where singleton and delivery_enabled
  for share;
  if delivery_boundary is null or delivery_boundary > p_now then return null; end if;

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
      and notification.created_at >= delivery_boundary
      and notification.created_at >= p_now - case
        when notification.kind in ('workout_reminder', 'test') then interval '15 minutes'
        else interval '1 day'
      end
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

revoke all on function app_private.claim_push_notifications(integer,timestamptz) from public;
grant execute on function app_private.claim_push_notifications(integer,timestamptz) to fit_api;

-- Down Migration

do $$ begin
  raise exception '000190_push_recovery_guard_is_forward_only';
end; $$;
