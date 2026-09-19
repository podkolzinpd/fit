create or replace function public.update_client(p_client jsonb, p_expected_version bigint)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  client_id_value uuid := (p_client->>'id')::uuid;
  next_version bigint;
begin
  update public.clients client set
    full_name = p_client->>'fullName',
    gender = p_client->>'gender',
    age_years = (p_client->>'ageYears')::smallint,
    age_updated_at = (p_client->>'ageUpdatedAt')::date,
    height_cm = (p_client->>'heightCm')::numeric,
    goal = nullif(btrim(p_client->>'goal'), ''),
    version = client.version + 1
  where client.id = client_id_value
    and public.is_active_client_trainer_connection(client.id, actor_id)
    and client.version = p_expected_version
  returning client.version into next_version;

  if next_version is null then
    if public.is_active_client_trainer_connection(client_id_value, actor_id) then
      raise exception 'client_conflict' using errcode = 'PT409';
    end if;
    raise exception 'client_forbidden' using errcode = 'PT403';
  end if;

  update public.client_private_details
  set note = nullif(btrim(p_client->>'note'), '')
  where client_id = client_id_value and trainer_id = actor_id;

  return next_version;
end;
$$;
