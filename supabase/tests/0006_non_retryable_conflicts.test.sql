begin;
create extension if not exists pgtap with schema extensions;
select plan(1);

select is(
  (
    select count(*)
    from pg_proc function
    join pg_namespace namespace on namespace.oid = function.pronamespace
    where namespace.nspname = 'public'
      and function.prokind = 'f'
      and function.prosrc like '%40001%'
  ),
  0::bigint,
  'business RPCs never raise retryable serialization_failure'
);

select * from finish();
rollback;
