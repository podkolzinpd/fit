-- Up Migration

create or replace function public.update_client_card(
  p_client_id uuid,
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
  full_name_value text := btrim(p_client->>'fullName');
  next_version bigint;
begin
  if char_length(full_name_value) < 2 or char_length(full_name_value) > 120 then
    raise exception 'client_invalid' using errcode = 'PT422';
  end if;

  update public.clients client
  set
    full_name = full_name_value,
    gender = nullif(p_client->>'gender', ''),
    age_years = nullif(p_client->>'ageYears', '')::smallint,
    age_updated_at = nullif(p_client->>'ageUpdatedAt', '')::date,
    height_cm = nullif(p_client->>'heightCm', '')::numeric,
    goal = nullif(btrim(p_client->>'goal'), ''),
    version = client.version + 1
  where client.id = p_client_id
    and (
      client.auth_user_id = actor_id
      or public.is_active_client_trainer_connection(client.id, actor_id)
    )
    and client.version = p_expected_version
  returning client.version into next_version;

  if next_version is null then
    if exists (
      select 1 from public.clients client
      where client.id = p_client_id
        and (
          client.auth_user_id = actor_id
          or public.is_active_client_trainer_connection(client.id, actor_id)
        )
    ) then
      raise exception 'client_conflict' using errcode = 'PT409';
    end if;
    raise exception 'client_forbidden' using errcode = 'PT403';
  end if;

  return next_version;
exception
  when check_violation
    or invalid_text_representation
    or numeric_value_out_of_range
  then
    raise exception 'client_invalid' using errcode = 'PT422';
end;
$$;

-- Down Migration

create or replace function public.update_client_card(
  p_client_id uuid,
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
  full_name_value text := btrim(p_client->>'fullName');
  next_version bigint;
begin
  if char_length(full_name_value) < 2 or char_length(full_name_value) > 120 then
    raise exception 'client_invalid' using errcode = 'PT422';
  end if;

  update public.clients client
  set
    full_name = full_name_value,
    gender = nullif(p_client->>'gender', ''),
    age_years = nullif(p_client->>'ageYears', '')::smallint,
    age_updated_at = nullif(p_client->>'ageUpdatedAt', '')::date,
    height_cm = nullif(p_client->>'heightCm', '')::numeric,
    goal = nullif(btrim(p_client->>'goal'), ''),
    version = client.version + 1
  where client.id = p_client_id
    and (client.trainer_id = actor_id or client.auth_user_id = actor_id)
    and client.version = p_expected_version
  returning client.version into next_version;

  if next_version is null then
    if exists (
      select 1 from public.clients client
      where client.id = p_client_id
        and (client.trainer_id = actor_id or client.auth_user_id = actor_id)
    ) then
      raise exception 'client_conflict' using errcode = 'PT409';
    end if;
    raise exception 'client_forbidden' using errcode = 'PT403';
  end if;

  return next_version;
exception
  when check_violation
    or invalid_text_representation
    or numeric_value_out_of_range
  then
    raise exception 'client_invalid' using errcode = 'PT422';
end;
$$;
