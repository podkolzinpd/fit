-- Up Migration

-- Yandex Managed PostgreSQL has no pg_net, and enabling pg_cron would require
-- a cluster restart. The existing private timer-driven dispatcher therefore
-- leases feedback rows, calls Telegram/Tracker over HTTPS and finalizes the
-- receipts below. Tracker and Telegram are independent: one provider can be
-- retried without resending a delivery already confirmed by the other.

alter table public.app_feedback
  add column tracker_issue_key text,
  add column tracker_sync_attempts smallint not null default 0,
  add column tracker_last_error text,
  add column telegram_notified_at timestamptz,
  add column telegram_sync_attempts smallint not null default 0,
  add column telegram_last_error text,
  add column operations_dispatch_token uuid,
  add column operations_dispatch_started_at timestamptz,
  add constraint app_feedback_tracker_attempts_bounded
    check (tracker_sync_attempts between 0 and 10),
  add constraint app_feedback_telegram_attempts_bounded
    check (telegram_sync_attempts between 0 and 10),
  add constraint app_feedback_operations_lease_complete
    check (
      (operations_dispatch_token is null)
      = (operations_dispatch_started_at is null)
    );

create index app_feedback_operations_pending_idx
  on public.app_feedback (created_at)
  where operations_dispatch_token is null
    and (
      (tracker_issue_key is null and tracker_sync_attempts < 10)
      or (telegram_notified_at is null and telegram_sync_attempts < 10)
    );

