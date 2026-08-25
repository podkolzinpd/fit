-- Up Migration

create or replace function public.list_client_overviews(p_archived boolean default false)
returns table (
  id uuid,
  has_account boolean,
  full_name text,
  canonical_full_name text,
  gender text,
  age_years smallint,
  age_updated_at date,
  height_cm numeric,
  goal text,
  note text,
  current_weight_kg numeric,
  last_activity_at timestamptz,
  archived_at timestamptz,
  version bigint,
  membership_version bigint,
  done_count integer,
  completion_percent integer,
  last_workout_date date,
  days_in_work integer,
  needs_attention boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    client.id,
    client.auth_user_id is not null,
    coalesce(membership.alias, client.full_name),
    client.full_name,
    client.gender,
    client.age_years,
    client.age_updated_at,
    client.height_cm,
    client.goal,
    membership.note,
    latest_progress.weight_kg,
    greatest(
      client.updated_at,
      coalesce(workout_stats.last_updated_at, client.updated_at),
      coalesce(progress_activity.last_updated_at, client.updated_at)
    ),
    client.archived_at,
    client.version,
    coalesce(membership.version, 1),
    coalesce(workout_stats.done_count, 0),
    case
      when coalesce(workout_stats.done_count, 0) + coalesce(workout_stats.missed_count, 0) = 0
        then null
      else round(
        coalesce(workout_stats.done_count, 0)::numeric * 100
        / (workout_stats.done_count + workout_stats.missed_count)
      )::integer
    end,
    workout_stats.last_workout_date,
    case when workout_stats.first_workout_date is null then null else greatest(
      app_private.client_today(client.id) - workout_stats.first_workout_date,
      0
    ) end,
    workout_stats.last_workout_date is not null
      and app_private.client_today(client.id) - workout_stats.last_workout_date >= 14
  from public.clients client
  left join public.client_trainers membership
    on membership.client_id = client.id
   and membership.trainer_id = auth.uid()
  left join lateral (
    select progress.weight_kg
    from public.client_progress progress
    where progress.client_id = client.id
      and progress.deleted_at is null
      and progress.weight_kg is not null
    order by progress.recorded_on desc, progress.created_at desc, progress.id desc
    limit 1
  ) latest_progress on true
  left join lateral (
    select max(progress.updated_at) as last_updated_at
    from public.client_progress progress
    where progress.client_id = client.id and progress.deleted_at is null
  ) progress_activity on true
  left join lateral (
    select
      count(*) filter (where workout.status = 'done')::integer as done_count,
      count(*) filter (
        where workout.status = 'cancelled'
          or (workout.status = 'planned'
            and workout.workout_date < app_private.client_today(client.id))
      )::integer as missed_count,
      max(workout.workout_date) filter (where workout.status = 'done') as last_workout_date,
      min(workout.workout_date) as first_workout_date,
      max(workout.updated_at) as last_updated_at
    from public.workouts workout
    where workout.client_id = client.id
      and workout.deleted_at is null
      and public.can_read_workout(workout.id)
  ) workout_stats on true
  where public.can_access_client(client.id)
    and (client.archived_at is not null) = p_archived
  order by 12 desc, lower(coalesce(membership.alias, client.full_name));
$$;

revoke all on function public.list_client_overviews(boolean) from public;
grant execute on function public.list_client_overviews(boolean) to fit_api;

-- Down Migration

revoke execute on function public.list_client_overviews(boolean) from fit_api;
drop function public.list_client_overviews(boolean);
