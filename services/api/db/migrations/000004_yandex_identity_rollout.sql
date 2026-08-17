-- Up Migration

create table app_private.auth_identities (
  provider text not null,
  provider_subject_sha256 text not null,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint auth_identities_pkey
    primary key (provider, provider_subject_sha256),
  constraint auth_identities_profile_provider_unique
    unique (profile_id, provider),
  constraint auth_identities_provider_allowed
    check (provider = 'yandex'),
  constraint auth_identities_subject_sha256_format
    check (provider_subject_sha256 ~ '^[0-9a-f]{64}$')
);

create table app_private.profile_rollout_assignments (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  target_backend text not null,
  access_mode text not null,
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profile_rollout_target_allowed
    check (target_backend in ('supabase', 'yandex')),
  constraint profile_rollout_access_mode_allowed
    check (access_mode in ('read_only', 'read_write'))
);

create trigger set_updated_at
before update on app_private.profile_rollout_assignments
for each row execute function public.set_updated_at();

create or replace function app_private.resolve_yandex_pilot_actor(
  p_subject_sha256 text
)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select identity.profile_id
  from app_private.auth_identities identity
  join app_private.profile_rollout_assignments rollout
    on rollout.profile_id = identity.profile_id
  where identity.provider = 'yandex'
    and identity.provider_subject_sha256 = p_subject_sha256
    and rollout.target_backend = 'yandex'
    and rollout.access_mode = 'read_only'
    and rollout.enabled
$$;

revoke all on app_private.auth_identities from public;
revoke all on app_private.profile_rollout_assignments from public;
revoke all on function app_private.resolve_yandex_pilot_actor(text) from public;

grant usage on schema app_private to fit_api;
grant execute on function app_private.resolve_yandex_pilot_actor(text) to fit_api;

-- Down Migration

revoke execute on function app_private.resolve_yandex_pilot_actor(text) from fit_api;
drop function app_private.resolve_yandex_pilot_actor(text);
drop table app_private.profile_rollout_assignments;
drop table app_private.auth_identities;
