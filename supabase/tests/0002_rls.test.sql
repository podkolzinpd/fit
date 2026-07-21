begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password)
values
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a@example.test', ''),
  ('20000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b@example.test', ''),
  ('30000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'client@example.test', '');
insert into public.profiles (id) values
  ('10000000-0000-4000-8000-000000000001'), ('20000000-0000-4000-8000-000000000002');
insert into public.trainers (profile_id) values
  ('10000000-0000-4000-8000-000000000001'), ('20000000-0000-4000-8000-000000000002');
insert into public.clients (id, trainer_id, auth_user_id, full_name, gender, age_years, height_cm) values
  ('a0000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000003', 'A client', 'female', 30, 170),
  ('b0000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', null, 'B client', 'male', 32, 180);
insert into public.client_progress (trainer_id, client_id, recorded_on, weight_kg) values
  ('10000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', '2026-07-20', 60),
  ('20000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000002', '2026-07-20', 80);

set local role anon;
select throws_ok(
  'select * from public.clients',
  '42501',
  'permission denied for table clients',
  'anon cannot read clients'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select is((select count(*) from public.clients), 1::bigint, 'trainer A sees only own client');
select is((select count(*) from public.client_progress), 1::bigint, 'trainer A sees only own progress');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000002', true);
select is((select count(*) from public.clients), 1::bigint, 'trainer B sees only own client');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '30000000-0000-4000-8000-000000000003', true);
select is((select count(*) from public.clients), 1::bigint, 'linked client sees own client card');
select is((select count(*) from public.client_progress), 1::bigint, 'linked client sees own progress');
reset role;

select * from finish();
rollback;
