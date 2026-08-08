-- Membership aliases are initialized from the canonical client name. Keep those
-- inherited values in sync while preserving an alias that a trainer changed.
update public.client_trainers membership
set alias = client.full_name
from public.clients client
where client.id = membership.client_id
  and client.auth_user_id is not null
  and membership.version = 1
  and membership.alias is distinct from client.full_name;

create or replace function public.update_own_client(
  p_client jsonb,
  p_expected_version bigint
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  client_id_value uuid := (p_client->>'id')::uuid;
  previous_full_name text;
  next_full_name text := btrim(p_client->>'fullName');
  next_version bigint;
begin
  select client.full_name
  into previous_full_name
  from public.clients client
  where client.id = client_id_value
    and client.auth_user_id = actor_id
    and client.version = p_expected_version
  for update;

  if not found then
    if not exists (
      select 1 from public.clients
      where id = client_id_value and auth_user_id = actor_id
    ) then
      raise exception 'client_profile_access_denied' using errcode = 'PT403';
    end if;
    raise exception 'client_conflict' using errcode = 'PT409';
  end if;

  update public.clients set
    full_name = next_full_name,
    gender = p_client->>'gender',
    age_years = (p_client->>'ageYears')::smallint,
    age_updated_at = (p_client->>'ageUpdatedAt')::date,
    height_cm = (p_client->>'heightCm')::numeric,
    goal = nullif(btrim(p_client->>'goal'), ''),
    version = version + 1
  where id = client_id_value
  returning version into next_version;

  update public.client_trainers
  set alias = next_full_name
  where client_id = client_id_value
    and alias = previous_full_name;

  return next_version;
end;
$$;

revoke all on function public.update_own_client(jsonb, bigint) from public, anon;
grant execute on function public.update_own_client(jsonb, bigint) to authenticated;
