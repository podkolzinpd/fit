begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password) values
  ('c1000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'standalone@example.test', ''),
  ('c2000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'other@example.test', ''),
  ('c3000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'trainer@example.test', '');
insert into public.profiles (id, account_role, first_name) values
  ('c1000000-0000-4000-8000-000000000001', 'client', 'Сам'),
  ('c2000000-0000-4000-8000-000000000002', 'client', 'Другой'),
  ('c3000000-0000-4000-8000-000000000003', 'trainer', 'Тренер');
insert into public.trainers (profile_id) values ('c3000000-0000-4000-8000-000000000003');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'c1000000-0000-4000-8000-000000000001', true);
select isnt(
  public.create_own_client(jsonb_build_object(
    'fullName', 'Самостоятельный Клиент', 'gender', 'male', 'ageYears', 31,
    'ageUpdatedAt', current_date, 'heightCm', 181, 'goal', 'Подготовка',
    'initialWeightKg', 79.5, 'initialWeightRecordedOn', current_date
  )),
  null::uuid,
  'client creates a standalone card'
);
select is(
  (select count(*) from public.clients
   where auth_user_id = 'c1000000-0000-4000-8000-000000000001'),
  1::bigint,
  'card is linked to the client account'
);
select ok(
  not exists (
    select 1 from public.trainers
    where profile_id = 'c1000000-0000-4000-8000-000000000001'
  ),
  'standalone client is not a trainer'
);
select is(
  (select count(*) from public.list_client_trainers(
    (select id from public.clients where auth_user_id = 'c1000000-0000-4000-8000-000000000001')
  )),
  0::bigint,
  'standalone card starts without trainers'
);
select is(
  (select current_weight_kg from public.get_my_client()),
  79.5::numeric,
  'initial weight is visible in own card'
);
select isnt(
  public.save_workout(
    jsonb_build_object(
      'clientId', (select id from public.clients where auth_user_id = 'c1000000-0000-4000-8000-000000000001'),
      'workoutDate', current_date,
      'exercises', '[]'::jsonb
    ),
    null
  ),
  null::uuid,
  'standalone client creates a workout'
);
select is(
  (select created_by from public.workouts limit 1),
  'c1000000-0000-4000-8000-000000000001'::uuid,
  'standalone workout records client authorship'
);
select throws_ok(
  $$select public.create_own_client(jsonb_build_object(
    'fullName', 'Дубликат', 'gender', 'male', 'ageYears', 31, 'heightCm', 181
  ))$$,
  'PT409', 'client_card_already_exists', 'client cannot create a second card'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'c2000000-0000-4000-8000-000000000002', true);
select is((select count(*) from public.get_my_client()), 0::bigint, 'other client cannot read the card');
select is((select count(*) from public.workouts), 0::bigint, 'other client cannot read standalone workouts');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'c3000000-0000-4000-8000-000000000003', true);
select throws_ok(
  $$select public.create_own_client(jsonb_build_object(
    'fullName', 'Тренер', 'gender', 'male', 'ageYears', 31, 'heightCm', 181
  ))$$,
  'PT403', 'client_account_required', 'trainer cannot create an own client card'
);
select is((select count(*) from public.list_clients()), 0::bigint, 'unconnected trainer cannot list standalone card');
reset role;

select * from finish();
rollback;
