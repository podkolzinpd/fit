-- Up Migration

create table app_private.referral_sources (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  label text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint referral_sources_code_format check (code ~ '^[a-z0-9-]{3,64}$'),
  constraint referral_sources_label_not_blank check (btrim(label) <> '')
);

create table app_private.referral_clicks (
  id bigint generated always as identity primary key,
  source_id uuid not null references app_private.referral_sources(id) on delete restrict,
  clicked_at timestamptz not null default now()
);
create index referral_clicks_source_clicked_idx
  on app_private.referral_clicks (source_id, clicked_at desc);

create table app_private.referral_registrations (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  source_id uuid not null references app_private.referral_sources(id) on delete restrict,
  registered_at timestamptz not null default now()
);
create index referral_registrations_source_registered_idx
  on app_private.referral_registrations (source_id, registered_at desc);

insert into app_private.referral_sources (code, label)
values ('staff-001', 'Сотрудница')
on conflict (code) do nothing;

create function app_private.record_referral_click(p_code text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_id_value uuid;
begin
  if p_code !~ '^[a-z0-9-]{3,64}$' then return false; end if;
  select source.id into source_id_value
  from app_private.referral_sources source
  where source.code = p_code and source.active;
  if source_id_value is null then return false; end if;
  insert into app_private.referral_clicks (source_id) values (source_id_value);
  return true;
end;
$$;

create function app_private.register_yandex_account(
  p_subject_sha256 text,
  p_first_name text,
  p_timezone text,
  p_account_role text,
  p_terms_version text,
  p_privacy_version text,
  p_referral_code text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid;
  existing_origin text;
  source_id_value uuid;
begin
  if p_subject_sha256 !~ '^[0-9a-f]{64}$'
    or p_account_role not in ('trainer', 'client')
    or char_length(btrim(p_first_name)) not between 2 and 120
    or char_length(btrim(p_timezone)) not between 1 and 100
    or char_length(p_terms_version) not between 1 and 32
    or char_length(p_privacy_version) not between 1 and 32
    or (p_referral_code is not null and p_referral_code !~ '^[a-z0-9-]{3,64}$')
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
  insert into public.profiles (id, first_name, timezone, account_role)
  values (actor_id, btrim(p_first_name), btrim(p_timezone), p_account_role);

  if p_account_role = 'trainer' then
    insert into public.trainers (profile_id) values (actor_id);
  end if;

  insert into app_private.auth_identities (
    provider, provider_subject_sha256, profile_id, identity_origin
  ) values ('yandex', p_subject_sha256, actor_id, 'native');

  insert into app_private.profile_rollout_assignments (
    profile_id, target_backend, access_mode, enabled
  ) values (actor_id, 'yandex', 'read_write', true);

  insert into public.user_legal_acceptances (
    user_id, terms_version, privacy_version, source
  ) values (actor_id, p_terms_version, p_privacy_version, 'registration');

  if p_referral_code is not null then
    select source.id into source_id_value
    from app_private.referral_sources source
    where source.code = p_referral_code and source.active;
    if source_id_value is not null then
      insert into app_private.referral_registrations (profile_id, source_id)
      values (actor_id, source_id_value);
    end if;
  end if;

  return actor_id;
end;
$$;

create function app_private.register_yandex_account_from_handoff(
  p_token_sha256 text,
  p_first_name text,
  p_timezone text,
  p_account_role text,
  p_terms_version text,
  p_privacy_version text,
  p_referral_code text
)
returns table (profile_id uuid, subject_sha256 text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  handoff_subject_sha256 text;
  registered_profile_id uuid;
begin
  if p_token_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'yandex_auth_handoff_invalid' using errcode = 'PT422';
  end if;

  select handoff.subject_sha256 into handoff_subject_sha256
  from app_private.yandex_auth_handoffs handoff
  where handoff.token_sha256 = p_token_sha256
    and handoff.expires_at > now()
    and handoff.used_at is null
  for update;

  if handoff_subject_sha256 is null then
    raise exception 'yandex_auth_handoff_expired' using errcode = 'PT401';
  end if;

  registered_profile_id := app_private.register_yandex_account(
    handoff_subject_sha256, p_first_name, p_timezone, p_account_role,
    p_terms_version, p_privacy_version, p_referral_code
  );
  update app_private.yandex_auth_handoffs
  set used_at = now() where token_sha256 = p_token_sha256;
  return query select registered_profile_id, handoff_subject_sha256;
end;
$$;

revoke all on function app_private.record_referral_click(text) from public;
revoke all on function app_private.register_yandex_account(
  text, text, text, text, text, text, text
) from public;
revoke all on function app_private.register_yandex_account_from_handoff(
  text, text, text, text, text, text, text
) from public;
grant execute on function app_private.record_referral_click(text) to fit_api;
grant execute on function app_private.register_yandex_account(
  text, text, text, text, text, text, text
) to fit_api;
grant execute on function app_private.register_yandex_account_from_handoff(
  text, text, text, text, text, text, text
) to fit_api;

-- Down Migration

revoke execute on function app_private.register_yandex_account_from_handoff(
  text, text, text, text, text, text, text
) from fit_api;
revoke execute on function app_private.register_yandex_account(
  text, text, text, text, text, text, text
) from fit_api;
revoke execute on function app_private.record_referral_click(text) from fit_api;
drop function app_private.register_yandex_account_from_handoff(
  text, text, text, text, text, text, text
);
drop function app_private.register_yandex_account(
  text, text, text, text, text, text, text
);
drop function app_private.record_referral_click(text);
drop table app_private.referral_registrations;
drop table app_private.referral_clicks;
drop table app_private.referral_sources;
