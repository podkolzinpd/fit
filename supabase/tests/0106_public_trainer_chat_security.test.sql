begin;
create extension if not exists pgtap with schema extensions;
select plan(32);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password) values
  ('c0600000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','discovery-client@example.test',''),
  ('c0600000-0000-4000-8000-000000000011','00000000-0000-0000-0000-000000000000','authenticated','authenticated','discovery-trainer-1@example.test',''),
  ('c0600000-0000-4000-8000-000000000012','00000000-0000-0000-0000-000000000000','authenticated','authenticated','discovery-trainer-2@example.test',''),
  ('c0600000-0000-4000-8000-000000000013','00000000-0000-0000-0000-000000000000','authenticated','authenticated','discovery-trainer-3@example.test',''),
  ('c0600000-0000-4000-8000-000000000014','00000000-0000-0000-0000-000000000000','authenticated','authenticated','discovery-trainer-4@example.test',''),
  ('c0600000-0000-4000-8000-000000000015','00000000-0000-0000-0000-000000000000','authenticated','authenticated','discovery-trainer-5@example.test',''),
  ('c0600000-0000-4000-8000-000000000016','00000000-0000-0000-0000-000000000000','authenticated','authenticated','discovery-trainer-6@example.test',''),
  ('c0600000-0000-4000-8000-000000000017','00000000-0000-0000-0000-000000000000','authenticated','authenticated','discovery-hidden@example.test','');
insert into public.profiles (id, account_role, first_name) values
  ('c0600000-0000-4000-8000-000000000001','client','Иван'),
  ('c0600000-0000-4000-8000-000000000011','trainer','Тренер 1'),
  ('c0600000-0000-4000-8000-000000000012','trainer','Тренер 2'),
  ('c0600000-0000-4000-8000-000000000013','trainer','Тренер 3'),
  ('c0600000-0000-4000-8000-000000000014','trainer','Тренер 4'),
  ('c0600000-0000-4000-8000-000000000015','trainer','Тренер 5'),
  ('c0600000-0000-4000-8000-000000000016','trainer','Тренер 6'),
  ('c0600000-0000-4000-8000-000000000017','trainer','Скрытый');
