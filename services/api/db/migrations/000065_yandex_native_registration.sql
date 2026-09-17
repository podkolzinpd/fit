-- Up Migration

alter table app_private.auth_identities
  add column identity_origin text not null default 'linked',
  add constraint auth_identities_origin_allowed
    check (identity_origin in ('linked', 'native'));

create table public.user_legal_acceptances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  terms_version text not null check (char_length(terms_version) between 1 and 32),
  privacy_version text not null check (char_length(privacy_version) between 1 and 32),
  source text not null check (source in ('registration', 'existing_user')),
  accepted_at timestamptz not null default now(),
  constraint user_legal_acceptances_version_unique
    unique (user_id, terms_version, privacy_version)
);

create index user_legal_acceptances_user_accepted_idx
  on public.user_legal_acceptances (user_id, accepted_at desc);

alter table public.user_legal_acceptances enable row level security;

revoke all on public.user_legal_acceptances from public;

create or replace function app_private.register_yandex_account(
  p_subject_sha256 text,
  p_first_name text,
  p_timezone text,
  p_account_role text,
  p_terms_version text,
  p_privacy_version text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid;
  existing_origin text;
begin
  if p_subject_sha256 !~ '^[0-9a-f]{64}$'
    or p_account_role not in ('trainer', 'client')
    or char_length(btrim(p_first_name)) not between 2 and 120
    or char_length(btrim(p_timezone)) not between 1 and 100
    or char_length(p_terms_version) not between 1 and 32
    or char_length(p_privacy_version) not between 1 and 32
  then
    raise exception 'yandex_registration_invalid' using errcode = 'PT422';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('yandex_identity:' || p_subject_sha256, 0)
  );

  select identity.profile_id, identity.identity_origin
  into actor_id, existing_origin
  from app_private.auth_identities identity
  where identity.provider = 'yandex'
    and identity.provider_subject_sha256 = p_subject_sha256
  for update;

  if actor_id is not null then
    if existing_origin <> 'native' then
      raise exception 'yandex_identity_existing_account' using errcode = 'PT409';
    end if;

    insert into public.user_legal_acceptances (
      user_id, terms_version, privacy_version, source
    ) values (
      actor_id, p_terms_version, p_privacy_version, 'registration'
    ) on conflict (user_id, terms_version, privacy_version) do nothing;

    return actor_id;
  end if;

  actor_id := gen_random_uuid();

  insert into public.profiles (
    id, first_name, timezone, account_role
  ) values (
    actor_id, btrim(p_first_name), btrim(p_timezone), p_account_role
  );

  if p_account_role = 'trainer' then
    insert into public.trainers (profile_id) values (actor_id);
  end if;

  insert into app_private.auth_identities (
    provider, provider_subject_sha256, profile_id, identity_origin
  ) values (
    'yandex', p_subject_sha256, actor_id, 'native'
  );

  insert into app_private.profile_rollout_assignments (
    profile_id, target_backend, access_mode, enabled
  ) values (
    actor_id, 'yandex', 'read_write', true
  );

  insert into public.user_legal_acceptances (
    user_id, terms_version, privacy_version, source
  ) values (
    actor_id, p_terms_version, p_privacy_version, 'registration'
  );

  return actor_id;
end;
$$;

revoke all on function app_private.register_yandex_account(
  text, text, text, text, text, text
) from public;
grant execute on function app_private.register_yandex_account(
  text, text, text, text, text, text
) to fit_api;

-- Down Migration

revoke execute on function app_private.register_yandex_account(
  text, text, text, text, text, text
) from fit_api;
drop function app_private.register_yandex_account(
  text, text, text, text, text, text
);
drop table public.user_legal_acceptances;
alter table app_private.auth_identities
  drop constraint auth_identities_origin_allowed,
  drop column identity_origin;
