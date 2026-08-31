-- Up Migration

-- Web Push state is ported independently from transport. The API can store
-- the actor's browser subscription and opt-out preferences, while the outbox
-- remains private and no Yandex cron/dispatcher is enabled by this migration.
create table public.push_subscriptions (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth_key text not null,
  created_at timestamptz not null default now(),
  constraint push_subscriptions_endpoint_format
    check (char_length(endpoint) between 1 and 2048 and endpoint ~ '^https://'),
  constraint push_subscriptions_p256dh_length
    check (char_length(p256dh) between 1 and 512),
  constraint push_subscriptions_auth_key_length
    check (char_length(auth_key) between 1 and 512)
);

create table public.notification_preferences (
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null,
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (user_id, kind),
  constraint notification_preferences_kind_not_blank
    check (char_length(btrim(kind)) between 1 and 64)
);

create trigger set_updated_at
before update on public.notification_preferences
for each row execute function public.set_updated_at();

alter table public.push_subscriptions enable row level security;
alter table public.notification_preferences enable row level security;

create policy push_subscriptions_manage_own on public.push_subscriptions
  for all to fit_api
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy notification_preferences_manage_own on public.notification_preferences
  for all to fit_api
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on public.push_subscriptions from public, fit_api;
revoke all on public.notification_preferences from public, fit_api;

create table app_private.push_notifications_outbox (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  user_id uuid not null references public.profiles (id) on delete cascade,
  title text not null,
  body text not null,
  data jsonb not null default '{}'::jsonb,
  dispatch_started_at timestamptz,
  sent_at timestamptz,
  attempts smallint not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  constraint push_notifications_outbox_kind_not_blank check (btrim(kind) <> ''),
  constraint push_notifications_outbox_title_not_blank check (btrim(title) <> ''),
  constraint push_notifications_outbox_body_not_blank check (btrim(body) <> ''),
  constraint push_notifications_outbox_attempts_non_negative check (attempts >= 0)
);

create unique index push_notifications_outbox_dedupe_idx
  on app_private.push_notifications_outbox (kind, user_id, data);

create index push_notifications_outbox_pending_idx
  on app_private.push_notifications_outbox (created_at)
  where sent_at is null and dispatch_started_at is null;

revoke all on app_private.push_notifications_outbox from public, fit_api;

create or replace function public.read_push_notification_status()
returns jsonb
language plpgsql
stable
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

  return jsonb_build_object(
    'subscribed', exists (
      select 1 from public.push_subscriptions where user_id = actor_id
    ),
    'preferences', jsonb_build_object(
      'workout_reminder', coalesce((
        select enabled from public.notification_preferences
        where user_id = actor_id and kind = 'workout_reminder'
      ), true),
      'workout_scheduled', coalesce((
        select enabled from public.notification_preferences
        where user_id = actor_id and kind = 'workout_scheduled'
      ), true)
    )
  );
end;
$$;

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

  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth_key)
  values (actor_id, normalized_endpoint, normalized_p256dh, normalized_auth_key)
  on conflict (user_id) do update set
    endpoint = excluded.endpoint,
    p256dh = excluded.p256dh,
    auth_key = excluded.auth_key;

  -- Browser subscription and the user-facing reminder toggle are one logical
  -- enable operation. Keeping both writes inside this function prevents a
  -- half-enabled state if a later statement fails.
  insert into public.notification_preferences (user_id, kind, enabled)
  values (actor_id, 'workout_reminder', true)
  on conflict (user_id, kind) do update set enabled = excluded.enabled;
exception
  when check_violation then
    raise exception 'push_notifications_invalid' using errcode = 'PT422';
end;
$$;

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

  -- Preserve the explicit opt-out even after the browser subscription is
  -- removed. The function is intentionally idempotent.
  insert into public.notification_preferences (user_id, kind, enabled)
  values (actor_id, 'workout_reminder', false)
  on conflict (user_id, kind) do update set enabled = excluded.enabled;

  delete from public.push_subscriptions where user_id = actor_id;
end;
$$;

create or replace function public.set_notification_preference(
  p_kind text,
  p_enabled boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  normalized_kind text := lower(btrim(p_kind));
begin
  if actor_id is null
    or not exists (select 1 from public.profiles where id = actor_id)
  then
    raise exception 'push_notifications_forbidden' using errcode = 'PT403';
  end if;
  if normalized_kind is null
    or normalized_kind not in ('workout_reminder', 'workout_scheduled')
    or p_enabled is null
  then
    raise exception 'push_notifications_invalid' using errcode = 'PT422';
  end if;

  insert into public.notification_preferences (user_id, kind, enabled)
  values (actor_id, normalized_kind, p_enabled)
  on conflict (user_id, kind) do update set enabled = excluded.enabled;
exception
  when check_violation then
    raise exception 'push_notifications_invalid' using errcode = 'PT422';
end;
$$;

revoke all on function public.read_push_notification_status() from public;
revoke all on function public.upsert_push_subscription(text, text, text) from public;
revoke all on function public.delete_push_subscription() from public;
revoke all on function public.set_notification_preference(text, boolean) from public;

grant execute on function public.read_push_notification_status() to fit_api;
grant execute on function public.upsert_push_subscription(text, text, text) to fit_api;
grant execute on function public.delete_push_subscription() to fit_api;
grant execute on function public.set_notification_preference(text, boolean) to fit_api;

-- Down Migration

revoke execute on function public.set_notification_preference(text, boolean) from fit_api;
revoke execute on function public.delete_push_subscription() from fit_api;
revoke execute on function public.upsert_push_subscription(text, text, text) from fit_api;
revoke execute on function public.read_push_notification_status() from fit_api;

drop function public.set_notification_preference(text, boolean);
drop function public.delete_push_subscription();
drop function public.upsert_push_subscription(text, text, text);
drop function public.read_push_notification_status();

drop table app_private.push_notifications_outbox;
drop table public.notification_preferences;
drop table public.push_subscriptions;
