-- Up Migration

create schema if not exists auth;

revoke all on schema auth from public;

create or replace function auth.uid()
returns uuid
language sql
stable
set search_path = ''
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

revoke all on function auth.uid() from public;
grant usage on schema auth to fit_api;
grant execute on function auth.uid() to fit_api;

-- Down Migration

revoke execute on function auth.uid() from fit_api;
revoke usage on schema auth from fit_api;
drop function auth.uid();
drop schema auth;
