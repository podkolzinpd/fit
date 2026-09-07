begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password) values
  ('68000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'selected-trainer@example.test', ''),
  ('68000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'selected-client@example.test', ''),
  ('68000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'other-selected-trainer@example.test', ''),
  ('68000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'other-selected-client@example.test', '');
insert into public.profiles (id, account_role, first_name) values
  ('68000000-0000-4000-8000-000000000001', 'trainer', 'Invited trainer'),
  ('68000000-0000-4000-8000-000000000002', 'client', 'Client'),
  ('68000000-0000-4000-8000-000000000003', 'trainer', 'Other trainer'),
  ('68000000-0000-4000-8000-000000000004', 'client', 'Other client');
insert into public.trainers (profile_id) values
  ('68000000-0000-4000-8000-000000000001'),
  ('68000000-0000-4000-8000-000000000003');
insert into public.clients (id, trainer_id, auth_user_id, full_name) values
  ('68000000-0000-4000-8000-000000000010', '68000000-0000-4000-8000-000000000002', '68000000-0000-4000-8000-000000000002', 'Client');
insert into public.client_progress (client_id, trainer_id, recorded_on, weight_kg, created_by, updated_by)
values ('68000000-0000-4000-8000-000000000010', '68000000-0000-4000-8000-000000000002', '2026-08-20', 70, '68000000-0000-4000-8000-000000000002', '68000000-0000-4000-8000-000000000002');

set local role authenticated;
select set_config('request.jwt.claim.sub', '68000000-0000-4000-8000-000000000002', true);
create temporary table invitation_code as select public.create_client_invitation('68000000-0000-4000-8000-000000000010', 'trainer') code;
select set_config('request.jwt.claim.sub', '68000000-0000-4000-8000-000000000001', true);
select public.claim_client_invitation((select code from invitation_code));
select is(public.can_access_client('68000000-0000-4000-8000-000000000010'), true, 'invited trainer initially has access');
reset role;
select is((select count(*) from public.client_trainer_relationships where client_id = '68000000-0000-4000-8000-000000000010'), 0::bigint, 'trainer invitation reproduces membership without a relationship');

set local role authenticated;
select set_config('request.jwt.claim.sub', '68000000-0000-4000-8000-000000000002', true);
select lives_ok($$select public.remove_client_trainer('68000000-0000-4000-8000-000000000010', '68000000-0000-4000-8000-000000000001')$$, 'owner disconnects invited trainer');
select is((select count(*) from public.list_client_trainers('68000000-0000-4000-8000-000000000010')), 0::bigint, 'fresh profile list is empty');
select lives_ok($$select public.remove_client_trainer('68000000-0000-4000-8000-000000000010', '68000000-0000-4000-8000-000000000001')$$, 'repeat is idempotent');
select is(public.can_access_client('68000000-0000-4000-8000-000000000010'), true, 'client retains access');
select set_config('request.jwt.claim.sub', '68000000-0000-4000-8000-000000000001', true);
select is(public.can_access_client('68000000-0000-4000-8000-000000000010'), false, 'removed trainer loses access');
select is((select count(*) from public.list_clients()), 0::bigint, 'client card disappears from trainer list');
select throws_ok($$select public.remove_client_trainer('68000000-0000-4000-8000-000000000010', '68000000-0000-4000-8000-000000000003')$$, 'PT403', 'client_role_required', 'trainer cannot remove someone else');
select set_config('request.jwt.claim.sub', '68000000-0000-4000-8000-000000000004', true);
select throws_ok($$select public.remove_client_trainer('68000000-0000-4000-8000-000000000010', '68000000-0000-4000-8000-000000000003')$$, 'PT403', 'membership_not_allowed', 'another client cannot remove a trainer');
reset role;
select is((select count(*) from public.client_progress where client_id = '68000000-0000-4000-8000-000000000010'), 1::bigint, 'measurements are preserved');

-- A canonical relationship and a historical extra membership can coexist.
insert into public.client_trainers (client_id, trainer_id) values
  ('68000000-0000-4000-8000-000000000010', '68000000-0000-4000-8000-000000000001'),
  ('68000000-0000-4000-8000-000000000010', '68000000-0000-4000-8000-000000000003');
insert into public.client_trainer_relationships (client_id, trainer_id, connected_by)
values ('68000000-0000-4000-8000-000000000010', '68000000-0000-4000-8000-000000000001', '68000000-0000-4000-8000-000000000002');

set local role authenticated;
select set_config('request.jwt.claim.sub', '68000000-0000-4000-8000-000000000002', true);
select public.remove_client_trainer('68000000-0000-4000-8000-000000000010', '68000000-0000-4000-8000-000000000003');
select is((select count(*) from public.list_client_trainers('68000000-0000-4000-8000-000000000010')), 1::bigint, 'removing extra trainer preserves primary trainer');
reset role;
select is((select status from public.client_trainer_relationships where client_id = '68000000-0000-4000-8000-000000000010'), 'active', 'unselected relationship remains active');
set local role authenticated;
select set_config('request.jwt.claim.sub', '68000000-0000-4000-8000-000000000002', true);
select public.remove_client_trainer('68000000-0000-4000-8000-000000000010', '68000000-0000-4000-8000-000000000001');
select is((select count(*) from public.list_client_trainers('68000000-0000-4000-8000-000000000010')), 0::bigint, 'primary membership is removed too');
reset role;
select is((select status from public.client_trainer_relationships where client_id = '68000000-0000-4000-8000-000000000010'), 'disconnected', 'targeted removal closes relationship so reconnect is not blocked');
select ok((select disconnected_at is not null and disconnected_by = '68000000-0000-4000-8000-000000000002' from public.client_trainer_relationships where client_id = '68000000-0000-4000-8000-000000000010'), 'disconnect keeps history and actor');
select is((select trainer_id from public.clients where id = '68000000-0000-4000-8000-000000000010'), '68000000-0000-4000-8000-000000000002'::uuid, 'client data ownership is unchanged');

select * from finish();
rollback;
