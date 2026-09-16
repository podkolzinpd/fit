-- Up Migration

create or replace function public.has_yandex_identity()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from app_private.auth_identities identity
    where identity.provider = 'yandex'
      and identity.profile_id = auth.uid()
  )
$$;

revoke all on function public.has_yandex_identity() from public;
grant execute on function public.has_yandex_identity() to fit_api;

-- Down Migration

revoke execute on function public.has_yandex_identity() from fit_api;
drop function public.has_yandex_identity();
