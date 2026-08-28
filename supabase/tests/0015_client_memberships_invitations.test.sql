begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password) values
  ('81000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'invite-trainer-a@example.test', ''),
  ('82000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'invite-trainer-b@example.test', ''),
  ('83000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'invite-client@example.test', ''),
  ('84000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'invite-stranger@example.test', '');
insert into public.profiles (id, account_role) values
  ('81000000-0000-4000-8000-000000000001', 'trainer'),
  ('82000000-0000-4000-8000-000000000002', 'trainer'),
  ('83000000-0000-4000-8000-000000000003', 'client'),
  ('84000000-0000-4000-8000-000000000004', 'client');
insert into public.trainers (profile_id) values
  ('81000000-0000-4000-8000-000000000001'),
  ('82000000-0000-4000-8000-000000000002');
insert into public.clients (id, trainer_id, full_name, gender, age_years, height_cm) values
  ('85000000-0000-4000-8000-000000000005', '81000000-0000-4000-8000-000000000001', 'Invite client', 'female', 30, 170);
insert into public.client_trainers (client_id, trainer_id) values
  ('85000000-0000-4000-8000-000000000005', '81000000-0000-4000-8000-000000000001')
on conflict do nothing;
insert into public.workouts (trainer_id, client_id, workout_date)
values ('81000000-0000-4000-8000-000000000001', '85000000-0000-4000-8000-000000000005', '2026-07-27');

set local role authenticated;
select set_config('request.jwt.claim.sub', '81000000-0000-4000-8000-000000000001', true);
create temporary table invitation_code as
select public.create_client_invitation('85000000-0000-4000-8000-000000000005', 'client') code;
select is(length((select code from invitation_code)), 12, 'trainer creates 12-character client invitation');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '82000000-0000-4000-8000-000000000002', true);
select throws_ok(
  $$select public.claim_client_invitation((select code from invitation_code))$$,
  'PT403', 'invitation_role_mismatch', 'trainer cannot claim client invitation'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '83000000-0000-4000-8000-000000000003', true);
select is(
  public.claim_client_invitation((select code from invitation_code)),
  '85000000-0000-4000-8000-000000000005'::uuid,
  'client claims invitation'
);
select is(
  (select auth_user_id from public.clients where id = '85000000-0000-4000-8000-000000000005'),
  '83000000-0000-4000-8000-000000000003'::uuid,
  'claim links client owner'
);
select is(
  public.claim_client_invitation((select code from invitation_code)),
  '85000000-0000-4000-8000-000000000005'::uuid,
  'repeating a successful claim is idempotent'
);
select is((select count(*) from public.clients), 1::bigint, 'owner can read linked client');
select is(
  (select count(*) from public.list_workouts(null, null, '85000000-0000-4000-8000-000000000005', 50, 0)),
  1::bigint,
  'client owner can read workout aggregate'
);
select lives_ok(
  $$select public.create_client_invitation('85000000-0000-4000-8000-000000000005', 'trainer')$$,
  'owner creates trainer invitation'
);
reset role;

-- Получаем второй код через отдельный вызов под владельцем и передаём тренеру.
set local role authenticated;
select set_config('request.jwt.claim.sub', '83000000-0000-4000-8000-000000000003', true);
create temporary table trainer_invitation_code as
select public.create_client_invitation('85000000-0000-4000-8000-000000000005', 'trainer') code;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '82000000-0000-4000-8000-000000000002', true);
select lives_ok(
  $$select public.claim_client_invitation((select code from trainer_invitation_code))$$,
  'trainer claims owner invitation'
);
select ok(
  public.can_access_client('85000000-0000-4000-8000-000000000005'),
  'second trainer gains access'
);
select lives_ok(
  $$select public.leave_client_space('85000000-0000-4000-8000-000000000005')$$,
  'trainer leaves client space'
);
select ok(
  not public.can_access_client('85000000-0000-4000-8000-000000000005'),
  'trainer loses access after leaving'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '84000000-0000-4000-8000-000000000004', true);
select ok(
  not public.can_access_client('85000000-0000-4000-8000-000000000005'),
  'foreign client has no access'
);
select is((select count(*) from public.clients), 0::bigint, 'RLS hides client from foreign client');
reset role;

select * from finish();
rollback;
