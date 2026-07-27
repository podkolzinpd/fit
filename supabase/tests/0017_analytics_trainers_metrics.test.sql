begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

select has_schema('analytics', 'analytics schema exists');
select ok(
  exists(select 1 from pg_matviews where schemaname = 'analytics' and matviewname = 'trainers_metrics'),
  'analytics.trainers_metrics matview exists'
);
select ok(
  exists(select 1 from pg_roles where rolname = 'datalens_reader'),
  'datalens_reader role exists'
);

-- seed.sql заводит только auth.users/auth.identities — строка в
-- public.trainers появляется лишь после initialize_trainer (как в проде,
-- на первом входе), поэтому заводим тренера явно, как в 0003_rpc.test.sql.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password)
values ('50000000-0000-4000-8000-000000000015', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'analytics@example.test', '');
set local role authenticated;
select set_config('request.jwt.claim.sub', '50000000-0000-4000-8000-000000000015', true);
select public.initialize_trainer('Analytics', 'Test', 'Europe/Moscow');
reset role;

refresh materialized view analytics.trainers_metrics;
select is(
  (select trainers_total from analytics.trainers_metrics)::int,
  1,
  'trainers_total reflects the freshly initialized trainer'
);

select * from finish();
rollback;
