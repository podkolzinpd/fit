begin;
create extension if not exists pgtap with schema extensions;
select plan(26);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password) values
  ('c0700000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','client@example.test',''),
  ('c0700000-0000-4000-8000-000000000011','00000000-0000-0000-8000-000000000000','authenticated','authenticated','trainer@example.test',''),
  ('c0700000-0000-4000-8000-000000000012','00000000-0000-0000-8000-000000000000','authenticated','authenticated','other@example.test','');
insert into public.profiles (id, account_role, first_name) values
  ('c0700000-0000-4000-8000-000000000001','client','Иван'),
  ('c0700000-0000-4000-8000-000000000011','trainer','Анна'),
  ('c0700000-0000-4000-8000-000000000012','trainer','Ольга');
insert into public.trainers (profile_id) values
  ('c0700000-0000-4000-8000-000000000011'), ('c0700000-0000-4000-8000-000000000012');
insert into public.clients (id, trainer_id, auth_user_id, full_name)
values ('c0700000-0000-4000-8000-000000000002','c0700000-0000-4000-8000-000000000001','c0700000-0000-4000-8000-000000000001','Иван');
insert into public.chat_conversations (id, client_id, client_user_id, trainer_id, origin) values
  ('c0700000-0000-4000-8000-000000000020','c0700000-0000-4000-8000-000000000002','c0700000-0000-4000-8000-000000000001','c0700000-0000-4000-8000-000000000011','discovery');
insert into public.push_subscriptions (user_id, endpoint, p256dh, auth_key) values
  ('c0700000-0000-4000-8000-000000000001','https://push.example/invitation-client','key','auth'),
  ('c0700000-0000-4000-8000-000000000011','https://push.example/invitation-trainer','key','auth');

select has_column('public','chat_conversations','connection_invited_at','invitation timestamp exists');
select has_function('public','get_chat_connection_state',array['uuid']::text[],'state function exists');
select has_function('public','send_chat_connection_invitation',array['uuid']::text[],'send invitation function exists');
select has_function('public','accept_chat_connection_invitation',array['uuid']::text[],'accept invitation function exists');

set local role authenticated;
select set_config('request.jwt.claim.sub','c0700000-0000-4000-8000-000000000001',true);
select is((select active_connection from public.get_chat_connection_state('c0700000-0000-4000-8000-000000000020')),false,'client sees no connection before accepting');
select is((select can_accept from public.get_chat_connection_state('c0700000-0000-4000-8000-000000000020')),false,'client cannot accept before invitation');
select throws_ok($$select * from public.send_chat_connection_invitation('c0700000-0000-4000-8000-000000000020')$$,'PT403','chat_forbidden','client cannot send trainer invitation');
select throws_ok($$select * from public.accept_chat_connection_invitation('c0700000-0000-4000-8000-000000000020')$$,'PT409','chat_invitation_required','accept needs invitation');

select set_config('request.jwt.claim.sub','c0700000-0000-4000-8000-000000000011',true);
select lives_ok($$select * from public.send_chat_connection_invitation('c0700000-0000-4000-8000-000000000020')$$,'trainer sends invitation');
select is((select invitation_pending from public.get_chat_connection_state('c0700000-0000-4000-8000-000000000020')),true,'trainer sees pending invitation');
select lives_ok($$select * from public.send_chat_connection_invitation('c0700000-0000-4000-8000-000000000020')$$,'repeat send is idempotent');
reset role;
select is((select count(*) from private.push_notifications_outbox where data->>'event'='trainer_invitation'),1::bigint,'repeat invitation creates one push');
select is((select data->>'url' from private.push_notifications_outbox where data->>'event'='trainer_invitation'),'/chat/c0700000-0000-4000-8000-000000000020','invitation push opens exact thread');

set local role authenticated;
select set_config('request.jwt.claim.sub','c0700000-0000-4000-8000-000000000001',true);
select is((select can_accept from public.get_chat_connection_state('c0700000-0000-4000-8000-000000000020')),true,'client can accept invitation');
select lives_ok($$select * from public.accept_chat_connection_invitation('c0700000-0000-4000-8000-000000000020')$$,'client accepts invitation');
select lives_ok($$select * from public.accept_chat_connection_invitation('c0700000-0000-4000-8000-000000000020')$$,'repeat accept is idempotent');
select is((select count(*) from public.client_trainers where client_id='c0700000-0000-4000-8000-000000000002' and trainer_id='c0700000-0000-4000-8000-000000000011'),1::bigint,'membership created once');
select is((select count(*) from public.client_trainer_relationships where client_id='c0700000-0000-4000-8000-000000000002' and trainer_id='c0700000-0000-4000-8000-000000000011' and status='active'),1::bigint,'active relationship created once');
select is((select active_connection from public.get_chat_connection_state('c0700000-0000-4000-8000-000000000020')),true,'connection becomes active');

reset role;
select is((select count(*) from private.push_notifications_outbox where data->>'event'='trainer_invitation_accepted'),1::bigint,'repeat accept creates one push');
select is((select data->>'url' from private.push_notifications_outbox where data->>'event'='trainer_invitation_accepted'),'/chat/c0700000-0000-4000-8000-000000000020','accepted push opens exact thread');
delete from public.client_trainers where client_id='c0700000-0000-4000-8000-000000000002';
update public.client_trainer_relationships set status='disconnected',disconnected_at=now(),disconnected_by='c0700000-0000-4000-8000-000000000001' where client_id='c0700000-0000-4000-8000-000000000002' and status='active';
insert into public.client_trainer_relationships (client_id,trainer_id,connected_by) values
  ('c0700000-0000-4000-8000-000000000002','c0700000-0000-4000-8000-000000000012','c0700000-0000-4000-8000-000000000001');
set local role authenticated;
select set_config('request.jwt.claim.sub','c0700000-0000-4000-8000-000000000001',true);
select is((select trainer_switch_required from public.get_chat_connection_state('c0700000-0000-4000-8000-000000000020')),true,'state reports another active trainer');
select throws_ok($$select * from public.accept_chat_connection_invitation('c0700000-0000-4000-8000-000000000020')$$,'PT409','trainer_switch_required','accept never replaces another trainer');

select set_config('request.jwt.claim.sub','c0700000-0000-4000-8000-000000000012',true);
select is((select count(*) from public.get_chat_connection_state('c0700000-0000-4000-8000-000000000020')),0::bigint,'stranger gets no state row');

select set_config('request.jwt.claim.sub','c0700000-0000-4000-8000-000000000011',true);
select lives_ok($$select * from public.set_chat_block('c0700000-0000-4000-8000-000000000020',true)$$,'trainer blocks chat');
select throws_ok($$select * from public.send_chat_connection_invitation('c0700000-0000-4000-8000-000000000020')$$,'PT403','chat_blocked','blocked chat cannot invite');

reset role;
select * from finish();
rollback;