create or replace function app_private.claim_app_feedback_deliveries(
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
  deliveries jsonb;
begin
  if p_limit is null or p_limit not between 1 and 20 then
    raise exception 'app_feedback_dispatch_invalid' using errcode = 'PT422';
  end if;

  -- A stopped container can leave a committed lease. Releasing it after ten
  -- minutes keeps retries bounded without storing provider payloads in logs.
  update public.app_feedback feedback
  set
    tracker_sync_attempts = case
      when feedback.tracker_issue_key is null
        then least(feedback.tracker_sync_attempts + 1, 10)
      else feedback.tracker_sync_attempts
    end,
    tracker_last_error = case
      when feedback.tracker_issue_key is null then 'dispatch_timeout'
      else feedback.tracker_last_error
    end,
    telegram_sync_attempts = case
      when feedback.telegram_notified_at is null
        then least(feedback.telegram_sync_attempts + 1, 10)
      else feedback.telegram_sync_attempts
    end,
    telegram_last_error = case
      when feedback.telegram_notified_at is null then 'dispatch_timeout'
      else feedback.telegram_last_error
    end,
    operations_dispatch_token = null,
    operations_dispatch_started_at = null
  where feedback.operations_dispatch_started_at < p_now - interval '10 minutes';

  with due as materialized (
    select feedback.id
    from public.app_feedback feedback
    where feedback.operations_dispatch_token is null
      and (
        (
          feedback.tracker_issue_key is null
          and feedback.tracker_sync_attempts < 10
        )
        or (
          feedback.telegram_notified_at is null
          and feedback.telegram_sync_attempts < 10
        )
      )
    order by feedback.created_at, feedback.id
    limit p_limit
    for update of feedback skip locked
  ), claimed as (
    update public.app_feedback feedback
    set
      operations_dispatch_token = lease_token,
      operations_dispatch_started_at = p_now
    from due
    where feedback.id = due.id
    returning
      feedback.id,
      feedback.account_role,
      feedback.kind,
      feedback.message,
      feedback.screen_path,
      feedback.app_version,
      feedback.display_mode,
      feedback.created_at,
      feedback.tracker_issue_key is null
        and feedback.tracker_sync_attempts < 10 as send_tracker,
      feedback.telegram_notified_at is null
        and feedback.telegram_sync_attempts < 10 as send_telegram
  )
  select jsonb_agg(
    jsonb_build_object(
      'id', claimed.id,
      'accountRole', claimed.account_role,
      'kind', claimed.kind,
      'message', claimed.message,
      'screenPath', claimed.screen_path,
      'appVersion', claimed.app_version,
      'displayMode', claimed.display_mode,
      'createdAt', claimed.created_at,
      'sendTracker', claimed.send_tracker,
      'sendTelegram', claimed.send_telegram
    )
    order by claimed.created_at, claimed.id
  )
  into deliveries
  from claimed;

  if deliveries is null then
    return null;
  end if;

  return jsonb_build_object(
    'dispatchToken', lease_token,
    'deliveries', deliveries
  );
end;
$$;

create or replace function app_private.finalize_app_feedback_deliveries(
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
  provider_result jsonb;
  feedback_id uuid;
  feedback record;
  provider_ok boolean;
  provider_error text;
  issue_key text;
  claimed_count integer;
  processed_ids uuid[] := array[]::uuid[];
  tracker_succeeded integer := 0;
  tracker_failed integer := 0;
  tracker_discarded integer := 0;
  telegram_succeeded integer := 0;
  telegram_failed integer := 0;
  telegram_discarded integer := 0;
begin
  if p_dispatch_token is null
    or p_results is null
    or jsonb_typeof(p_results) <> 'array'
  then
    raise exception 'app_feedback_dispatch_invalid' using errcode = 'PT422';
  end if;

  select count(*)
  into claimed_count
  from public.app_feedback stored
  where stored.operations_dispatch_token = p_dispatch_token;

  if claimed_count = 0 or jsonb_array_length(p_results) <> claimed_count then
    raise exception 'app_feedback_dispatch_invalid' using errcode = 'PT422';
  end if;

  for item in select value from jsonb_array_elements(p_results)
  loop
    if jsonb_typeof(item) <> 'object' or not (item ? 'id') then
      raise exception 'app_feedback_dispatch_invalid' using errcode = 'PT422';
    end if;

    begin
      feedback_id := (item->>'id')::uuid;
    exception
      when invalid_text_representation then
        raise exception 'app_feedback_dispatch_invalid' using errcode = 'PT422';
    end;

    if feedback_id = any(processed_ids) then
      raise exception 'app_feedback_dispatch_invalid' using errcode = 'PT422';
    end if;
    processed_ids := array_append(processed_ids, feedback_id);

    select
      stored.tracker_issue_key,
      stored.tracker_sync_attempts,
      stored.telegram_notified_at,
      stored.telegram_sync_attempts
    into feedback
    from public.app_feedback stored
    where stored.id = feedback_id
      and stored.operations_dispatch_token = p_dispatch_token
    for update;

    if not found then
      raise exception 'app_feedback_dispatch_invalid' using errcode = 'PT422';
    end if;

    if feedback.tracker_issue_key is null
      and feedback.tracker_sync_attempts < 10
    then
      provider_result := item->'tracker';
      if provider_result is null
        or jsonb_typeof(provider_result) <> 'object'
        or jsonb_typeof(provider_result->'ok') <> 'boolean'
      then
        raise exception 'app_feedback_dispatch_invalid' using errcode = 'PT422';
      end if;
      provider_ok := (provider_result->>'ok')::boolean;
      issue_key := nullif(btrim(provider_result->>'issueKey'), '');
      provider_error := nullif(btrim(provider_result->>'error'), '');

      if provider_ok and issue_key is not null and char_length(issue_key) <= 200 then
        update public.app_feedback stored
        set
          tracker_issue_key = issue_key,
          tracker_last_error = null
        where stored.id = feedback_id;
        tracker_succeeded := tracker_succeeded + 1;
      elsif not provider_ok
        and provider_error ~ '^[a-z0-9_:-]{1,120}$'
      then
        update public.app_feedback stored
        set
          tracker_sync_attempts = least(stored.tracker_sync_attempts + 1, 10),
          tracker_last_error = provider_error
        where stored.id = feedback_id;
        tracker_failed := tracker_failed + 1;
        if feedback.tracker_sync_attempts + 1 >= 10 then
          tracker_discarded := tracker_discarded + 1;
        end if;
      else
        raise exception 'app_feedback_dispatch_invalid' using errcode = 'PT422';
      end if;
    elsif item ? 'tracker' then
      raise exception 'app_feedback_dispatch_invalid' using errcode = 'PT422';
    end if;

    if feedback.telegram_notified_at is null
      and feedback.telegram_sync_attempts < 10
    then
      provider_result := item->'telegram';
      if provider_result is null
        or jsonb_typeof(provider_result) <> 'object'
        or jsonb_typeof(provider_result->'ok') <> 'boolean'
      then
        raise exception 'app_feedback_dispatch_invalid' using errcode = 'PT422';
      end if;
      provider_ok := (provider_result->>'ok')::boolean;
      provider_error := nullif(btrim(provider_result->>'error'), '');

      if provider_ok then
        update public.app_feedback stored
        set
          telegram_notified_at = p_now,
          telegram_last_error = null
        where stored.id = feedback_id;
        telegram_succeeded := telegram_succeeded + 1;
      elsif provider_error ~ '^[a-z0-9_:-]{1,120}$' then
        update public.app_feedback stored
        set
          telegram_sync_attempts = least(stored.telegram_sync_attempts + 1, 10),
          telegram_last_error = provider_error
        where stored.id = feedback_id;
        telegram_failed := telegram_failed + 1;
        if feedback.telegram_sync_attempts + 1 >= 10 then
          telegram_discarded := telegram_discarded + 1;
        end if;
      else
        raise exception 'app_feedback_dispatch_invalid' using errcode = 'PT422';
      end if;
    elsif item ? 'telegram' then
      raise exception 'app_feedback_dispatch_invalid' using errcode = 'PT422';
    end if;

    update public.app_feedback stored
    set
      operations_dispatch_token = null,
      operations_dispatch_started_at = null
    where stored.id = feedback_id
      and stored.operations_dispatch_token = p_dispatch_token;
  end loop;

  return jsonb_build_object(
    'trackerSucceeded', tracker_succeeded,
    'trackerFailed', tracker_failed,
    'trackerDiscarded', tracker_discarded,
    'telegramSucceeded', telegram_succeeded,
    'telegramFailed', telegram_failed,
    'telegramDiscarded', telegram_discarded
  );
end;
$$;

revoke all on function app_private.claim_app_feedback_deliveries(integer, timestamptz) from public;
revoke all on function app_private.finalize_app_feedback_deliveries(uuid, jsonb, timestamptz) from public;
grant execute on function app_private.claim_app_feedback_deliveries(integer, timestamptz) to fit_api;
grant execute on function app_private.finalize_app_feedback_deliveries(uuid, jsonb, timestamptz) to fit_api;

-- The current cohort is small, so live views are cheaper operationally than
-- pg_cron-managed materialized views and stay compatible with DataLens column
-- contracts without restarting the PostgreSQL cluster.
create schema if not exists analytics;
revoke all on schema analytics from public;

create view analytics.trainers_metrics
with (security_barrier = true, security_invoker = false)
as
select count(*)::bigint as trainers_total, now() as computed_at
from public.trainers;

create view analytics.trainer_overview
with (security_barrier = true, security_invoker = false)
as
select
  trainer.profile_id as trainer_id,
  trainer.created_at as registered_at,
  coalesce(clients.clients_total, 0) as clients_total,
  coalesce(clients.clients_archived, 0) as clients_archived,
  coalesce(clients.clients_app_linked, 0) as clients_app_linked,
  false as is_test_account,
  coalesce(workouts.workouts_total, 0) as workouts_total,
  coalesce(workouts.workouts_planned, 0) as workouts_planned,
  coalesce(workouts.workouts_in_progress, 0) as workouts_in_progress,
  coalesce(workouts.workouts_done, 0) as workouts_done,
  coalesce(exercises.exercises_unique_used, 0) as exercises_unique_used,
  workouts.last_workout_at,
  floor(extract(epoch from (now() - workouts.last_workout_at)) / 86400)::bigint
    as days_since_last_activity,
  case
    when workouts.last_workout_at is null then 'new'
    when now() - workouts.last_workout_at <= interval '7 days' then 'active'
    else 'not_active'
  end as trainer_status,
  now() as refreshed_at
from public.trainers trainer
left join (
  select
    client.trainer_id,
    count(*)::bigint as clients_total,
    count(*) filter (where client.archived_at is not null)::bigint
      as clients_archived,
    count(*) filter (where client.auth_user_id is not null)::bigint
      as clients_app_linked
  from public.clients client
  group by client.trainer_id
) clients on clients.trainer_id = trainer.profile_id
left join (
  select
    workout.trainer_id,
    count(*)::bigint as workouts_total,
    count(*) filter (where workout.status = 'planned')::bigint
      as workouts_planned,
    count(*) filter (where workout.status = 'in_progress')::bigint
      as workouts_in_progress,
    count(*) filter (where workout.status = 'done')::bigint
      as workouts_done,
    max(workout.updated_at) as last_workout_at
  from public.workouts workout
  where workout.deleted_at is null
  group by workout.trainer_id
) workouts on workouts.trainer_id = trainer.profile_id
left join (
  select
    exercise.trainer_id,
    count(distinct case
      when exercise.exercise_source = 'system'
        then 'system:' || exercise.exercise_ref
      else 'custom:' || exercise.custom_exercise_id::text
    end)::bigint as exercises_unique_used
  from public.workout_exercises exercise
  join public.workouts workout
    on workout.id = exercise.workout_id
      and workout.trainer_id = exercise.trainer_id
      and workout.client_id = exercise.client_id
  where workout.status = 'done' and workout.deleted_at is null
  group by exercise.trainer_id
) exercises on exercises.trainer_id = trainer.profile_id;

create view analytics.client_overview
with (security_barrier = true, security_invoker = false)
as
select
  client.id as client_id,
  client.created_at as registered_at,
  client.auth_user_id is not null
    and client.trainer_id = client.auth_user_id as is_self_registered,
  false as is_test_account,
  greatest(workouts.last_client_workout_at, progress.last_client_progress_at)
    as last_client_activity_at
from public.clients client
left join (
  select workout.client_id, max(workout.updated_at) as last_client_workout_at
  from public.workouts workout
  join public.clients owner on owner.id = workout.client_id
  where workout.deleted_at is null
    and owner.auth_user_id is not null
    and workout.updated_by = owner.auth_user_id
  group by workout.client_id
) workouts on workouts.client_id = client.id
left join (
  select item.client_id, max(item.updated_at) as last_client_progress_at
  from public.client_progress item
  join public.clients owner on owner.id = item.client_id
  where item.deleted_at is null
    and owner.auth_user_id is not null
    and item.updated_by = owner.auth_user_id
  group by item.client_id
) progress on progress.client_id = client.id;

create view analytics.app_feedback
with (security_barrier = true, security_invoker = false)
as
select
  feedback.id,
  feedback.created_at,
  feedback.account_role,
  feedback.kind,
  feedback.message,
  feedback.screen_path,
  feedback.app_version,
  feedback.display_mode,
  profile.first_name,
  profile.last_name,
  null::text as email,
  false as is_test_account,
  feedback.tracker_issue_key,
  feedback.tracker_sync_attempts,
  feedback.tracker_last_error,
  feedback.telegram_notified_at,
  feedback.telegram_sync_attempts,
  feedback.telegram_last_error
from public.app_feedback feedback
join public.profiles profile on profile.id = feedback.user_id;

revoke all on all tables in schema analytics from public, fit_api;

do $$
begin
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'fit_datalens') then
    grant usage on schema analytics to fit_datalens;
    grant select on all tables in schema analytics to fit_datalens;
  end if;
end
$$;

-- Down Migration

do $$
begin
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'fit_datalens') then
    revoke all on all tables in schema analytics from fit_datalens;
    revoke usage on schema analytics from fit_datalens;
  end if;
end
$$;
drop view analytics.app_feedback;
drop view analytics.client_overview;
drop view analytics.trainer_overview;
drop view analytics.trainers_metrics;
drop schema analytics;

revoke execute on function app_private.finalize_app_feedback_deliveries(uuid, jsonb, timestamptz) from fit_api;
revoke execute on function app_private.claim_app_feedback_deliveries(integer, timestamptz) from fit_api;
drop function app_private.finalize_app_feedback_deliveries(uuid, jsonb, timestamptz);
drop function app_private.claim_app_feedback_deliveries(integer, timestamptz);

drop index public.app_feedback_operations_pending_idx;
alter table public.app_feedback
  drop constraint app_feedback_operations_lease_complete,
  drop constraint app_feedback_telegram_attempts_bounded,
  drop constraint app_feedback_tracker_attempts_bounded,
  drop column operations_dispatch_started_at,
  drop column operations_dispatch_token,
  drop column telegram_last_error,
  drop column telegram_sync_attempts,
  drop column telegram_notified_at,
  drop column tracker_last_error,
  drop column tracker_sync_attempts,
  drop column tracker_issue_key;
