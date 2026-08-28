begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password) values
  ('64000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'disconnect-trainer@example.test', ''),
  ('64000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'disconnect-client@example.test', ''),
  ('64000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'disconnect-other@example.test', '');
insert into public.profiles (id, account_role, first_name) values
  ('64000000-0000-4000-8000-000000000001', 'trainer', 'Trainer'),
  ('64000000-0000-4000-8000-000000000002', 'client', 'Client'),
  ('64000000-0000-4000-8000-000000000003', 'client', 'Other');
insert into public.trainers (profile_id)
values ('64000000-0000-4000-8000-000000000001');

insert into public.clients (id, trainer_id, auth_user_id, full_name) values
  ('64000000-0000-4000-8000-000000000010', '64000000-0000-4000-8000-000000000002', '64000000-0000-4000-8000-000000000002', 'Canonical client'),
  ('64000000-0000-4000-8000-000000000011', '64000000-0000-4000-8000-000000000001', '64000000-0000-4000-8000-000000000003', 'Legacy client');
insert into public.client_trainers (client_id, trainer_id, alias, note) values
  ('64000000-0000-4000-8000-000000000010', '64000000-0000-4000-8000-000000000001', 'Canonical alias', 'Trainer private note'),
  ('64000000-0000-4000-8000-000000000011', '64000000-0000-4000-8000-000000000001', 'Legacy alias', 'Legacy private note');
insert into public.client_trainer_relationships (id, client_id, trainer_id, connected_by) values
  ('64000000-0000-4000-8000-000000000020', '64000000-0000-4000-8000-000000000010', '64000000-0000-4000-8000-000000000001', '64000000-0000-4000-8000-000000000002'),
  ('64000000-0000-4000-8000-000000000021', '64000000-0000-4000-8000-000000000011', '64000000-0000-4000-8000-000000000001', '64000000-0000-4000-8000-000000000003');

insert into public.workouts (
  id, trainer_id, client_id, created_by, updated_by, workout_date,
  status, started_at, completed_at
) values (
  '64000000-0000-4000-8000-000000000030', '64000000-0000-4000-8000-000000000002',
  '64000000-0000-4000-8000-000000000010', '64000000-0000-4000-8000-000000000001',
  '64000000-0000-4000-8000-000000000002', '2026-08-20', 'done',
  '2026-08-20 10:00+00', '2026-08-20 11:00+00'
);
insert into public.client_progress (
  id, trainer_id, client_id, recorded_on, weight_kg, created_by, updated_by
) values (
  '64000000-0000-4000-8000-000000000040', '64000000-0000-4000-8000-000000000002',
  '64000000-0000-4000-8000-000000000010', '2026-08-20', 70,
  '64000000-0000-4000-8000-000000000001', '64000000-0000-4000-8000-000000000002'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '64000000-0000-4000-8000-000000000002', true);
create temporary table disconnect_result as
select public.disconnect_client_trainer('64000000-0000-4000-8000-000000000010') result;
reset role;

select is((select result->>'status' from disconnect_result), 'disconnected', 'active relationship is disconnected');
select is((select result->>'trainerId' from disconnect_result), '64000000-0000-4000-8000-000000000001', 'server returns the disconnected trainer');
select is((select status from public.client_trainer_relationships where id = '64000000-0000-4000-8000-000000000020'), 'disconnected', 'relationship history is retained');
select is((select disconnected_by from public.client_trainer_relationships where id = '64000000-0000-4000-8000-000000000020'), '64000000-0000-4000-8000-000000000002'::uuid, 'client is recorded as disconnect actor');
select ok((select disconnected_at is not null from public.client_trainer_relationships where id = '64000000-0000-4000-8000-000000000020'), 'disconnect timestamp is recorded');
select is((select count(*) from public.client_trainers where client_id = '64000000-0000-4000-8000-000000000010'), 0::bigint, 'trainer membership and its private note are removed');
select is((select count(*) from public.workouts where client_id = '64000000-0000-4000-8000-000000000010'), 1::bigint, 'workout history is preserved');
select is((select created_by from public.workouts where id = '64000000-0000-4000-8000-000000000030'), '64000000-0000-4000-8000-000000000001'::uuid, 'workout authorship is preserved');
select is((select count(*) from public.client_progress where client_id = '64000000-0000-4000-8000-000000000010'), 1::bigint, 'measurement history is preserved');
select is((select trainer_id from public.clients where id = '64000000-0000-4000-8000-000000000010'), '64000000-0000-4000-8000-000000000002'::uuid, 'canonical data ownership is unchanged');

set local role authenticated;
select set_config('request.jwt.claim.sub', '64000000-0000-4000-8000-000000000001', true);
select is(public.can_access_client('64000000-0000-4000-8000-000000000010'), false, 'former trainer loses access');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '64000000-0000-4000-8000-000000000002', true);
select is(public.can_access_client('64000000-0000-4000-8000-000000000010'), true, 'client keeps access');
select is(
  public.disconnect_client_trainer('64000000-0000-4000-8000-000000000010')->>'status',
  'already_disconnected',
  'repeating disconnect is idempotent'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '64000000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$select public.disconnect_client_trainer('64000000-0000-4000-8000-000000000010')$$,
  'PT403', 'client_role_required', 'trainer cannot invoke client disconnect'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '64000000-0000-4000-8000-000000000003', true);
select throws_ok(
  $$select public.disconnect_client_trainer('64000000-0000-4000-8000-000000000010')$$,
  'PT404', 'client_not_found', 'client cannot disconnect another client card'
);
select throws_ok(
  $$select public.disconnect_client_trainer('64000000-0000-4000-8000-000000000011')$$,
  'PT409', 'client_requires_safe_migration', 'legacy partition is rejected without partial changes'
);
reset role;

select is((select status from public.client_trainer_relationships where id = '64000000-0000-4000-8000-000000000021'), 'active', 'legacy relationship remains active after rejection');
select is((select count(*) from public.client_trainers where client_id = '64000000-0000-4000-8000-000000000011'), 1::bigint, 'legacy membership remains intact after rejection');

select * from finish();
rollback;
