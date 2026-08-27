begin;
create extension if not exists pgtap with schema extensions;
select plan(19);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password) values
  ('62000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'relationship-trainer-a@example.test', ''),
  ('62000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'relationship-trainer-b@example.test', ''),
  ('62000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'relationship-client@example.test', ''),
  ('62000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'relationship-outside@example.test', '');

insert into public.profiles (id, account_role) values
  ('62000000-0000-4000-8000-000000000001', 'trainer'),
  ('62000000-0000-4000-8000-000000000002', 'trainer'),
  ('62000000-0000-4000-8000-000000000003', 'client'),
  ('62000000-0000-4000-8000-000000000004', 'trainer');

insert into public.trainers (profile_id) values
  ('62000000-0000-4000-8000-000000000001'),
  ('62000000-0000-4000-8000-000000000002'),
  ('62000000-0000-4000-8000-000000000003'),
  ('62000000-0000-4000-8000-000000000004');

insert into public.clients (id, trainer_id, auth_user_id, full_name) values
  ('62000000-0000-4000-8000-000000000010', '62000000-0000-4000-8000-000000000003', '62000000-0000-4000-8000-000000000003', 'Самостоятельный клиент'),
  ('62000000-0000-4000-8000-000000000011', '62000000-0000-4000-8000-000000000001', null, 'Карточка тренера');

select has_table('public', 'client_trainer_relationships', 'relationship history exists');
select has_table('public', 'client_merge_operations', 'merge audit log exists');
select has_column('public', 'clients', 'merged_into_client_id', 'clients have a canonical redirect');
select is(
  (select count(*)::int from public.client_trainer_relationships where client_id = '62000000-0000-4000-8000-000000000010'),
  0,
  'a standalone client has no active trainer relationship'
);

insert into public.client_trainer_relationships (
  client_id, trainer_id, connected_by
) values (
  '62000000-0000-4000-8000-000000000010',
  '62000000-0000-4000-8000-000000000001',
  '62000000-0000-4000-8000-000000000001'
);
select is(
  (select status from public.client_trainer_relationships where client_id = '62000000-0000-4000-8000-000000000010'),
  'active',
  'a valid active relationship is stored'
);
select throws_ok(
  $$insert into public.client_trainer_relationships (client_id, trainer_id, connected_by) values ('62000000-0000-4000-8000-000000000010', '62000000-0000-4000-8000-000000000002', '62000000-0000-4000-8000-000000000002')$$,
  '23505', null, 'a client cannot have two active trainers'
);

update public.client_trainer_relationships
set status = 'disconnected',
    disconnected_at = now(),
    disconnected_by = '62000000-0000-4000-8000-000000000003'
where client_id = '62000000-0000-4000-8000-000000000010';
select is(
  (select status from public.client_trainer_relationships where client_id = '62000000-0000-4000-8000-000000000010'),
  'disconnected',
  'a relationship can be closed without deleting its history'
);

insert into public.client_trainer_relationships (
  client_id, trainer_id, connected_by
) values (
  '62000000-0000-4000-8000-000000000010',
  '62000000-0000-4000-8000-000000000002',
  '62000000-0000-4000-8000-000000000003'
);
select is(
  (select trainer_id from public.client_trainer_relationships where client_id = '62000000-0000-4000-8000-000000000010' and status = 'active'),
  '62000000-0000-4000-8000-000000000002'::uuid,
  'a new trainer can become active after the previous relationship is closed'
);
select is(
  (select count(*)::int from public.client_trainer_relationships where client_id = '62000000-0000-4000-8000-000000000010'),
  2,
  'both relationship periods remain in history'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '62000000-0000-4000-8000-000000000003', true);
select is(
  (select count(*)::int from public.client_trainer_relationships where client_id = '62000000-0000-4000-8000-000000000010'),
  2,
  'the client can read their complete relationship history'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '62000000-0000-4000-8000-000000000001', true);
select is(
  (select count(*)::int from public.client_trainer_relationships where client_id = '62000000-0000-4000-8000-000000000010'),
  1,
  'a previous trainer can read only their own relationship period'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '62000000-0000-4000-8000-000000000004', true);
select is(
  (select count(*)::int from public.client_trainer_relationships where client_id = '62000000-0000-4000-8000-000000000010'),
  0,
  'an unrelated trainer cannot read relationship history'
);
select throws_ok(
  $$select * from public.client_merge_operations$$,
  '42501', null, 'merge audit data is not exposed to authenticated users'
);
reset role;

select throws_ok(
  $$insert into public.client_merge_operations (source_client_id, target_client_id, actor_id) values ('62000000-0000-4000-8000-000000000010', '62000000-0000-4000-8000-000000000010', '62000000-0000-4000-8000-000000000003')$$,
  '23514', null, 'a card cannot be merged into itself'
);
select lives_ok(
  $$insert into public.client_merge_operations (source_client_id, target_client_id, actor_id, status, completed_at, dependency_counts_before, dependency_counts_after) values ('62000000-0000-4000-8000-000000000011', '62000000-0000-4000-8000-000000000010', '62000000-0000-4000-8000-000000000003', 'completed', now(), '{"workouts": 2}', '{"workouts": 2}')$$,
  'a completed merge operation records dependency counts'
);
select throws_ok(
  $$insert into public.client_merge_operations (source_client_id, target_client_id, actor_id, status) values ('62000000-0000-4000-8000-000000000011', '62000000-0000-4000-8000-000000000010', '62000000-0000-4000-8000-000000000003', 'completed')$$,
  '23514', null, 'a completed merge requires a completion timestamp'
);
select lives_ok(
  $$update public.clients set merged_into_client_id = '62000000-0000-4000-8000-000000000010' where id = '62000000-0000-4000-8000-000000000011'$$,
  'a duplicate card can point at its canonical card'
);
select throws_ok(
  $$update public.clients set merged_into_client_id = id where id = '62000000-0000-4000-8000-000000000010'$$,
  '23514', null, 'a canonical redirect cannot point to itself'
);
select has_table('public', 'client_trainers', 'legacy memberships remain for compatibility');

select * from finish();
rollback;
