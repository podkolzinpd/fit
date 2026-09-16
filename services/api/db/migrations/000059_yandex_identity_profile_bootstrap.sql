-- Up Migration

create or replace function public.bootstrap_and_link_yandex_identity(
  p_subject_sha256 text,
  p_first_name text,
  p_last_name text,
  p_timezone text,
  p_account_role text,
  p_profile_created_at timestamptz,
  p_profile_updated_at timestamptz,
  p_trainer_created_at timestamptz,
  p_trainer_updated_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  existing_role text;
begin
  if actor_id is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;
  if p_account_role not in ('trainer', 'client')
    or nullif(btrim(p_timezone), '') is null
    or (p_first_name is not null and nullif(btrim(p_first_name), '') is null)
    or (p_last_name is not null and nullif(btrim(p_last_name), '') is null)
    or p_profile_created_at is null
    or p_profile_updated_at is null
    or p_profile_updated_at < p_profile_created_at
  then
    raise exception 'yandex_source_profile_invalid' using errcode = 'PT422';
  end if;
  if p_account_role = 'trainer' and (
    p_trainer_created_at is null
    or p_trainer_updated_at is null
    or p_trainer_updated_at < p_trainer_created_at
  ) then
    raise exception 'yandex_source_trainer_invalid' using errcode = 'PT422';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('yandex_profile:' || actor_id::text, 0)
  );

  select profile.account_role
  into existing_role
  from public.profiles profile
  where profile.id = actor_id
  for update;

  if existing_role is null then
    insert into public.profiles (
      id,
      first_name,
      last_name,
      timezone,
      account_role,
      created_at,
      updated_at
    ) values (
      actor_id,
      p_first_name,
      p_last_name,
      p_timezone,
      p_account_role,
      p_profile_created_at,
      p_profile_updated_at
    );
  elsif existing_role <> p_account_role then
    raise exception 'yandex_source_profile_role_mismatch' using errcode = 'PT409';
  end if;

  if p_account_role = 'trainer' then
    insert into public.trainers (
      profile_id,
      created_at,
      updated_at
    ) values (
      actor_id,
      p_trainer_created_at,
      p_trainer_updated_at
    )
    on conflict (profile_id) do nothing;
  end if;

  return public.link_yandex_identity(p_subject_sha256);
end;
$$;

revoke all on function public.bootstrap_and_link_yandex_identity(
  text, text, text, text, text, timestamptz, timestamptz, timestamptz, timestamptz
) from public;
grant execute on function public.bootstrap_and_link_yandex_identity(
  text, text, text, text, text, timestamptz, timestamptz, timestamptz, timestamptz
) to fit_api;

-- Down Migration

revoke execute on function public.bootstrap_and_link_yandex_identity(
  text, text, text, text, text, timestamptz, timestamptz, timestamptz, timestamptz
) from fit_api;
drop function public.bootstrap_and_link_yandex_identity(
  text, text, text, text, text, timestamptz, timestamptz, timestamptz, timestamptz
);
