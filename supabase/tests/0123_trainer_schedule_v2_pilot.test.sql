begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password) values
  ('c1230000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pilot-one@example.test', ''),
  ('c1230000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pilot-two@example.test', '');

insert into public.profiles (id, account_role, first_name) values
  ('c1230000-0000-4000-8000-000000000001', 'trainer', 'Первый'),
  ('c1230000-0000-4000-8000-000000000002', 'trainer', 'Второй');

insert into public.trainers (profile_id) values
  ('c1230000-0000-4000-8000-000000000001'),
  ('c1230000-0000-4000-8000-000000000002');

select is(
  private.set_source_cutover_write_gate(true),
  true,
  'source writes are paused before pilot management'
);

set local role service_role;
select lives_ok(
  $$select public.manage_trainer_schedule_v2_pilot('c1230000-0000-4000-8000-000000000001', 'enable')$$,
  'service role can enable the pilot while source writes remain paused'
);
reset role;

select is(
  (select trainer_schedule_v2 from public.user_feature_flags where user_id = 'c1230000-0000-4000-8000-000000000001'),
  true,
  'target trainer receives the pilot flag'
);
select is(
  (select count(*) from public.user_feature_flags where trainer_schedule_v2),
  1::bigint,
  'exactly one assignment is enabled'
);
select is(
  (select writes_paused from private.source_cutover_write_gate where singleton),
  true,
  'pilot management restores the paused gate before returning'
);
select throws_ok(
  $$update public.user_feature_flags set trainer_schedule_v2 = false where user_id = 'c1230000-0000-4000-8000-000000000001'$$,
  'P0001',
  'source_product_writes_paused',
  'ordinary writes remain blocked after pilot management'
);

set local role service_role;
select lives_ok(
  $$select public.manage_trainer_schedule_v2_pilot('c1230000-0000-4000-8000-000000000002', 'enable')$$,
  'enabling another trainer atomically replaces the assignment'
);
reset role;

select is(
  (select trainer_schedule_v2 from public.user_feature_flags where user_id = 'c1230000-0000-4000-8000-000000000001'),
  false,
  'previous assignment is disabled'
);
select is(
  (select trainer_schedule_v2 from public.user_feature_flags where user_id = 'c1230000-0000-4000-8000-000000000002'),
  true,
  'replacement assignment is enabled'
);
select is(
  (select writes_paused from private.source_cutover_write_gate where singleton),
  true,
  'replacement also preserves the paused gate'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'c1230000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$select public.manage_trainer_schedule_v2_pilot('c1230000-0000-4000-8000-000000000001', 'enable')$$,
  '42501',
  null,
  'authenticated users cannot manage the pilot'
);
reset role;

set local role service_role;
select lives_ok(
  $$select public.manage_trainer_schedule_v2_pilot('c1230000-0000-4000-8000-000000000002', 'disable')$$,
  'service role can disable the pilot while writes are paused'
);
reset role;

select is(
  (select count(*) from public.user_feature_flags where trainer_schedule_v2),
  0::bigint,
  'disable leaves no enabled assignments'
);

select * from finish();
rollback;
