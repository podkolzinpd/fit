-- The first client action is an ensure operation. Recover a stale link from an
-- archived merged row to its canonical card and restore an archived own card.
create or replace function public.create_quick_own_client(p_full_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  existing_client public.clients%rowtype;
  canonical_client public.clients%rowtype;
  canonical_id uuid;
  depth integer;
  created_id uuid := gen_random_uuid();
  full_name_value text := btrim(p_full_name);
begin
  if actor_id is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;
  if not exists (
    select 1 from public.profiles
    where id = actor_id and account_role = 'client'
  ) then
    raise exception 'client_account_required' using errcode = 'PT403';
  end if;
  if char_length(full_name_value) < 2 then
    raise exception 'client_name_too_short' using errcode = '22023';
  end if;
  if char_length(full_name_value) > 120 then
    raise exception 'client_name_too_long' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('quick_own_client:' || actor_id::text, 0)
  );

  select client.* into existing_client
  from public.clients client
  where client.auth_user_id = actor_id
  for update;

  if existing_client.id is not null then
    canonical_id := existing_client.id;

    for depth in 1..8 loop
      select client.* into canonical_client
      from public.clients client
      where client.id = canonical_id
      for update;

      if canonical_client.id is null then
        raise exception 'client_card_conflict' using errcode = 'PT409';
      end if;
      exit when canonical_client.merged_into_client_id is null;
      canonical_id := canonical_client.merged_into_client_id;
    end loop;

    if canonical_client.merged_into_client_id is not null then
      raise exception 'client_card_conflict' using errcode = 'PT409';
    end if;
    if canonical_client.auth_user_id is not null
      and canonical_client.auth_user_id <> actor_id
    then
      raise exception 'client_card_conflict' using errcode = 'PT409';
    end if;

    if existing_client.id <> canonical_client.id then
      update public.clients client
      set auth_user_id = null,
          version = client.version + 1
      where client.id = existing_client.id
        and client.auth_user_id = actor_id;

      update public.clients client
      set auth_user_id = actor_id,
          archived_at = null,
          version = client.version + 1
      where client.id = canonical_client.id
        and client.auth_user_id is null
      returning client.* into canonical_client;

      if canonical_client.id is null then
        raise exception 'client_card_conflict' using errcode = 'PT409';
      end if;
    elsif canonical_client.archived_at is not null then
      update public.clients client
      set archived_at = null,
          version = client.version + 1
      where client.id = canonical_client.id
      returning client.* into canonical_client;
    end if;

    return canonical_client.id;
  end if;

  insert into public.clients (id, trainer_id, auth_user_id, full_name)
  values (created_id, actor_id, actor_id, full_name_value);

  insert into public.client_private_details (client_id, trainer_id)
  values (created_id, actor_id);

  return created_id;
end;
$$;

revoke all on function public.create_quick_own_client(text) from public, anon;
grant execute on function public.create_quick_own_client(text) to authenticated;
