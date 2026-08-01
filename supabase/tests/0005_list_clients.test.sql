begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password)
values
  ('51000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'list-a@example.test', ''),
  ('52000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'list-b@example.test', ''),
  ('53000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'list-client@example.test', '');
insert into public.profiles (id) values
  ('51000000-0000-4000-8000-000000000001'),
  ('52000000-0000-4000-8000-000000000002');
insert into public.trainers (profile_id) values
  ('51000000-0000-4000-8000-000000000001'),
  ('52000000-0000-4000-8000-000000000002');
insert into public.clients (id, trainer_id, auth_user_id, full_name, gender, age_years, height_cm, archived_at, created_at) values
  ('5a000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000001', '53000000-0000-4000-8000-000000000003', 'Active A', 'female', 30, 170, null, '2026-07-20'),
  ('5a000000-0000-4000-8000-000000000002', '51000000-0000-4000-8000-000000000001', null, 'Archived A', 'male', 31, 180, '2026-07-21', '2026-07-21'),
  ('5b000000-0000-4000-8000-000000000001', '52000000-0000-4000-8000-000000000002', null, 'Active B', 'female', 32, 165, null, '2026-07-22');
insert into public.client_private_details (client_id, trainer_id, note) values
  ('5a000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000001', 'Private A');
insert into public.client_progress (trainer_id, client_id, recorded_on, weight_kg, deleted_at, created_at) values
  ('51000000-0000-4000-8000-000000000001', '5a000000-0000-4000-8000-000000000001', '2026-07-18', 60, null, '2026-07-18'),
  ('51000000-0000-4000-8000-000000000001', '5a000000-0000-4000-8000-000000000001', '2026-07-19', 61, '2026-07-20', '2026-07-19'),
  ('51000000-0000-4000-8000-000000000001', '5a000000-0000-4000-8000-000000000001', '2026-07-20', null, null, '2026-07-20'),
  ('51000000-0000-4000-8000-000000000001', '5a000000-0000-4000-8000-000000000001', '2026-07-21', 62, null, '2026-07-21');

set local role anon;
select throws_ok(
  'select * from public.list_clients(false)',
  '42501', null,
  'anon cannot execute list_clients'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '51000000-0000-4000-8000-000000000001', true);
select is((select count(*) from public.list_clients(false)), 1::bigint, 'active list excludes archived clients');
select is((select count(*) from public.list_clients(true)), 2::bigint, 'archive filter can include archived clients');
select is((select note from public.list_clients(false)), 'Private A', 'private note is returned in the aggregate');
select is((select current_weight_kg from public.list_clients(false)), 62::numeric, 'latest active non-null weight is returned');
select is((select count(*) from public.list_clients(true) where full_name = 'Active B'), 0::bigint, 'trainer cannot read another tenant');
reset role;
insert into public.clients (id, trainer_id, full_name, gender, age_years, height_cm, created_at, updated_at) values
  ('5a000000-0000-4000-8000-000000000003', '51000000-0000-4000-8000-000000000001', 'Active C', 'male', 29, 178, '2026-07-01', '2026-07-01');
insert into public.workouts (trainer_id, client_id, workout_date, status, updated_at) values
  ('51000000-0000-4000-8000-000000000001', '5a000000-0000-4000-8000-000000000001', '2026-07-22', 'planned', '2100-01-01');
set local role authenticated;
select set_config('request.jwt.claim.sub', '51000000-0000-4000-8000-000000000001', true);
select is((select full_name from public.list_clients(false) limit 1), 'Active A', 'client with most recent activity is listed first');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '52000000-0000-4000-8000-000000000002', true);
select is((select full_name from public.list_clients(false)), 'Active B', 'second trainer reads own client only');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '53000000-0000-4000-8000-000000000003', true);
select throws_ok(
  'select * from public.list_clients(false)',
  'PT422', 'trainer_not_initialized',
  'linked client cannot call trainer list RPC'
);
reset role;

select * from finish();
rollback;
