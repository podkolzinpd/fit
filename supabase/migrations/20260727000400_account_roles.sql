alter table public.profiles
  add column account_role text;

update public.profiles
set account_role = 'trainer'
where account_role is null;

alter table public.profiles
  alter column account_role set not null,
  alter column account_role set default 'trainer',
  add constraint profiles_account_role_allowed
    check (account_role in ('trainer', 'client'));

create or replace function public.initialize_account(
  p_role text,
  p_first_name text default null,
  p_last_name text default null,
  p_timezone text default 'Europe/Moscow'
)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  existing_role text;
  result public.profiles;
begin
  if actor_id is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;
  if p_role not in ('trainer', 'client') then
    raise exception 'invalid_account_role' using errcode = 'PT422';
  end if;

  select account_role into existing_role
  from public.profiles
  where id = actor_id
  for update;

  if existing_role is not null and existing_role <> p_role then
    raise exception 'account_role_immutable' using errcode = 'PT409';
  end if;

  insert into public.profiles (id, first_name, last_name, timezone, account_role)
  values (
    actor_id,
    nullif(btrim(p_first_name), ''),
    nullif(btrim(p_last_name), ''),
    coalesce(nullif(btrim(p_timezone), ''), 'Europe/Moscow'),
    p_role
  )
  on conflict (id) do update set
    first_name = coalesce(excluded.first_name, public.profiles.first_name),
    last_name = coalesce(excluded.last_name, public.profiles.last_name),
    timezone = excluded.timezone;

  if p_role = 'trainer' then
    insert into public.trainers (profile_id)
    values (actor_id)
    on conflict (profile_id) do nothing;
  end if;

  select * into result from public.profiles where id = actor_id;
  return result;
end;
$$;

revoke all on function public.initialize_account(text, text, text, text) from public, anon;
grant execute on function public.initialize_account(text, text, text, text) to authenticated;

create or replace function public.initialize_trainer(
  p_first_name text default null,
  p_last_name text default null,
  p_timezone text default 'Europe/Moscow'
)
returns public.trainers
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  result public.trainers;
begin
  perform public.initialize_account('trainer', p_first_name, p_last_name, p_timezone);
  select * into result from public.trainers where profile_id = actor_id;
  return result;
end;
$$;

create or replace function public.get_my_client()
returns table (
  id uuid,
  full_name text,
  gender text,
  age_years smallint,
  age_updated_at date,
  height_cm numeric,
  goal text,
  archived_at timestamptz,
  version bigint,
  current_weight_kg numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    client.id,
    client.full_name,
    client.gender,
    client.age_years,
    client.age_updated_at,
    client.height_cm,
    client.goal,
    client.archived_at,
    client.version,
    latest_weight.weight_kg
  from public.clients client
  left join lateral (
    select progress.weight_kg
    from public.client_progress progress
    where progress.client_id = client.id
      and progress.deleted_at is null
      and progress.weight_kg is not null
    order by progress.recorded_on desc
    limit 1
  ) latest_weight on true
  where client.auth_user_id = auth.uid()
  limit 1;
$$;

revoke all on function public.get_my_client() from public, anon;
grant execute on function public.get_my_client() to authenticated;
