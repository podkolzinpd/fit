begin;
create extension if not exists pgtap with schema extensions;
select plan(26);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password) values
  ('c1230000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pilot-one@example.test', ''),
  ('c1230000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pilot-two@example.test', ''),
  ('c1230000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'outside-pilot@example.test', '');

insert into public.profiles (id, account_role, first_name) values
  ('c1230000-0000-4000-8000-000000000001', 'trainer', 'Первый'),
  ('c1230000-0000-4000-8000-000000000002', 'client', 'Второй'),
  ('c1230000-0000-4000-8000-000000000003', 'trainer', 'Контрольный');

insert into public.trainers (profile_id) values
  ('c1230000-0000-4000-8000-000000000001'),
  ('c1230000-0000-4000-8000-000000000003');

delete from private.trainer_schedule_v2_allowlist;
insert into private.trainer_schedule_v2_allowlist (login_sha256) values
  (encode(extensions.digest('pilot-one@example.test', 'sha256'), 'hex')),
  (encode(extensions.digest('pilot-two@example.test', 'sha256'), 'hex'));

select is(
  private.set_source_cutover_write_gate(true),
  true,
  'source writes are paused before pilot management'
);

set local role service_role;
select lives_ok(
  $$select public.manage_trainer_schedule_v2_pilot('c1230000-0000-4000-8000-000000000001', 'enable')$$,
  'service role can enable the first reviewed trainer'
);
reset role;

select is(
  (select trainer_schedule_v2 from public.user_feature_flags where user_id = 'c1230000-0000-4000-8000-000000000001'),
  true,
  'first reviewed trainer receives the pilot flag'
);
select is(
  (select count(*) from public.user_feature_flags where trainer_schedule_v2),
  1::bigint,
  'one assignment is enabled before the second trainer joins'
);
select is(
  (select writes_paused from private.source_cutover_write_gate where singleton),
  true,
  'pilot management restores the paused gate'
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
  'service role can enable the second reviewed trainer'
);
reset role;

select is(
  (select account_role from public.profiles where id = 'c1230000-0000-4000-8000-000000000002'),
  'trainer',
  'second reviewed legacy profile receives the trainer role'
);
select is(
  (select count(*) from public.trainers where profile_id = 'c1230000-0000-4000-8000-000000000002'),
  1::bigint,
  'second reviewed trainer root is created once'
);
select is(
  (select trainer_schedule_v2 from public.user_feature_flags where user_id = 'c1230000-0000-4000-8000-000000000002'),
  true,
  'second reviewed trainer receives the pilot flag'
);
select is(
  (select trainer_schedule_v2 from public.user_feature_flags where user_id = 'c1230000-0000-4000-8000-000000000001'),
  true,
  'enabling the second trainer preserves the first assignment'
);
select is(
  (select count(*) from public.user_feature_flags where trainer_schedule_v2),
  2::bigint,
  'exactly two reviewed assignments are enabled'
);
select is(
  (select writes_paused from private.source_cutover_write_gate where singleton),
  true,
  'second enable also restores the paused gate'
);

set local role service_role;
select throws_ok(
  $$select public.manage_trainer_schedule_v2_pilot('c1230000-0000-4000-8000-000000000003', 'enable')$$,
  'PT409',
  'trainer_schedule_v2_account_not_allowed',
  'a trainer outside the reviewed allowlist cannot be enabled'
);
reset role;

select is(
  coalesce((select trainer_schedule_v2 from public.user_feature_flags where user_id = 'c1230000-0000-4000-8000-000000000003'), false),
  false,
  'the control trainer does not receive the feature flag'
);
select is(
  (select count(*) from public.user_feature_flags where trainer_schedule_v2),
  2::bigint,
  'a rejected account cannot disturb the two assignments'
);
select is(
  (select writes_paused from private.source_cutover_write_gate where singleton),
  true,
  'a rejected account leaves the source gate paused'
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
  'service role can disable only the second reviewed trainer'
);
reset role;

select is(
  (select trainer_schedule_v2 from public.user_feature_flags where user_id = 'c1230000-0000-4000-8000-000000000002'),
  false,
  'second reviewed trainer is disabled'
);
select is(
  (select trainer_schedule_v2 from public.user_feature_flags where user_id = 'c1230000-0000-4000-8000-000000000001'),
  true,
  'disabling the second trainer preserves the first assignment'
);
select is(
  (select count(*) from public.user_feature_flags where trainer_schedule_v2),
  1::bigint,
  'one reviewed assignment remains enabled'
);

set local role service_role;
select lives_ok(
  $$select public.manage_trainer_schedule_v2_pilot('c1230000-0000-4000-8000-000000000001', 'disable')$$,
  'service role can disable the first reviewed trainer'
);
reset role;

select is(
  (select trainer_schedule_v2 from public.user_feature_flags where user_id = 'c1230000-0000-4000-8000-000000000001'),
  false,
  'first reviewed trainer is disabled'
);
select is(
  (select count(*) from public.user_feature_flags where trainer_schedule_v2),
  0::bigint,
  'no assignments remain after both reviewed trainers are disabled'
);
select is(
  (select writes_paused from private.source_cutover_write_gate where singleton),
  true,
  'all pilot operations preserve the paused gate'
);

select * from finish();
rollback;
