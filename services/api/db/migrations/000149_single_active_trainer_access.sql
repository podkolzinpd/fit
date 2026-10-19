-- Up Migration

-- The relationship, not a private alias/note membership or the historical
-- partition key, grants current coaching access. Do not delete legacy rows.
-- An unclaimed card is still usable by the trainer who created it.
create or replace function public.is_active_client_trainer_connection(
  p_client_id uuid, p_trainer_id uuid
)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.clients client
    join public.trainers trainer on trainer.profile_id = p_trainer_id
    where client.id = p_client_id and client.merged_into_client_id is null
      and (
        (client.auth_user_id is null and client.trainer_id = p_trainer_id)
        or (client.auth_user_id is not null and exists (
          select 1 from public.client_trainer_relationships relationship
          where relationship.client_id = client.id
            and relationship.trainer_id = p_trainer_id
            and relationship.status = 'active'
        ))
      )
  );
$$;
revoke all on function public.is_active_client_trainer_connection(uuid, uuid) from public, fit_api;

-- Stop on ambiguous pre-foundation data. Never choose the newest membership.
-- An explicit period (including a disconnected period) is already authoritative.
do $$
begin
  if exists (
    select client.id from public.clients client
    join lateral (
      select membership.trainer_id from public.client_trainers membership
      where membership.client_id = client.id
      union
      select trainer.profile_id from public.trainers trainer
      where trainer.profile_id = client.trainer_id
    ) candidate on true
    where client.auth_user_id is not null and client.merged_into_client_id is null
      and not exists (select 1 from public.client_trainer_relationships relationship
        where relationship.client_id = client.id)
    group by client.id having count(*) > 1
  ) then
    raise exception 'single_trainer_ambiguous_legacy_data: run read-only relationship preflight; no data changed';
  end if;
end;
$$;

-- Only an unambiguous, never-disconnected legacy connection can be materialized.
insert into public.client_trainer_relationships (
  client_id, trainer_id, connected_by, connected_at
)
select client.id, candidate.trainer_id, client.auth_user_id,
  coalesce((select joined_at from public.client_trainers
    where client_id = client.id and trainer_id = candidate.trainer_id), client.created_at)
from public.clients client
join lateral (
  select membership.trainer_id from public.client_trainers membership
  where membership.client_id = client.id
  union
  select trainer.profile_id from public.trainers trainer
  where trainer.profile_id = client.trainer_id
) candidate on true
where client.auth_user_id is not null and client.merged_into_client_id is null
  and not exists (select 1 from public.client_trainer_relationships relationship
    where relationship.client_id = client.id);

create or replace function public.can_access_client(p_client_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.clients client where client.id = p_client_id
      and (client.auth_user_id = auth.uid()
        or public.is_active_client_trainer_connection(client.id, auth.uid()))
  );
$$;

create or replace function public.can_read_workout(p_workout_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.workouts workout
    join public.clients client on client.id = workout.client_id
    where workout.id = p_workout_id and workout.deleted_at is null
      and (
        client.auth_user_id = auth.uid()
        or (public.is_active_client_trainer_connection(client.id, auth.uid())
          and (workout.created_by = auth.uid()
            or (workout.created_by is null and workout.trainer_id = auth.uid())
            or (workout.status in ('in_progress', 'done')
              and client.auth_user_id is not null and workout.created_by = client.auth_user_id)))
        or ((workout.created_by = auth.uid()
            or (workout.created_by is null and workout.trainer_id = auth.uid()))
          and exists (
            select 1 from public.client_trainer_relationships relationship
            where relationship.client_id = client.id and relationship.trainer_id = auth.uid()
              and relationship.status = 'disconnected'
              and workout.created_at <= relationship.disconnected_at
          ))
      )
  );
$$;

create or replace function app_private.trainer_finance_has_connection(
  p_trainer_id uuid, p_client_id uuid
)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.is_active_client_trainer_connection(p_client_id, p_trainer_id);
$$;

-- Private trainer notes are not shared with another coach or the athlete.
alter policy client_trainers_read_accessible on public.client_trainers
  using (trainer_id = auth.uid() and public.can_access_client(client_id));
alter policy training_summaries_read_trainers on public.client_training_summaries
  using (public.can_access_client(client_id) and exists (
    select 1 from public.profiles where id = auth.uid() and account_role = 'trainer'
  ));

-- Domain-specific writers below retain authorship, version and lifecycle guards.

