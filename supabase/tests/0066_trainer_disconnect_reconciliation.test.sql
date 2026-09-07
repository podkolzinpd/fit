begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password) values
  ('66000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'reconcile-trainer@example.test', ''),
  ('66000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'reconcile-client@example.test', '');
insert into public.profiles (id, account_role, first_name) values
  ('66000000-0000-4000-8000-000000000001', 'trainer', 'Old trainer'),
  ('66000000-0000-4000-8000-000000000002', 'client', 'Client');
insert into public.trainers (profile_id)
values ('66000000-0000-4000-8000-000000000001');
insert into public.clients (id, trainer_id, auth_user_id, full_name) values
  ('66000000-0000-4000-8000-000000000010', '66000000-0000-4000-8000-000000000002', '66000000-0000-4000-8000-000000000002', 'Client');

-- Reproduce the production drift: relationship says disconnected while the
-- old membership still feeds the profile and grants trainer access.
insert into public.client_trainer_relationships (
  id, client_id, trainer_id, status, connected_by, disconnected_at, disconnected_by
) values (
  '66000000-0000-4000-8000-000000000020',
  '66000000-0000-4000-8000-000000000010',
  '66000000-0000-4000-8000-000000000001',
  'disconnected',
  '66000000-0000-4000-8000-000000000002',
  now(),
  '66000000-0000-4000-8000-000000000002'
);
insert into public.client_trainers (client_id, trainer_id, alias)
values (
  '66000000-0000-4000-8000-000000000010',
  '66000000-0000-4000-8000-000000000001',
  'Stale trainer'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '66000000-0000-4000-8000-000000000002', true);
create temporary table reconcile_result as
select public.disconnect_client_trainer('66000000-0000-4000-8000-000000000010') result;
reset role;

select is((select result->>'status' from reconcile_result), 'disconnected', 'idempotent disconnect reports repaired state');
select is((select result->>'trainerId' from reconcile_result), '66000000-0000-4000-8000-000000000001', 'repair identifies the disconnected trainer');
select is((select count(*) from public.client_trainers where client_id = '66000000-0000-4000-8000-000000000010'), 0::bigint, 'stale membership is removed');
select is((select status from public.client_trainer_relationships where id = '66000000-0000-4000-8000-000000000020'), 'disconnected', 'relationship history remains disconnected');

set local role authenticated;
select set_config('request.jwt.claim.sub', '66000000-0000-4000-8000-000000000001', true);
select is(public.can_access_client('66000000-0000-4000-8000-000000000010'), false, 'old trainer no longer has access');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '66000000-0000-4000-8000-000000000002', true);
select is(public.can_access_client('66000000-0000-4000-8000-000000000010'), true, 'client keeps access');
select is(public.disconnect_client_trainer('66000000-0000-4000-8000-000000000010')->>'status', 'already_disconnected', 'a clean repeat is idempotent');
reset role;

select is((select count(*) from public.client_trainer_relationships where client_id = '66000000-0000-4000-8000-000000000010'), 1::bigint, 'repair does not delete relationship history');

select * from finish();
rollback;
