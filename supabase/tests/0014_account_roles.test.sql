begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password) values
  ('71000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'role-trainer@example.test', ''),
  ('72000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'role-client@example.test', ''),
  ('73000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'other-client@example.test', '');

set local role authenticated;
select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000001', true);
select lives_ok(
  $$select public.initialize_account('trainer', 'Тренер')$$,
  'trainer account initializes'
);
select is(
  (select account_role from public.profiles where id = '71000000-0000-4000-8000-000000000001'),
  'trainer',
  'trainer role is stored'
);
select ok(
  exists(select 1 from public.trainers where profile_id = '71000000-0000-4000-8000-000000000001'),
  'trainer tenant row is created'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '72000000-0000-4000-8000-000000000002', true);
select lives_ok(
  $$select public.initialize_account('client', 'Клиент')$$,
  'client account initializes'
);
select is(
  (select account_role from public.profiles where id = '72000000-0000-4000-8000-000000000002'),
  'client',
  'client role is stored'
);
select ok(
  not exists(select 1 from public.trainers where profile_id = '72000000-0000-4000-8000-000000000002'),
  'client does not become a trainer'
);
select throws_ok(
  $$select public.initialize_account('trainer')$$,
  'PT409',
  'account_role_immutable',
  'account role cannot be changed'
);
reset role;

insert into public.clients (
  id, trainer_id, auth_user_id, full_name, gender, age_years, height_cm
) values (
  '74000000-0000-4000-8000-000000000004',
  '71000000-0000-4000-8000-000000000001',
  '72000000-0000-4000-8000-000000000002',
  'Клиент Кабинета', 'female', 30, 170
);
insert into public.client_progress (trainer_id, client_id, recorded_on, weight_kg) values
  ('71000000-0000-4000-8000-000000000001', '74000000-0000-4000-8000-000000000004', '2026-07-27', 61);

set local role authenticated;
select set_config('request.jwt.claim.sub', '72000000-0000-4000-8000-000000000002', true);
select is(
  (select count(*) from public.get_my_client()),
  1::bigint,
  'linked client gets own card'
);
select is(
  (select current_weight_kg from public.get_my_client()),
  61::numeric,
  'linked client gets latest weight'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '73000000-0000-4000-8000-000000000003', true);
select is(
  (select count(*) from public.get_my_client()),
  0::bigint,
  'unlinked client cannot see another card'
);
reset role;

select * from finish();
rollback;
