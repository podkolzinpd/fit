begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password) values
  ('c0900000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','connection-client@example.test',''),
  ('c0900000-0000-4000-8000-000000000011','00000000-0000-0000-0000-000000000000','authenticated','authenticated','connection-old@example.test',''),
  ('c0900000-0000-4000-8000-000000000012','00000000-0000-0000-0000-000000000000','authenticated','authenticated','connection-current@example.test',''),
  ('c0900000-0000-4000-8000-000000000013','00000000-0000-0000-0000-000000000000','authenticated','authenticated','connection-phantom@example.test','');
insert into public.profiles (id, account_role, first_name) values
  ('c0900000-0000-4000-8000-000000000001','client','Иван'),
  ('c0900000-0000-4000-8000-000000000011','trainer','Старый'),
  ('c0900000-0000-4000-8000-000000000012','trainer','Анастасия'),
  ('c0900000-0000-4000-8000-000000000013','trainer','Лишний');
insert into public.trainers (profile_id) values
  ('c0900000-0000-4000-8000-000000000011'),
  ('c0900000-0000-4000-8000-000000000012'),
  ('c0900000-0000-4000-8000-000000000013');
insert into public.clients (id, trainer_id, auth_user_id, full_name) values
  ('c0900000-0000-4000-8000-000000000002','c0900000-0000-4000-8000-000000000001','c0900000-0000-4000-8000-000000000001','Иван');
insert into public.client_trainers (client_id, trainer_id, joined_at) values
  ('c0900000-0000-4000-8000-000000000002','c0900000-0000-4000-8000-000000000011',now() - interval '2 months'),
  ('c0900000-0000-4000-8000-000000000002','c0900000-0000-4000-8000-000000000012',now() - interval '1 day'),
  ('c0900000-0000-4000-8000-000000000002','c0900000-0000-4000-8000-000000000013',now() - interval '3 months');
insert into public.client_trainer_relationships (
  client_id, trainer_id, status, connected_at, disconnected_at, connected_by, disconnected_by
) values (
  'c0900000-0000-4000-8000-000000000002','c0900000-0000-4000-8000-000000000011','disconnected',
  now() - interval '2 months',now() - interval '1 month','c0900000-0000-4000-8000-000000000011','c0900000-0000-4000-8000-000000000001'
);
insert into public.client_trainer_relationships (client_id, trainer_id, connected_by) values
  ('c0900000-0000-4000-8000-000000000002','c0900000-0000-4000-8000-000000000012','c0900000-0000-4000-8000-000000000001');
insert into public.chat_conversations (id, client_id, client_user_id, trainer_id) values
  ('c0900000-0000-4000-8000-000000000020','c0900000-0000-4000-8000-000000000002','c0900000-0000-4000-8000-000000000001','c0900000-0000-4000-8000-000000000011');
insert into public.chat_messages (id, conversation_id, sender_id, body) values
  ('c0900000-0000-4000-8000-000000000021','c0900000-0000-4000-8000-000000000020','c0900000-0000-4000-8000-000000000011','История остаётся');

set local role authenticated;
select set_config('request.jwt.claim.sub','c0900000-0000-4000-8000-000000000001',true);
select is((select count(*) from public.list_client_trainers('c0900000-0000-4000-8000-000000000002')),1::bigint,'only active trainer appears in profile');
select is((select trainer_id from public.list_client_trainers('c0900000-0000-4000-8000-000000000002')),'c0900000-0000-4000-8000-000000000012'::uuid,'current trainer is returned');
select is((select count(*) from public.list_chat_threads()),2::bigint,'chat list has current trainer and existing history only');
select is((select active_connection from public.list_chat_threads() where trainer_id='c0900000-0000-4000-8000-000000000011'),false,'old conversation is disconnected');
select is((select active_connection from public.list_chat_threads() where trainer_id='c0900000-0000-4000-8000-000000000012'),true,'current trainer is connected');
select is((select count(*) from public.list_chat_threads() where trainer_id='c0900000-0000-4000-8000-000000000013'),0::bigint,'stale membership creates no phantom chat');
select is((select active_connection from public.get_chat_connection_state('c0900000-0000-4000-8000-000000000020')),false,'dialog uses the same disconnected state');
select throws_ok($$select public.open_chat('c0900000-0000-4000-8000-000000000002','c0900000-0000-4000-8000-000000000013')$$,'PT403','chat_forbidden','stale membership cannot open a new chat');
select lives_ok($$select public.open_chat('c0900000-0000-4000-8000-000000000002','c0900000-0000-4000-8000-000000000012')$$,'active trainer can open a chat');
select is((select count(*) from public.list_chat_messages_v2('c0900000-0000-4000-8000-000000000020',null,null,50)),1::bigint,'old history remains readable');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub','c0900000-0000-4000-8000-000000000011',true);
select lives_ok($$select * from public.send_chat_message('c0900000-0000-4000-8000-000000000020','c0900000-0000-4000-8000-000000000022','Спасибо')$$,'old trainer can still use existing chat');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub','c0900000-0000-4000-8000-000000000012',true);
select is((select count(*) from public.list_chat_threads() where active_connection),1::bigint,'current trainer sees one active chat entry');
reset role;

select * from finish();
rollback;
