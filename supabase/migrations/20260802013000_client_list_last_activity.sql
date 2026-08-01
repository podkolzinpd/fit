drop function public.list_clients(boolean);

create function public.list_clients(p_include_archived boolean default false)
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
  membership_version bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
begin
  if actor_id is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;
  if not exists (select 1 from public.trainers where profile_id = actor_id) then
    raise exception 'trainer_not_initialized' using errcode = 'PT422';
  end if;

  return query
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
    coalesce(membership.note, details.note),
    latest_weight.weight_kg,
    greatest(client.updated_at, coalesce(workout_activity.updated_at, client.updated_at), coalesce(progress_activity.updated_at, client.updated_at)),
    client.archived_at,
    client.version,
    coalesce(membership.version, 1)
  from public.clients client
  left join public.client_trainers membership
    on membership.client_id = client.id
   and membership.trainer_id = actor_id
  left join public.client_private_details details
    on details.client_id = client.id
   and details.trainer_id = actor_id
  left join lateral (
    select progress.weight_kg
    from public.client_progress progress
    where progress.client_id = client.id
      and progress.deleted_at is null
      and progress.weight_kg is not null
    order by progress.recorded_on desc, progress.created_at desc
    limit 1
  ) latest_weight on true
  left join lateral (
    select max(workout.updated_at) as updated_at
    from public.workouts workout
    where workout.client_id = client.id
      and workout.trainer_id = actor_id
  ) workout_activity on true
  left join lateral (
    select max(progress.updated_at) as updated_at
    from public.client_progress progress
    where progress.client_id = client.id
      and progress.trainer_id = actor_id
      and progress.deleted_at is null
  ) progress_activity on true
  where (client.trainer_id = actor_id or membership.trainer_id is not null)
    and (p_include_archived or client.archived_at is null)
  order by last_activity_at desc, lower(coalesce(membership.alias, client.full_name));
end;
$$;

revoke all on function public.list_clients(boolean) from public, anon;
grant execute on function public.list_clients(boolean) to authenticated;

create index if not exists workouts_client_activity_idx
  on public.workouts (client_id, trainer_id, updated_at desc);
