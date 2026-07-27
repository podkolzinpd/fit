begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password) values
  ('a1000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'manage-root@example.test', ''),
  ('a2000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'manage-member@example.test', ''),
  ('a3000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'manage-owner@example.test', ''),
  ('a4000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'manage-stranger@example.test', '');
insert into public.profiles (id, account_role, first_name) values
  ('a1000000-0000-4000-8000-000000000001', 'trainer', 'Root'),
  ('a2000000-0000-4000-8000-000000000002', 'trainer', 'Member'),
  ('a3000000-0000-4000-8000-000000000003', 'client', 'Owner'),
  ('a4000000-0000-4000-8000-000000000004', 'client', 'Stranger');
insert into public.trainers (profile_id) values
  ('a1000000-0000-4000-8000-000000000001'),
  ('a2000000-0000-4000-8000-000000000002');
insert into public.clients (id, trainer_id, auth_user_id, full_name, gender, age_years, height_cm)
values ('a5000000-0000-4000-8000-000000000005', 'a1000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000003', 'Managed', 'female', 30, 170);
insert into public.client_trainers (client_id, trainer_id) values
  ('a5000000-0000-4000-8000-000000000005', 'a1000000-0000-4000-8000-000000000001'),
  ('a5000000-0000-4000-8000-000000000005', 'a2000000-0000-4000-8000-000000000002');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a3000000-0000-4000-8000-000000000003', true);
select is((select count(*) from public.list_client_trainers('a5000000-0000-4000-8000-000000000005')), 2::bigint, 'owner lists both trainers');
select is((select count(*) from public.list_client_trainers('a5000000-0000-4000-8000-000000000005') where is_root), 1::bigint, 'root trainer is marked');
select throws_ok(
  $$select public.remove_client_trainer('a5000000-0000-4000-8000-000000000005','a1000000-0000-4000-8000-000000000001')$$,
  'PT422', 'root_trainer_cannot_be_removed', 'owner cannot remove root trainer'
);
select lives_ok(
  $$select public.remove_client_trainer('a5000000-0000-4000-8000-000000000005','a2000000-0000-4000-8000-000000000002')$$,
  'owner removes membership trainer'
);
select is((select count(*) from public.client_trainers where client_id = 'a5000000-0000-4000-8000-000000000005'), 1::bigint, 'member row is removed');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a4000000-0000-4000-8000-000000000004', true);
select throws_ok(
  $$select * from public.list_client_trainers('a5000000-0000-4000-8000-000000000005')$$,
  'PT403', 'membership_not_allowed', 'foreign client cannot list trainers'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$select public.leave_client_space('a5000000-0000-4000-8000-000000000005')$$,
  'PT422', 'root_trainer_cannot_leave', 'root trainer cannot leave'
);
reset role;

insert into public.client_trainers (client_id, trainer_id)
values ('a5000000-0000-4000-8000-000000000005', 'a2000000-0000-4000-8000-000000000002');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a2000000-0000-4000-8000-000000000002', true);
select is(
  (select count(*) from public.list_client_trainers('a5000000-0000-4000-8000-000000000005')),
  2::bigint,
  'membership trainer lists the client trainers'
);
select lives_ok(
  $$select public.leave_client_space('a5000000-0000-4000-8000-000000000005')$$,
  'membership trainer leaves the client space'
);
select is(
  (select count(*) from public.client_trainers
   where client_id = 'a5000000-0000-4000-8000-000000000005'
     and trainer_id = 'a2000000-0000-4000-8000-000000000002'),
  0::bigint,
  'leaving removes the membership row'
);
select throws_ok(
  $$select public.leave_client_space('a5000000-0000-4000-8000-000000000005')$$,
  'PT404', 'membership_not_found', 'removed trainer cannot leave twice'
);
reset role;

select * from finish();
rollback;
