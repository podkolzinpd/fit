-- Up Migration

create or replace function public.create_client_card(p_client jsonb)
returns table (client_id uuid, version bigint, membership_version bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_role text;
  full_name_value text := btrim(p_client->>'fullName');
  created_id uuid;
begin
  select profile.account_role into actor_role
  from public.profiles profile
  where profile.id = actor_id;

  if actor_id is null or actor_role not in ('trainer', 'client') then
    raise exception 'client_forbidden' using errcode = 'PT403';
  end if;
  if char_length(full_name_value) < 2 or char_length(full_name_value) > 120 then
    raise exception 'client_invalid' using errcode = 'PT422';
  end if;

  if actor_role = 'client' and exists (
    select 1 from public.clients client where client.auth_user_id = actor_id
  ) then
    raise exception 'client_already_exists' using errcode = 'PT409';
  end if;
  if actor_role = 'client' and nullif(btrim(p_client->>'note'), '') is not null then
    raise exception 'client_invalid' using errcode = 'PT422';
  end if;

  insert into public.clients (
    trainer_id, auth_user_id, full_name, gender, age_years,
    age_updated_at, height_cm, goal
  ) values (
    actor_id,
    case when actor_role = 'client' then actor_id else null end,
    full_name_value,
    nullif(p_client->>'gender', ''),
    nullif(p_client->>'ageYears', '')::smallint,
    nullif(p_client->>'ageUpdatedAt', '')::date,
    nullif(p_client->>'heightCm', '')::numeric,
    nullif(btrim(p_client->>'goal'), '')
  )
  returning id into created_id;

  if actor_role = 'trainer' then
    insert into public.client_trainers (client_id, trainer_id, alias, note)
    values (
      created_id,
      actor_id,
      full_name_value,
      nullif(btrim(p_client->>'note'), '')
    );
  end if;

  return query select created_id, 1::bigint, 1::bigint;
exception
  when check_violation
    or invalid_text_representation
    or numeric_value_out_of_range
  then
    raise exception 'client_invalid' using errcode = 'PT422';
end;
$$;

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
end;
$$;

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

create or replace function public.create_custom_exercise(p_exercise jsonb)
returns table (
  exercise_id uuid,
  exercise_name text,
  muscle_group text,
  input_kind text,
  archived_at timestamptz,
  version bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_role text;
begin
  select profile.account_role into actor_role
  from public.profiles profile
  where profile.id = actor_id;
  if actor_role <> 'trainer' then
    raise exception 'custom_exercise_forbidden' using errcode = 'PT403';
  end if;

  return query
  insert into public.custom_exercises (
    trainer_id, name, muscle_group, input_kind
  ) values (
    actor_id,
    btrim(p_exercise->>'name'),
    p_exercise->>'muscleGroup',
    p_exercise->>'inputKind'
  )
  returning
    id,
    name,
    public.custom_exercises.muscle_group,
    public.custom_exercises.input_kind,
    public.custom_exercises.archived_at,
    public.custom_exercises.version;
exception
  when unique_violation then
    raise exception 'custom_exercise_conflict' using errcode = 'PT409';
  when check_violation then
    raise exception 'custom_exercise_invalid' using errcode = 'PT422';
end;
$$;

create or replace function public.update_custom_exercise(
  p_exercise_id uuid,
  p_exercise jsonb,
  p_expected_version bigint
)
returns table (
  exercise_id uuid,
  exercise_name text,
  muscle_group text,
  input_kind text,
  archived_at timestamptz,
  version bigint
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  update public.custom_exercises exercise
  set
    name = btrim(p_exercise->>'name'),
    muscle_group = p_exercise->>'muscleGroup',
    input_kind = p_exercise->>'inputKind',
    version = exercise.version + 1
  where exercise.id = p_exercise_id
    and exercise.trainer_id = auth.uid()
    and exercise.version = p_expected_version
  returning
    exercise.id,
    exercise.name,
    exercise.muscle_group,
    exercise.input_kind,
    exercise.archived_at,
    exercise.version;

  if not found then
    if exists (
      select 1 from public.custom_exercises exercise
      where exercise.id = p_exercise_id and exercise.trainer_id = auth.uid()
    ) then
      raise exception 'custom_exercise_conflict' using errcode = 'PT409';
    end if;
    raise exception 'custom_exercise_forbidden' using errcode = 'PT403';
  end if;
exception
  when unique_violation then
    raise exception 'custom_exercise_conflict' using errcode = 'PT409';
  when check_violation then
    raise exception 'custom_exercise_invalid' using errcode = 'PT422';
end;
$$;

create or replace function public.set_custom_exercise_archived(
  p_exercise_id uuid,
  p_archived boolean,
  p_expected_version bigint
)
returns table (
  exercise_id uuid,
  exercise_name text,
  muscle_group text,
  input_kind text,
  archived_at timestamptz,
  version bigint
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  update public.custom_exercises exercise
  set
    archived_at = case when p_archived then now() else null end,
    version = exercise.version + 1
  where exercise.id = p_exercise_id
    and exercise.trainer_id = auth.uid()
    and exercise.version = p_expected_version
  returning
    exercise.id,
    exercise.name,
    exercise.muscle_group,
    exercise.input_kind,
    exercise.archived_at,
    exercise.version;

  if not found then
    if exists (
      select 1 from public.custom_exercises exercise
      where exercise.id = p_exercise_id and exercise.trainer_id = auth.uid()
    ) then
      raise exception 'custom_exercise_conflict' using errcode = 'PT409';
    end if;
    raise exception 'custom_exercise_forbidden' using errcode = 'PT403';
  end if;
exception
  when unique_violation then
    raise exception 'custom_exercise_conflict' using errcode = 'PT409';
end;
$$;

revoke all on function public.create_client_card(jsonb) from public;
revoke all on function public.update_client_card(uuid, jsonb, bigint) from public;
revoke all on function public.set_client_archived(uuid, boolean, bigint) from public;
revoke all on function public.update_client_preferences(uuid, text, text, bigint) from public;
revoke all on function public.create_custom_exercise(jsonb) from public;
revoke all on function public.update_custom_exercise(uuid, jsonb, bigint) from public;
revoke all on function public.set_custom_exercise_archived(uuid, boolean, bigint) from public;

grant execute on function public.create_client_card(jsonb) to fit_api;
grant execute on function public.update_client_card(uuid, jsonb, bigint) to fit_api;
grant execute on function public.set_client_archived(uuid, boolean, bigint) to fit_api;
grant execute on function public.update_client_preferences(uuid, text, text, bigint) to fit_api;
grant execute on function public.create_custom_exercise(jsonb) to fit_api;
grant execute on function public.update_custom_exercise(uuid, jsonb, bigint) to fit_api;
grant execute on function public.set_custom_exercise_archived(uuid, boolean, bigint) to fit_api;

-- Down Migration

revoke execute on function public.set_custom_exercise_archived(uuid, boolean, bigint) from fit_api;
revoke execute on function public.update_custom_exercise(uuid, jsonb, bigint) from fit_api;
revoke execute on function public.create_custom_exercise(jsonb) from fit_api;
revoke execute on function public.update_client_preferences(uuid, text, text, bigint) from fit_api;
revoke execute on function public.set_client_archived(uuid, boolean, bigint) from fit_api;
revoke execute on function public.update_client_card(uuid, jsonb, bigint) from fit_api;
revoke execute on function public.create_client_card(jsonb) from fit_api;

drop function public.set_custom_exercise_archived(uuid, boolean, bigint);
drop function public.update_custom_exercise(uuid, jsonb, bigint);
drop function public.create_custom_exercise(jsonb);
drop function public.update_client_preferences(uuid, text, text, bigint);
drop function public.set_client_archived(uuid, boolean, bigint);
drop function public.update_client_card(uuid, jsonb, bigint);
drop function public.create_client_card(jsonb);