insert into public.trainers (profile_id) select id from public.profiles where account_role='trainer' and id::text like 'c060%';
insert into public.clients (id, trainer_id, auth_user_id, full_name)
values ('c0600000-0000-4000-8000-000000000002','c0600000-0000-4000-8000-000000000001','c0600000-0000-4000-8000-000000000001','Иван');
insert into public.trainer_professional_profiles (public_id, trainer_id, draft_data, published_data, published_at, listed_in_catalog)
select ('c0600000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  ('c0600000-0000-4000-8000-' || lpad((10+n)::text, 12, '0'))::uuid,
  jsonb_build_object('displayName','Тренер '||n), jsonb_build_object('displayName','Тренер '||n), now(), n < 7
from generate_series(1,7) n;

select has_column('public','chat_conversations','origin','conversation origin exists');
select has_column('public','chat_conversations','client_blocked_at','client block marker exists');
select has_column('public','chat_conversations','trainer_blocked_at','trainer block marker exists');
select has_function('public','open_public_trainer_chat',array['uuid']::text[],'public profile chat RPC exists');
select has_function('public','authorize_chat_send',array['uuid']::text[],'send authorization RPC exists');
select has_function('public','set_chat_block',array['uuid','boolean']::text[],'block RPC exists');

set local role authenticated;
select set_config('request.jwt.claim.sub','c0600000-0000-4000-8000-000000000001',true);
create temporary table discovery_opened as select public.open_public_trainer_chat('c0600000-0000-4000-8000-000000000001') id;
select ok((select id is not null from discovery_opened),'client opens listed trainer chat');
select is((select origin from public.chat_conversations where id=(select id from discovery_opened)),'discovery','origin is recorded');
select is(public.open_public_trainer_chat('c0600000-0000-4000-8000-000000000001'),(select id from discovery_opened),'repeat open is idempotent');
select is(public.can_access_client('c0600000-0000-4000-8000-000000000002'),true,'client still accesses own data');
select is((select active_connection from public.list_chat_threads() where conversation_id=(select id from discovery_opened)),false,'discovery chat is not a coaching connection');
select is((select can_message from public.list_chat_threads() where conversation_id=(select id from discovery_opened)),true,'new chat can send');
select lives_ok($$select * from public.send_chat_message((select id from discovery_opened),'c0600000-0000-4000-8000-000000000101','Здравствуйте')$$,'client sends through legacy current contract');
select lives_ok($$select * from public.set_chat_block((select id from discovery_opened),true)$$,'client blocks the chat');
select is((select can_message from public.list_chat_threads() where conversation_id=(select id from discovery_opened)),false,'blocked chat cannot send');
select is((select blocked_by_me from public.list_chat_threads() where conversation_id=(select id from discovery_opened)),true,'thread shows own block');
select throws_ok($$select * from public.send_chat_message((select id from discovery_opened),'c0600000-0000-4000-8000-000000000102','Нет')$$,'PT403','chat_blocked','legacy send cannot bypass block');
select throws_ok($$select * from public.send_chat_message_v3((select id from discovery_opened),'c0600000-0000-4000-8000-000000000103','Нет',null,null,null,null,null,null)$$,'PT403','chat_blocked','current send cannot bypass block');
select throws_ok($$select * from public.edit_chat_message((select id from discovery_opened),'c0600000-0000-4000-8000-000000000101','Изменить')$$,'PT403','chat_blocked','edit cannot communicate through block');

select set_config('request.jwt.claim.sub','c0600000-0000-4000-8000-000000000011',true);
select is((select blocked_by_partner from public.list_chat_threads() where conversation_id=(select id from discovery_opened)),true,'trainer sees partner block');
select throws_ok($$select * from public.send_chat_message_v2((select id from discovery_opened),'c0600000-0000-4000-8000-000000000104','Ответ',null,null,null,null,null)$$,'PT403','chat_blocked','photo send contract cannot bypass block');
select is(public.can_access_client('c0600000-0000-4000-8000-000000000002'),false,'conversation grants no workout access to trainer');

select set_config('request.jwt.claim.sub','c0600000-0000-4000-8000-000000000001',true);
select lives_ok($$select * from public.set_chat_block((select id from discovery_opened),false)$$,'client unblocks the chat');
select lives_ok($$select * from public.send_chat_message_v3((select id from discovery_opened),'c0600000-0000-4000-8000-000000000105','Снова можно',null,null,null,null,null,null)$$,'send resumes after unblock');
select throws_ok($$select public.open_public_trainer_chat('c0600000-0000-4000-8000-000000000007')$$,'PT403','chat_forbidden','hidden trainer cannot be contacted');

select set_config('request.jwt.claim.sub','c0600000-0000-4000-8000-000000000011',true);
select throws_ok($$select public.open_public_trainer_chat('c0600000-0000-4000-8000-000000000002')$$,'PT403','chat_forbidden','trainer account cannot pose as a client');

select set_config('request.jwt.claim.sub','c0600000-0000-4000-8000-000000000001',true);
select lives_ok($$select public.open_public_trainer_chat('c0600000-0000-4000-8000-000000000002')$$,'second discovery chat opens');
select lives_ok($$select public.open_public_trainer_chat('c0600000-0000-4000-8000-000000000003')$$,'third discovery chat opens');
select lives_ok($$select public.open_public_trainer_chat('c0600000-0000-4000-8000-000000000004')$$,'fourth discovery chat opens');
select lives_ok($$select public.open_public_trainer_chat('c0600000-0000-4000-8000-000000000005')$$,'fifth discovery chat opens');
select throws_ok($$select public.open_public_trainer_chat('c0600000-0000-4000-8000-000000000006')$$,'PT429','chat_rate_limited','sixth new discovery chat is rate limited');
select is((select count(*) from public.chat_conversations where client_user_id='c0600000-0000-4000-8000-000000000001' and origin='discovery'),5::bigint,'rate limit leaves five conversations');

reset role;
select * from finish();
rollback;
