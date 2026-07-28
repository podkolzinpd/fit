alter table public.client_trainers
  add column alias text,
  add column note text,
  add column version bigint not null default 1;

alter table public.client_trainers
  add constraint client_trainers_alias_not_blank
    check (alias is null or btrim(alias) <> ''),
  add constraint client_trainers_alias_length
    check (alias is null or char_length(alias) <= 120),
  add constraint client_trainers_note_length
    check (note is null or char_length(note) <= 5000);

update public.client_trainers membership
set alias = (
      select client.full_name
      from public.clients client
      where client.id = membership.client_id
    ),
    note = (
      select details.note
      from public.client_private_details details
      where details.client_id = membership.client_id
        and details.trainer_id = membership.trainer_id
    );

create or replace function public.create_client(p_client jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  created_id uuid;
  initial_weight numeric;
  full_name_value text := btrim(p_client->>'fullName');
  note_value text := nullif(btrim(p_client->>'note'), '');
begin
  if actor_id is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;
  if not exists (select 1 from public.trainers where profile_id = actor_id) then
    raise exception 'trainer_not_initialized' using errcode = 'PT422';
  end if;

  insert into public.clients (
    trainer_id, full_name, gender, age_years, age_updated_at, height_cm, goal
  ) values (
    actor_id,
    full_name_value,
    p_client->>'gender',
    (p_client->>'ageYears')::smallint,
    coalesce((p_client->>'ageUpdatedAt')::date, current_date),
    (p_client->>'heightCm')::numeric,
    nullif(btrim(p_client->>'goal'), '')
  ) returning id into created_id;

  insert into public.client_private_details (client_id, trainer_id, note)
  values (created_id, actor_id, note_value);

  insert into public.client_trainers (client_id, trainer_id, alias, note)
  values (created_id, actor_id, full_name_value, note_value);

  initial_weight := nullif(p_client->>'initialWeightKg', '')::numeric;
  if initial_weight is not null then
    insert into public.client_progress (trainer_id, client_id, recorded_on, weight_kg, created_by)
    values (
      actor_id,
      created_id,
      coalesce((p_client->>'initialWeightRecordedOn')::date, current_date),
      initial_weight,
      actor_id
    );
  end if;

  return created_id;
end;
$$;

create or replace function public.claim_client_invitation(p_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_role text;
  invitation public.client_invitations;
begin
  if actor_id is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;
  select account_role into actor_role from public.profiles where id = actor_id;

  select * into invitation
  from public.client_invitations
  where code_hash = encode(extensions.digest(upper(btrim(p_code)), 'sha256'), 'hex')
  for update;

  if invitation.id is null
    or invitation.revoked_at is not null
    or invitation.claimed_at is not null
    or invitation.expires_at <= now()
  then
    raise exception 'invitation_invalid' using errcode = 'PT404';
  end if;
  if actor_role <> invitation.target_role then
    raise exception 'invitation_role_mismatch' using errcode = 'PT403';
  end if;

  if invitation.target_role = 'client' then
    update public.clients
    set auth_user_id = actor_id
    where id = invitation.client_id and auth_user_id is null;
    if not found then
      raise exception 'client_already_linked' using errcode = 'PT409';
    end if;
  else
    insert into public.client_trainers (client_id, trainer_id, alias)
    select client.id, actor_id, client.full_name
    from public.clients client
    where client.id = invitation.client_id
    on conflict (client_id, trainer_id) do nothing;
  end if;

  update public.client_invitations
  set claimed_by = actor_id, claimed_at = now()
  where id = invitation.id;

  return invitation.client_id;
end;
$$;

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
  where (client.trainer_id = actor_id or membership.trainer_id is not null)
    and (p_include_archived or client.archived_at is null)
  order by client.created_at desc;
end;
$$;

revoke all on function public.list_clients(boolean) from public, anon;
grant execute on function public.list_clients(boolean) to authenticated;

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
  next_version bigint;
begin
  update public.clients set
    full_name = btrim(p_client->>'fullName'),
    gender = p_client->>'gender',
    age_years = (p_client->>'ageYears')::smallint,
    age_updated_at = (p_client->>'ageUpdatedAt')::date,
    height_cm = (p_client->>'heightCm')::numeric,
    goal = nullif(btrim(p_client->>'goal'), ''),
    version = version + 1
  where id = (p_client->>'id')::uuid
    and auth_user_id = actor_id
    and version = p_expected_version
  returning version into next_version;

  if next_version is null then
    if not exists (
      select 1 from public.clients
      where id = (p_client->>'id')::uuid and auth_user_id = actor_id
    ) then
      raise exception 'client_profile_access_denied' using errcode = 'PT403';
    end if;
    raise exception 'client_conflict' using errcode = 'PT409';
  end if;
  return next_version;
end;
$$;

create or replace function public.update_client_trainer_preferences(
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
  next_version bigint;
begin
  update public.client_trainers
  set alias = nullif(btrim(p_alias), ''),
      note = nullif(btrim(p_note), ''),
      version = version + 1
  where client_id = p_client_id
    and trainer_id = auth.uid()
    and version = p_expected_version
  returning version into next_version;

  if next_version is null then
    if not exists (
      select 1 from public.client_trainers
      where client_id = p_client_id and trainer_id = auth.uid()
    ) then
      raise exception 'membership_not_allowed' using errcode = 'PT403';
    end if;
    raise exception 'client_preferences_conflict' using errcode = 'PT409';
  end if;
  return next_version;
end;
$$;

revoke all on function public.update_own_client(jsonb, bigint) from public, anon;
revoke all on function public.update_client_trainer_preferences(uuid, text, text, bigint) from public, anon;
grant execute on function public.update_own_client(jsonb, bigint) to authenticated;
grant execute on function public.update_client_trainer_preferences(uuid, text, text, bigint) to authenticated;
