begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password)
values ('a8000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'one-active@example.test', '');
insert into public.profiles (id, account_role, first_name)
values ('a8000000-0000-4000-8000-000000000001', 'trainer', 'One active');
insert into public.trainers (profile_id) values ('a8000000-0000-4000-8000-000000000001');
insert into public.clients (id, trainer_id, full_name, gender, age_years, height_cm)
values ('a8000000-0000-4000-8000-000000000002', 'a8000000-0000-4000-8000-000000000001', 'Single live client', 'female', 30, 170);
insert into public.workouts (id, trainer_id, client_id, workout_date, status, version)
values
  ('a8000000-0000-4000-8000-000000000003', 'a8000000-0000-4000-8000-000000000001', 'a8000000-0000-4000-8000-000000000002', current_date, 'planned', 1),
  ('a8000000-0000-4000-8000-000000000004', 'a8000000-0000-4000-8000-000000000001', 'a8000000-0000-4000-8000-000000000002', current_date + 1, 'planned', 1);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a8000000-0000-4000-8000-000000000001', true);

select is(
  public.start_workout('a8000000-0000-4000-8000-000000000003', 1),
  2::bigint,
  'first planned workout starts'
);
select throws_ok(
  $$select public.start_workout('a8000000-0000-4000-8000-000000000004', 1)$$,
  'PT409', 'active_workout_exists',
  'second live workout is rejected with a stable conflict'
);
select is(
  (select status from public.workouts where id = 'a8000000-0000-4000-8000-000000000004'),
  'planned',
  'rejected workout stays planned'
);
select is(
  (select count(*) from public.workouts where client_id = 'a8000000-0000-4000-8000-000000000002' and status = 'in_progress' and deleted_at is null),
  1::bigint,
  'client has exactly one active workout'
);
reset role;
select throws_ok(
  $$update public.workouts set status = 'in_progress', started_at = now() where id = 'a8000000-0000-4000-8000-000000000004'$$,
  '23505', null,
  'partial unique index protects against bypassing the RPC'
);
select ok(
  exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'workouts_one_active_per_client_uidx'),
  'active workout uniqueness is enforced by a partial index'
);

select * from finish();
rollback;
