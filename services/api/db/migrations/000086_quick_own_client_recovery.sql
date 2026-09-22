-- Up Migration

-- The first client action is an ensure operation, not an unconditional insert.
-- Besides making retries safe, it repairs the only state in which the profile
-- has no current client while clients.auth_user_id is already occupied: the
-- linked row has been archived and redirected to a canonical client.
create or replace function public.create_quick_own_client_card(p_full_name text)
returns table (client_id uuid, version bigint, membership_version bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_role text;
  full_name_value text := btrim(p_full_name);
  linked_client public.clients%rowtype;
  canonical_client public.clients%rowtype;
  canonical_id uuid;
  depth integer;
  created_id uuid;
begin
  select profile.account_role into actor_role
  from public.profiles profile
  where profile.id = actor_id;

  if actor_id is null or actor_role <> 'client' then
    raise exception 'client_forbidden' using errcode = 'PT403';
  end if;
  if char_length(full_name_value) < 2 or char_length(full_name_value) > 120 then
    raise exception 'client_invalid' using errcode = 'PT422';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('quick_own_client:' || actor_id::text, 0)
  );

  select client.* into linked_client
  from public.clients client
  where client.auth_user_id = actor_id
  for update;

  if linked_client.id is not null then
    canonical_id := linked_client.id;

    for depth in 1..8 loop
      select client.* into canonical_client
      from public.clients client
      where client.id = canonical_id
      for update;

      if canonical_client.id is null then
        raise exception 'client_conflict' using errcode = 'PT409';
      end if;
      exit when canonical_client.merged_into_client_id is null;
      canonical_id := canonical_client.merged_into_client_id;
    end loop;

    if canonical_client.merged_into_client_id is not null then
      raise exception 'client_conflict' using errcode = 'PT409';
    end if;
    if canonical_client.auth_user_id is not null
      and canonical_client.auth_user_id <> actor_id
    then
      raise exception 'client_conflict' using errcode = 'PT409';
    end if;

    if linked_client.id <> canonical_client.id then
      update public.clients client
      set auth_user_id = null,
          version = client.version + 1
      where client.id = linked_client.id
        and client.auth_user_id = actor_id;

      update public.clients client
      set auth_user_id = actor_id,
          archived_at = null,
          version = client.version + 1
      where client.id = canonical_client.id
        and client.auth_user_id is null
      returning client.* into canonical_client;

      if canonical_client.id is null then
        raise exception 'client_conflict' using errcode = 'PT409';
      end if;
    elsif canonical_client.archived_at is not null then
      update public.clients client
      set archived_at = null,
          version = client.version + 1
      where client.id = canonical_client.id
      returning client.* into canonical_client;
    end if;

    return query select canonical_client.id, canonical_client.version, 1::bigint;
    return;
  end if;

  insert into public.clients (trainer_id, auth_user_id, full_name)
  values (actor_id, actor_id, full_name_value)
  returning id into created_id;

  return query select created_id, 1::bigint, 1::bigint;
exception
  when check_violation then
    raise exception 'client_invalid' using errcode = 'PT422';
end;
$$;

revoke all on function public.create_quick_own_client_card(text) from public;
grant execute on function public.create_quick_own_client_card(text) to fit_api;

-- Down Migration

revoke execute on function public.create_quick_own_client_card(text) from fit_api;
drop function public.create_quick_own_client_card(text);
