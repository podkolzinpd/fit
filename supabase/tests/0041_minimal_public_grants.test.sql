begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

select is(
  (
    select count(*)
    from information_schema.role_table_grants
    where table_schema = 'public'
      and grantee in ('anon', 'authenticated')
      and privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER')
  ),
  0::bigint,
  'browser roles have no table truncate, reference, or trigger privileges'
);

select is(
  (
    select count(*)
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    cross join lateral aclexplode(coalesce(procedure.proacl, acldefault('f', procedure.proowner))) privilege
    where namespace.nspname = 'public'
      and procedure.prosecdef
      and privilege.grantee = 0
      and privilege.privilege_type = 'EXECUTE'
  ),
  0::bigint,
  'SECURITY DEFINER functions do not grant execute to PUBLIC'
);

select ok(
  has_function_privilege('authenticated', 'public.save_workout(jsonb,bigint)'::regprocedure, 'EXECUTE'),
  'authenticated keeps explicit access to the workout save RPC'
);

select ok(
  has_function_privilege('authenticated', 'public.list_workouts(date,date,uuid,integer,integer)'::regprocedure, 'EXECUTE'),
  'authenticated keeps explicit access to the workout list RPC'
);

select ok(
  exists (
    select 1
    from pg_default_acl defaults
    join pg_namespace namespace on namespace.oid = defaults.defaclnamespace
    join pg_roles owner on owner.oid = defaults.defaclrole
    where namespace.nspname = 'public'
      and owner.rolname = 'postgres'
      and defaults.defaclobjtype = 'f'
  ),
  'future public functions have an explicit default ACL'
);

select * from finish();
rollback;