create or replace function app_private.authorize_live_workout(p_workout_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_actor_id uuid := auth.uid();
  actor_role text;
  root_trainer_id uuid;
begin
  select profile.account_role into actor_role
  from public.profiles profile where profile.id = current_actor_id;
  select workout.trainer_id into root_trainer_id
  from public.workouts workout
  join public.clients client on client.id = workout.client_id
  where workout.id = p_workout_id
    and workout.deleted_at is null and client.archived_at is null
    and (
      (actor_role = 'trainer'
        and (workout.created_by = current_actor_id
          or (workout.created_by is null and workout.trainer_id = current_actor_id)
          or (workout.status = 'in_progress' and client.auth_user_id is not null
            and workout.created_by = client.auth_user_id))
        and (public.is_active_client_trainer_connection(client.id, current_actor_id)))
      or (actor_role = 'client' and client.auth_user_id = current_actor_id)
    );
  if root_trainer_id is null then
    raise exception 'workout_forbidden' using errcode = 'PT403';
  end if;
  return root_trainer_id;
end;
$$;

create or replace function app_private.authorize_workout_lifecycle(
  p_workout_id uuid,
  p_client_can_execute boolean
)
returns table (
  actor_role text,
  root_trainer_id uuid,
  client_id uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
begin
  return query
  select
    profile.account_role,
    workout.trainer_id,
    workout.client_id
  from public.workouts workout
  join public.clients client on client.id = workout.client_id
  join public.profiles profile on profile.id = actor_id
  where workout.id = p_workout_id
    and workout.deleted_at is null
    and (
      (
        profile.account_role = 'trainer'
        and (
          workout.created_by = actor_id
          or (workout.created_by is null and workout.trainer_id = actor_id)
        )
        and (
          public.is_active_client_trainer_connection(client.id, actor_id)
        )
      )
      or (
        profile.account_role = 'client'
        and client.auth_user_id = actor_id
        and (p_client_can_execute or workout.created_by = actor_id)
      )
    );

  if not found then
    raise exception 'workout_forbidden' using errcode = 'PT403';
  end if;
end;
$$;

create or replace function public.soft_delete_planned_workout(
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
  actor_role text;
  next_version bigint;
begin
  select profile.account_role
  into actor_role
  from public.profiles profile
  where profile.id = actor_id;

  update public.workouts workout
  set
    deleted_at = now(),
    updated_by = actor_id,
    version = workout.version + 1
  from public.clients client
  where workout.id = p_workout_id
    and workout.client_id = client.id
    and workout.deleted_at is null
    and workout.status = 'planned'
    and workout.version = p_expected_version
    and (
      (
        actor_role = 'trainer'
        and (
          workout.created_by = actor_id
          or (workout.created_by is null and workout.trainer_id = actor_id)
        )
        and (
          public.is_active_client_trainer_connection(client.id, actor_id)
        )
      )
      or (
        actor_role = 'client'
        and client.auth_user_id = actor_id
        and workout.created_by = actor_id
      )
    )
  returning workout.version into next_version;

  if next_version is null then
    raise exception 'workout_conflict' using errcode = 'PT409';
  end if;
  return next_version;
end;
$$;

create or replace function public.quick_start_live_workout(p_client_id uuid, p_operation_id uuid)
returns table (workout_id uuid, resumed boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_actor_id uuid := auth.uid();
  actor_role text;
  target_client_id uuid;
  root_trainer_id uuid;
  owner_actor_id uuid;
  previous_client_id uuid;
  previous_workout_id uuid;
  active_workout_id uuid;
  active_author_id uuid;
begin
  if current_actor_id is null then
    raise exception 'workout_forbidden' using errcode = 'PT403';
  end if;
  if p_operation_id is null then
    raise exception 'workout_invalid' using errcode = 'PT422';
  end if;

  select profile.account_role into actor_role
  from public.profiles profile where profile.id = current_actor_id;

  -- Self-managed clients must have their own linked client partition.
  if actor_role = 'client' then
    select client.id into target_client_id
    from public.clients client
    where client.auth_user_id = current_actor_id and client.archived_at is null;
    if p_client_id is not null and p_client_id is distinct from target_client_id then
      raise exception 'client_forbidden' using errcode = 'PT403';
    end if;
  elsif actor_role = 'trainer' then
    target_client_id := p_client_id;
  else
    raise exception 'workout_forbidden' using errcode = 'PT403';
  end if;
  if target_client_id is null then
    raise exception 'client_forbidden' using errcode = 'PT403';
  end if;

  select client.trainer_id, client.auth_user_id into root_trainer_id, owner_actor_id
  from public.clients client
  where client.id = target_client_id
    and client.archived_at is null
    and (
      (actor_role = 'client' and client.auth_user_id = current_actor_id)
      or (actor_role = 'trainer' and (public.is_active_client_trainer_connection(client.id, current_actor_id)))
    )
  for update of client;
  if root_trainer_id is null then
    raise exception 'client_forbidden' using errcode = 'PT403';
  end if;

  select operation.client_id, operation.workout_id
    into previous_client_id, previous_workout_id
  from app_private.quick_start_operations operation
  where operation.actor_id = current_actor_id and operation.operation_id = p_operation_id;
  if previous_workout_id is not null then
    if previous_client_id is distinct from target_client_id then
      raise exception 'operation_reused' using errcode = 'PT422';
    end if;
    return query select previous_workout_id, true;
    return;
  end if;

  select workout.id, workout.created_by into active_workout_id, active_author_id
  from public.workouts workout
  where workout.client_id = target_client_id
    and workout.status = 'in_progress'
    and workout.deleted_at is null;

  if active_workout_id is not null then
    -- A connected trainer cannot edit another trainer's live session.
    if actor_role = 'trainer' and active_author_id is distinct from current_actor_id
      and not (owner_actor_id is not null and active_author_id = owner_actor_id)
      and not (active_author_id is null and root_trainer_id = current_actor_id) then
      raise exception 'active_workout_exists' using errcode = 'PT409';
    end if;
    insert into app_private.quick_start_operations(actor_id, operation_id, client_id, workout_id)
    values (current_actor_id, p_operation_id, target_client_id, active_workout_id);
    return query select active_workout_id, true;
    return;
  end if;

  begin
    insert into public.workouts (
      trainer_id, client_id, created_by, updated_by, started_by,
      workout_date, status, started_at, origin
    ) values (
      root_trainer_id, target_client_id, current_actor_id, current_actor_id, current_actor_id,
      app_private.client_today(target_client_id), 'in_progress', now(), 'manual'
    ) returning id into active_workout_id;
  exception when unique_violation then
    -- A planned workout could have started while this request waited for the row.
    raise exception 'active_workout_exists' using errcode = 'PT409';
  end;
  insert into app_private.quick_start_operations(actor_id, operation_id, client_id, workout_id)
  values (current_actor_id, p_operation_id, target_client_id, active_workout_id);
  return query select active_workout_id, false;
end;
$$;

create or replace function public.set_workout_training_format(
  p_workout_id uuid,
  p_requested_format text,
  p_expected_version bigint,
  p_apply_default boolean default false
)
returns bigint
language plpgsql security definer set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_role text;
  current_client_id uuid;
  current_trainer_id uuid;
  current_created_by uuid;
  current_version bigint;
  current_format text;
  format_initialized boolean;
  current_workout_date date;
  client_owner_id uuid;
  finance_trainer_id uuid;
  next_format text;
  next_version bigint;
begin
  if actor_id is null or (p_requested_format is not null
    and p_requested_format not in ('self', 'with_trainer')) then
    raise exception 'workout_forbidden' using errcode = 'PT403';
  end if;
  select profile.account_role into actor_role
  from public.profiles profile where profile.id = actor_id;
  select workout.client_id, workout.trainer_id, workout.created_by,
    workout.version, workout.training_format, workout.training_format_initialized, workout.workout_date,
    client.auth_user_id
  into current_client_id, current_trainer_id, current_created_by,
    current_version, current_format, format_initialized, current_workout_date, client_owner_id
  from public.workouts workout
  join public.clients client on client.id = workout.client_id
  where workout.id = p_workout_id and workout.deleted_at is null
  for update of workout;
  if current_client_id is null then
    raise exception 'workout_not_found' using errcode = 'PT404';
  end if;
  if not (
    (actor_role = 'trainer'
      and (current_created_by = actor_id
        or (current_created_by is null and current_trainer_id = actor_id))
      and exists (
        select 1 from public.clients client
        where client.id = current_client_id
          and (public.is_active_client_trainer_connection(client.id, actor_id))
      ))
    or (actor_role = 'client' and client_owner_id = actor_id
      and current_created_by = actor_id)
  ) then
    raise exception 'workout_forbidden' using errcode = 'PT403';
  end if;
  if p_expected_version is not null and current_version <> p_expected_version then
    raise exception 'workout_conflict' using errcode = 'PT409';
  end if;

  -- Creation retries preserve the committed choice, including the last package slot.
  if p_apply_default and format_initialized then return current_version; end if;

  finance_trainer_id := app_private.workout_finance_trainer(p_workout_id);
  if actor_role = 'client' then
    next_format := 'self';
  elsif p_requested_format is not null then
    next_format := p_requested_format;
  elsif p_apply_default then
    if exists (
      select 1 from public.trainer_finance_packages package
      where package.trainer_id = finance_trainer_id
        and package.client_id = current_client_id
        and package.kind = 'online_coaching' and package.closed_at is null
        and package.starts_on <= current_workout_date
        and package.ends_on >= current_workout_date
    ) then
      next_format := 'self';
    elsif exists (
      select 1 from public.trainer_finance_packages package
      where package.trainer_id = finance_trainer_id
        and package.client_id = current_client_id
        and package.kind = 'session_pack' and package.closed_at is null
        and package.starts_on <= current_workout_date
        and (package.ends_on is null or package.ends_on >= current_workout_date)
        and package.opening_used_sessions + (
          select count(*) from public.trainer_finance_sessions session
          where session.package_id = package.id and session.disposition = 'charged'
            and session.voided_at is null
        ) < package.sessions_total
    ) then
      next_format := 'with_trainer';
    else
      next_format := 'self';
    end if;
  else
    next_format := current_format;
  end if;

  if next_format = current_format then
    update public.workouts set training_format_initialized = true where id = p_workout_id;
    return current_version;
  end if;
  update public.workouts workout
  set training_format = next_format, training_format_initialized = true, updated_by = actor_id,
    version = workout.version + 1
  where workout.id = p_workout_id
  returning workout.version into next_version;
  return next_version;
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
      public.is_active_client_trainer_connection(client.id, actor_id)
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

create or replace function public.list_trainer_finance_overview(p_month date)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  actor_id uuid := app_private.trainer_finance_assert_trainer();
  result jsonb;
begin
  if p_month is null or p_month <> date_trunc('month', p_month)::date then
    raise exception 'trainer_finance_invalid' using errcode = 'PT422';
  end if;

  with settings as (
    select (now() at time zone profile.timezone)::date as today,
      p_month as month_start,
      (p_month + interval '1 month')::date as month_end
    from public.profiles profile where profile.id = actor_id
  ), client_scope as (
    select client.id, client.full_name, client.archived_at
    from public.clients client
    where public.is_active_client_trainer_connection(client.id, actor_id)
    union
    select client.id, client.full_name, client.archived_at
    from public.clients client
    join public.trainer_finance_packages package on package.client_id = client.id
    where package.trainer_id = actor_id
  ), package_state as (
    select package.*,
      greatest(package.sessions_total - package.opening_used_sessions
        - coalesce(session_totals.used_sessions, 0), 0)::integer as sessions_remaining,
      greatest(package.price_cents - coalesce(payment_totals.paid_cents, 0), 0)::bigint as due_cents,
      package.closed_at is null
        and package.starts_on <= settings.today
        and (package.ends_on is null or package.ends_on >= settings.today)
        and package.opening_used_sessions + coalesce(session_totals.used_sessions, 0) < package.sessions_total
        as is_active,
      package.closed_at is null
        and package.starts_on > settings.today
        and package.opening_used_sessions + coalesce(session_totals.used_sessions, 0) < package.sessions_total
        as is_upcoming,
      package.closed_at is null
        and package.payment_due_on is not null
        and package.payment_due_on < settings.today
        and package.price_cents > coalesce(payment_totals.paid_cents, 0)
        as is_overdue
    from public.trainer_finance_packages package
    cross join settings
    left join lateral (
      select count(*)::integer as used_sessions
      from public.trainer_finance_sessions session
      where session.package_id = package.id and session.disposition = 'charged'
        and session.voided_at is null
    ) session_totals on true
    left join lateral (
      select coalesce(sum(payment.amount_cents), 0)::bigint as paid_cents
      from public.trainer_finance_payments payment
      where payment.package_id = package.id and payment.voided_at is null
    ) payment_totals on true
    where package.trainer_id = actor_id
  ), client_state as (
    select scope.id, scope.full_name, scope.archived_at,
      count(package.id) filter (where package.is_active)::integer as active_package_count,
      count(package.id) filter (where package.is_upcoming)::integer as upcoming_package_count,
      case when count(package.id) filter (where package.is_active) = 1
        then max(package.sessions_remaining) filter (where package.is_active)
        else null end as sessions_remaining,
      coalesce(sum(package.due_cents) filter (where package.closed_at is null), 0)::bigint as due_cents,
      coalesce(bool_or(package.is_overdue), false) as overdue,
      coalesce(bool_or(package.is_active and package.sessions_remaining between 1 and 2), false) as low_sessions,
      (select count(*)::integer
       from public.trainer_finance_sessions session
       where session.trainer_id = actor_id and session.client_id = scope.id
         and session.disposition = 'unassigned' and session.voided_at is null) as unassigned_sessions,
      (select coalesce(sum(payment.amount_cents), 0)::bigint
       from public.trainer_finance_payments payment cross join settings
       where payment.trainer_id = actor_id and payment.client_id = scope.id
         and payment.voided_at is null and payment.received_on >= settings.month_start
         and payment.received_on < settings.month_end) as received_cents
    from client_scope scope
    left join package_state package on package.client_id = scope.id
    group by scope.id, scope.full_name, scope.archived_at
  ), normalized as (
    select state.*,
      state.overdue or state.low_sessions or state.unassigned_sessions > 0
        or state.active_package_count > 1 as needs_attention
    from client_state state
  )
  select jsonb_build_object(
    'month', to_char(settings.month_start, 'YYYY-MM'),
    'receivedCents', coalesce((
      select sum(payment.amount_cents)::bigint
      from public.trainer_finance_payments payment
      where payment.trainer_id = actor_id and payment.voided_at is null
        and payment.received_on >= settings.month_start and payment.received_on < settings.month_end
    ), 0),
    'dueCents', coalesce((
      select sum(package.due_cents)::bigint from package_state package
      where package.closed_at is null
    ), 0),
    'attentionCount', (select count(*)::integer from normalized where needs_attention),
    'clients', coalesce((
      select jsonb_agg(jsonb_build_object(
        'clientId', state.id, 'fullName', state.full_name,
        'archivedAt', state.archived_at,
        'receivedCents', state.received_cents, 'dueCents', state.due_cents,
        'activePackageCount', state.active_package_count,
        'upcomingPackageCount', state.upcoming_package_count,
        'sessionsRemaining', state.sessions_remaining,
        'overdue', state.overdue, 'lowSessions', state.low_sessions,
        'unassignedSessions', state.unassigned_sessions,
        'needsAttention', state.needs_attention
      ) order by state.needs_attention desc, state.full_name, state.id)
      from normalized state
    ), '[]'::jsonb)
  ) into result
  from settings;
  return result;
end;
$$;

create or replace function public.list_trainer_finance_overview_v2(p_month date)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  actor_id uuid := app_private.trainer_finance_assert_trainer();
  result jsonb;
begin
  if p_month is null or p_month <> date_trunc('month', p_month)::date then
    raise exception 'trainer_finance_invalid' using errcode = 'PT422';
  end if;
  with settings as (
    select (now() at time zone profile.timezone)::date as today,
      p_month as month_start, (p_month + interval '1 month')::date as month_end
    from public.profiles profile where profile.id = actor_id
  ), client_scope as (
    select client.id, client.full_name, client.archived_at
    from public.clients client
    where public.is_active_client_trainer_connection(client.id, actor_id)
    union
    select client.id, client.full_name, client.archived_at
    from public.clients client
    join public.trainer_finance_packages package on package.client_id = client.id
    where package.trainer_id = actor_id
  ), package_state as (
    select package.*,
      case when package.kind = 'session_pack' then greatest(
        package.sessions_total - package.opening_used_sessions
          - coalesce(session_totals.used_sessions, 0), 0
      )::integer else null end as sessions_remaining,
      greatest(package.price_cents - coalesce(payment_totals.paid_cents, 0), 0)::bigint as due_cents,
      package.closed_at is null and package.starts_on <= settings.today
        and (package.ends_on is null or package.ends_on >= settings.today)
        and (package.kind = 'online_coaching' or package.opening_used_sessions
          + coalesce(session_totals.used_sessions, 0) < package.sessions_total) as is_active,
      package.closed_at is null and package.starts_on > settings.today
        and (package.kind = 'online_coaching' or package.opening_used_sessions
          + coalesce(session_totals.used_sessions, 0) < package.sessions_total) as is_upcoming,
      package.closed_at is null and package.payment_due_on is not null
        and package.payment_due_on < settings.today
        and package.price_cents > coalesce(payment_totals.paid_cents, 0) as is_overdue
    from public.trainer_finance_packages package cross join settings
    left join lateral (
      select count(*)::integer as used_sessions
      from public.trainer_finance_sessions session
      where session.package_id = package.id and session.disposition = 'charged'
        and session.voided_at is null
    ) session_totals on true
    left join lateral (
      select coalesce(sum(payment.amount_cents), 0)::bigint as paid_cents
      from public.trainer_finance_payments payment
      where payment.package_id = package.id and payment.voided_at is null
    ) payment_totals on true
    where package.trainer_id = actor_id
  ), client_state as (
    select scope.id, scope.full_name, scope.archived_at,
      count(package.id) filter (where package.is_active)::integer as active_package_count,
      count(package.id) filter (where package.is_upcoming)::integer as upcoming_package_count,
      case when count(package.id) filter (
          where package.is_active and package.kind = 'session_pack'
        ) = 1 then max(package.sessions_remaining) filter (
          where package.is_active and package.kind = 'session_pack'
        ) else null end as sessions_remaining,
      count(package.id) filter (
        where package.is_active and package.kind = 'session_pack'
      )::integer as active_session_package_count,
      coalesce(sum(package.due_cents) filter (where package.closed_at is null), 0)::bigint as due_cents,
      min(package.payment_due_on) filter (where package.closed_at is null
        and package.due_cents > 0) as nearest_payment_due_on,
      count(package.id) filter (where package.closed_at is null
        and package.due_cents > 0)::integer as unpaid_package_count,
      coalesce(bool_or(package.is_overdue), false) as overdue,
      coalesce(bool_or(package.is_active and package.kind = 'session_pack'
        and package.sessions_remaining between 1 and 2), false) as low_sessions,
      (select count(*)::integer from public.trainer_finance_sessions session
       where session.trainer_id = actor_id and session.client_id = scope.id
         and session.disposition = 'unassigned' and session.voided_at is null) as unassigned_sessions,
      (select coalesce(sum(payment.amount_cents), 0)::bigint
       from public.trainer_finance_payments payment cross join settings
       where payment.trainer_id = actor_id and payment.client_id = scope.id
         and payment.voided_at is null and payment.received_on >= settings.month_start
         and payment.received_on < settings.month_end) as received_cents
    from client_scope scope left join package_state package on package.client_id = scope.id
    group by scope.id, scope.full_name, scope.archived_at
  ), normalized as (
    select state.*, state.overdue or state.low_sessions
      or state.unassigned_sessions > 0 or state.active_session_package_count > 1 as needs_attention
    from client_state state
  )
  select jsonb_build_object(
    'month', to_char(settings.month_start, 'YYYY-MM'),
    'receivedCents', coalesce((select sum(payment.amount_cents)::bigint
      from public.trainer_finance_payments payment
      where payment.trainer_id = actor_id and payment.voided_at is null
        and payment.received_on >= settings.month_start and payment.received_on < settings.month_end), 0),
    'dueCents', coalesce((select sum(package.due_cents)::bigint
      from package_state package where package.closed_at is null), 0),
    'attentionCount', (select count(*)::integer from normalized where needs_attention),
    'clients', coalesce((select jsonb_agg(jsonb_build_object(
      'clientId', state.id, 'fullName', state.full_name, 'archivedAt', state.archived_at,
      'receivedCents', state.received_cents, 'dueCents', state.due_cents,
      'nearestPaymentDueOn', state.nearest_payment_due_on,
      'unpaidPackageCount', state.unpaid_package_count,
      'activePackageCount', state.active_package_count,
      'upcomingPackageCount', state.upcoming_package_count,
      'sessionsRemaining', state.sessions_remaining, 'overdue', state.overdue,
      'lowSessions', state.low_sessions, 'unassignedSessions', state.unassigned_sessions,
      'needsAttention', state.needs_attention
    ) order by state.needs_attention desc, state.full_name, state.id) from normalized state), '[]'::jsonb)
  ) into result from settings;
  return result;
end;
$$;

create or replace function public.set_client_archived(
  p_client_id uuid,
  p_archived boolean,
  p_expected_version bigint
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  next_version bigint;
begin
  update public.clients client
  set
    archived_at = case when p_archived then now() else null end,
    version = client.version + 1
  where client.id = p_client_id
    and (client.trainer_id = actor_id or client.auth_user_id = actor_id)
    and public.can_access_client(client.id)
    and client.version = p_expected_version
  returning client.version into next_version;

  if next_version is null then
    if exists (
      select 1 from public.clients client
      where client.id = p_client_id
        and (client.trainer_id = actor_id or client.auth_user_id = actor_id)
    and public.can_access_client(client.id)
    ) then
      raise exception 'client_conflict' using errcode = 'PT409';
    end if;
    raise exception 'client_forbidden' using errcode = 'PT403';
  end if;
  return next_version;
end;
$$;

create or replace function app_private.workout_finance_trainer(p_workout_id uuid)
returns uuid
language sql stable security definer set search_path = ''
as $$
  select profile.id from public.workouts workout
  join public.profiles profile on profile.id = coalesce(workout.created_by, workout.trainer_id)
    and profile.account_role = 'trainer'
  join public.clients client on client.id = workout.client_id
  where workout.id = p_workout_id and workout.deleted_at is null
    and client.archived_at is null and client.merged_into_client_id is null
    and public.is_active_client_trainer_connection(client.id, profile.id)
$$;

create or replace function public.update_trainer_finance_session_details_v2(
  p_session_id uuid, p_expected_version bigint, p_disposition text,
  p_package_id uuid, p_comment text, p_workout_date date
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  actor_id uuid := app_private.trainer_finance_assert_trainer();
  current_session public.trainer_finance_sessions;
  updated_session public.trainer_finance_sessions;
  next_disposition text := p_disposition;
  next_package_id uuid := p_package_id;
begin
  if p_workout_date is null or p_disposition not in ('charged', 'unassigned', 'free', 'trial')
    or (p_disposition = 'charged') <> (p_package_id is not null)
    or char_length(coalesce(p_comment, '')) > 2000 then
    raise exception 'trainer_finance_invalid' using errcode = 'PT422';
  end if;
  select * into current_session from public.trainer_finance_sessions session
  where session.id = p_session_id and session.trainer_id = actor_id and session.voided_at is null;
  if current_session.id is null then
    raise exception 'trainer_finance_session_not_found' using errcode = 'PT404';
  end if;
  -- Keep the lock order consistent with workout triggers: workout, then client ledger.
  perform 1 from public.workouts where id = current_session.workout_id for update;
  if not public.is_active_client_trainer_connection(current_session.client_id, actor_id)
    and exists(select 1 from public.workouts where id = current_session.workout_id
      and workout_date is distinct from p_workout_date) then
    raise exception 'trainer_finance_forbidden' using errcode = 'PT403';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    current_session.trainer_id::text || ':' || current_session.client_id::text, 0
  ));
  if p_disposition = 'charged' and not exists (
    select 1 from public.trainer_finance_packages package
    where package.id = p_package_id and package.trainer_id = actor_id
      and package.client_id = current_session.client_id
      and package.kind = 'session_pack' and package.closed_at is null
      and package.starts_on <= p_workout_date
      and (package.ends_on is null or package.ends_on >= p_workout_date)
      and package.opening_used_sessions + (select count(*)
        from public.trainer_finance_sessions used
        where used.package_id = package.id and used.disposition = 'charged'
          and used.voided_at is null and used.id <> current_session.id) < package.sessions_total
  ) then
    if p_package_id = current_session.package_id and exists (
      select 1 from public.workouts w where w.id = current_session.workout_id and w.workout_date <> p_workout_date
    ) then
      next_disposition := 'unassigned';
      next_package_id := null;
    else
      raise exception 'trainer_finance_invalid' using errcode = 'PT422';
    end if;
  end if;
  update public.trainer_finance_sessions session
  set disposition = next_disposition,
    package_id = case when next_disposition = 'charged' then next_package_id else null end,
    comment = nullif(btrim(coalesce(p_comment, '')), ''), version = session.version + 1
  where session.id = p_session_id and session.trainer_id = actor_id
    and session.version = p_expected_version and session.voided_at is null
  returning * into updated_session;
  if updated_session.id is null then
    raise exception 'trainer_finance_conflict' using errcode = 'PT409';
  end if;
  update public.workouts workout set workout_date = p_workout_date
  where workout.id = current_session.workout_id
    and coalesce(workout.created_by, workout.trainer_id) = actor_id and workout.client_id = current_session.client_id;
  if not found then
    raise exception 'trainer_finance_session_not_found' using errcode = 'PT404';
  end if;
  return jsonb_build_object(
    'id', updated_session.id, 'packageId', updated_session.package_id,
    'workoutId', updated_session.workout_id, 'workoutDate', p_workout_date,
    'disposition', updated_session.disposition, 'source', updated_session.source,
    'comment', updated_session.comment, 'voidedAt', updated_session.voided_at,
    'voidReason', updated_session.void_reason, 'version', updated_session.version,
    'createdAt', updated_session.created_at, 'updatedAt', updated_session.updated_at
  );
end;
$$;

-- Historical workout reads do not reopen the full athlete profile via a join.
create function public.readable_workout_client_name(p_workout_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  select case when client.auth_user_id = auth.uid()
      or public.is_active_client_trainer_connection(client.id, auth.uid())
    then client.full_name
    else coalesce((select alias from public.client_trainers
      where client_id = client.id and trainer_id = auth.uid()), 'Спортсмен') end
  from public.workouts workout join public.clients client on client.id = workout.client_id
  where workout.id = p_workout_id and public.can_read_workout(workout.id);
$$;
revoke all on function public.readable_workout_client_name(uuid) from public;
grant execute on function public.readable_workout_client_name(uuid) to fit_api;

create or replace function public.update_client_preferences(
  p_client_id uuid,
  p_alias text,
  p_note text,
  p_expected_version bigint
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  alias_value text := nullif(btrim(p_alias), '');
  note_value text := nullif(btrim(p_note), '');
  next_version bigint;
begin
  if not public.is_active_client_trainer_connection(p_client_id, actor_id) then
    raise exception 'client_forbidden' using errcode = 'PT403';
  end if;
  insert into public.client_trainers(client_id, trainer_id)
  values (p_client_id, actor_id) on conflict(client_id, trainer_id) do nothing;
  update public.client_trainers membership
  set
    alias = alias_value,
    note = note_value,
    version = membership.version + 1
  where membership.client_id = p_client_id
    and membership.trainer_id = actor_id
    and membership.version = p_expected_version
  returning membership.version into next_version;

  if next_version is null then
    if exists (
      select 1 from public.client_trainers membership
      where membership.client_id = p_client_id
        and membership.trainer_id = actor_id
    ) then
      raise exception 'client_conflict' using errcode = 'PT409';
    end if;
    raise exception 'client_forbidden' using errcode = 'PT403';
  end if;
  return next_version;
exception
  when check_violation then
    raise exception 'client_invalid' using errcode = 'PT422';
end;
$$;

create or replace function app_private.responsible_workout_trainer(p_workout_id uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select candidate.trainer_id from public.workouts workout
  join public.clients client on client.id = workout.client_id
  cross join lateral (
    select client.trainer_id as trainer_id where client.auth_user_id is null
    union all
    select relationship.trainer_id from public.client_trainer_relationships relationship
    where client.auth_user_id is not null and relationship.client_id = client.id and relationship.status = 'active'
  ) candidate
  where workout.id = p_workout_id and workout.deleted_at is null
    and public.is_active_client_trainer_connection(client.id, candidate.trainer_id)
    and (workout.created_by = candidate.trainer_id
      or (workout.created_by is null and workout.trainer_id = candidate.trainer_id)
      or (client.auth_user_id is not null and workout.created_by = client.auth_user_id));
$$;

create or replace function public.answer_workout_question(
  p_workout_id uuid,
  p_reaction text,
  p_review text,
  p_expected_version bigint
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  workout_row public.workouts%rowtype;
  normalized_review text := nullif(btrim(p_review), '');
  next_version bigint;
begin
  select workout.* into workout_row
  from public.workouts workout
  join public.clients client on client.id = workout.client_id
  join public.profiles profile on profile.id = actor_id
  where workout.id = p_workout_id
    and workout.deleted_at is null
    and profile.account_role = 'trainer'
    and actor_id = app_private.responsible_workout_trainer(workout.id)
    and public.can_access_client(workout.client_id)
  for update of workout;

  if workout_row.id is null then
    raise exception 'workout_forbidden' using errcode = 'PT403';
  end if;
  if workout_row.status <> 'done' then
    raise exception 'workout_not_completed' using errcode = 'PT422';
  end if;
  if workout_row.client_question is null then
    raise exception 'workout_question_not_found' using errcode = 'PT422';
  end if;
  if (p_reaction is not null
      and p_reaction not in ('thumbs_up', 'fire', 'strong'))
    or normalized_review is null
    or char_length(normalized_review) > 500
  then
    raise exception 'workout_response_invalid' using errcode = 'PT422';
  end if;
  if workout_row.trainer_reaction is not distinct from p_reaction
    and workout_row.trainer_review is not distinct from normalized_review
    and workout_row.trainer_review_author_id = actor_id
    and workout_row.client_question_resolved_at is not null
  then
    return workout_row.version;
  end if;
  if workout_row.client_question_resolved_at is not null then
    raise exception 'workout_question_resolved' using errcode = 'PT422';
  end if;
  if workout_row.version <> p_expected_version then
    raise exception 'workout_conflict' using errcode = 'PT409';
  end if;

  update public.workouts workout
  set trainer_reaction = p_reaction,
      trainer_review = normalized_review,
      trainer_review_author_id = actor_id,
      trainer_reviewed_at = now(),
      client_question_resolved_at = now(),
      updated_by = actor_id,
      version = workout.version + 1
  where workout.id = p_workout_id
  returning workout.version into next_version;
  return next_version;
end;
$$;

create or replace function public.resolve_workout_question(
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
  workout_row public.workouts%rowtype;
  next_version bigint;
begin
  select workout.* into workout_row
  from public.workouts workout
  join public.clients client on client.id = workout.client_id
  join public.profiles profile on profile.id = actor_id
  where workout.id = p_workout_id
    and workout.deleted_at is null
    and profile.account_role = 'trainer'
    and actor_id = app_private.responsible_workout_trainer(workout.id)
    and public.can_access_client(workout.client_id)
  for update of workout;

  if workout_row.id is null then
    raise exception 'workout_forbidden' using errcode = 'PT403';
  end if;
  if workout_row.client_question is null then
    raise exception 'workout_question_not_found' using errcode = 'PT422';
  end if;
  if workout_row.client_question_resolved_at is not null then
    return workout_row.version;
  end if;
  if workout_row.version <> p_expected_version then
    raise exception 'workout_conflict' using errcode = 'PT409';
  end if;

  update public.workouts workout
  set client_question_resolved_at = now(),
      updated_by = actor_id,
      version = workout.version + 1
  where workout.id = p_workout_id
  returning workout.version into next_version;
  return next_version;
end;
$$;

create or replace function public.snooze_client_attention(p_client_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  snoozed_until timestamptz := now() + interval '14 days';
  stored_snoozed_until timestamptz;
begin
  if not public.is_active_client_trainer_connection(p_client_id, actor_id) then
    raise exception 'client_forbidden' using errcode = 'PT403';
  end if;
  if actor_id is null or not exists (
    select 1 from public.profiles profile
    where profile.id = actor_id and profile.account_role = 'trainer'
  ) then
    raise exception 'client_forbidden' using errcode = 'PT403';
  end if;

  select membership.attention_snoozed_until
  into stored_snoozed_until
  from public.client_trainers membership
  join public.clients client on client.id = membership.client_id
  where membership.client_id = p_client_id
    and membership.trainer_id = actor_id
    and client.archived_at is null
  for update of membership;

  if stored_snoozed_until > now() then
    return stored_snoozed_until;
  end if;

  insert into public.client_trainers (
    client_id, trainer_id, attention_snoozed_until
  )
  select p_client_id, actor_id, snoozed_until
  from public.clients client
  where client.id = p_client_id
    and client.archived_at is null
    and public.is_active_client_trainer_connection(client.id, actor_id)
  on conflict (client_id, trainer_id) do update
  set attention_snoozed_until = excluded.attention_snoozed_until,
      version = public.client_trainers.version + 1;

  if not found then
    raise exception 'client_forbidden' using errcode = 'PT403';
  end if;
  return snoozed_until;
end;
$$;

create or replace function public.list_trainer_attention_workouts()
returns table (
  workout_id uuid,
  client_id uuid,
  client_name text,
  workout_date date,
  client_question text,
  client_question_asked_at timestamptz,
  discomfort boolean,
  client_comment text,
  feedback_submitted_at timestamptz,
  version bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select workout.id, workout.client_id,
    coalesce(membership.alias, client.full_name), workout.workout_date,
    workout.client_question, workout.client_question_asked_at,
    workout.discomfort, workout.client_comment,
    coalesce(workout.feedback_submitted_at, workout.updated_at),
    workout.version
  from public.workouts workout
  join public.clients client on client.id = workout.client_id
  left join public.client_trainers membership
    on membership.client_id = client.id and membership.trainer_id = auth.uid()
  where client.archived_at is null
    and workout.deleted_at is null
    and workout.status = 'done'
    and app_private.responsible_workout_trainer(workout.id) = auth.uid()
    and public.can_access_client(client.id)
    and (
      (workout.client_question is not null
        and workout.client_question_resolved_at is null)
      or (
        workout.discomfort is true
        and (workout.trainer_reviewed_at is null
          or workout.trainer_reviewed_at < coalesce(
            workout.feedback_submitted_at, workout.updated_at
          ))
      )
    )
  order by workout.client_question_asked_at desc nulls last,
    coalesce(workout.feedback_submitted_at, workout.updated_at) desc;
$$;

create or replace function public.publish_training_summary(
  p_summary_id uuid,
  p_client_summary jsonb,
  p_expected_version bigint
)
returns table (published_id uuid, next_version bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  source_row public.client_training_summaries;
  published_id_value uuid;
  next_version_value bigint;
begin
  if actor_id is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;

  select *
  into source_row
  from public.client_training_summaries
  where id = p_summary_id
    and public.is_active_client_trainer_connection(client_id, actor_id)
  for update;

  if not found then
    raise exception 'training_summary_not_found' using errcode = 'PT404';
  end if;
  if source_row.version <> p_expected_version then
    raise exception 'training_summary_conflict' using errcode = 'PT409';
  end if;

  update public.client_training_summaries
  set client_summary = p_client_summary,
      version = version + 1
  where id = p_summary_id
    and public.is_active_client_trainer_connection(client_id, actor_id)
    and version = p_expected_version
  returning version into next_version_value;

  insert into public.client_published_training_summaries (
    source_summary_id,
    trainer_id,
    client_id,
    period_start,
    period_end,
    summary,
    display_metrics,
    input_fingerprint,
    generated_at,
    published_at,
    published_by
  ) values (
    source_row.id,
    source_row.trainer_id,
    source_row.client_id,
    source_row.period_start,
    source_row.period_end,
    p_client_summary,
    source_row.display_metrics,
    source_row.input_fingerprint,
    source_row.generated_at,
    now(),
    actor_id
  )
  on conflict (client_id, period_start, period_end)
  do update set
    source_summary_id = excluded.source_summary_id,
    trainer_id = excluded.trainer_id,
    summary = excluded.summary,
    display_metrics = excluded.display_metrics,
    input_fingerprint = excluded.input_fingerprint,
    generated_at = excluded.generated_at,
    published_at = excluded.published_at,
    published_by = excluded.published_by
  returning id into published_id_value;

  return query select published_id_value, next_version_value;
end;
$$;

create or replace function public.unpublish_training_summary(
  p_summary_id uuid,
  p_expected_version bigint
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  next_version_value bigint;
begin
  if actor_id is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;

  update public.client_training_summaries
  set version = version + 1
  where id = p_summary_id
    and public.is_active_client_trainer_connection(client_id, actor_id)
    and version = p_expected_version
  returning version into next_version_value;

  if next_version_value is null then
    raise exception 'training_summary_conflict' using errcode = 'PT409';
  end if;

  delete from public.client_published_training_summaries
  where source_summary_id = p_summary_id
    and public.is_active_client_trainer_connection(client_id, actor_id);

  return next_version_value;
end;
$$;

-- Down Migration
-- Deliberately forward-only: a rollback must not re-enable stale access.
select 1;
