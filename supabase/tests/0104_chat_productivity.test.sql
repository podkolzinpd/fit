begin;
create extension if not exists pgtap with schema extensions;
select plan(27);

insert into auth.users (id,instance_id,aud,role,email,encrypted_password) values
('b0400000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','chat-actions-trainer@example.test',''),
('b0400000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','chat-actions-client@example.test',''),
('b0400000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','chat-actions-stranger@example.test','');
insert into public.profiles(id,account_role,first_name,last_name) values
('b0400000-0000-4000-8000-000000000001','trainer','Анна','Тренер'),
('b0400000-0000-4000-8000-000000000002','client','Иван','Спортсмен'),
('b0400000-0000-4000-8000-000000000003','trainer','Чужой','Тренер');
insert into public.trainers(profile_id) values ('b0400000-0000-4000-8000-000000000001'),('b0400000-0000-4000-8000-000000000003');
insert into public.clients(id,trainer_id,auth_user_id,full_name) values
('b0400000-0000-4000-8000-000000000010','b0400000-0000-4000-8000-000000000002','b0400000-0000-4000-8000-000000000002','Иван Спортсмен');
insert into public.client_trainers(client_id,trainer_id) values
('b0400000-0000-4000-8000-000000000010','b0400000-0000-4000-8000-000000000001');
insert into public.client_trainer_relationships(client_id,trainer_id,connected_by) values
('b0400000-0000-4000-8000-000000000010','b0400000-0000-4000-8000-000000000001','b0400000-0000-4000-8000-000000000002');
insert into public.push_subscriptions(user_id,endpoint,p256dh,auth_key) values
('b0400000-0000-4000-8000-000000000002','https://push.example/chat-actions-client','key','auth');

select has_column('public','chat_messages','edited_at','edit timestamp exists');
select has_column('public','chat_messages','reply_to_message_id','reply reference exists');
select has_function('public','edit_chat_message',array['uuid','uuid','text']::text[],'edit function exists');
select has_function('public','search_chat_messages',array['uuid','text','integer']::text[],'search function exists');
select has_function('public','get_chat_unread_state',array['uuid']::text[],'unread state exists');
select has_function('public','mark_chat_read_v2',array['uuid','uuid']::text[],'bounded read exists');

set local role authenticated;
select set_config('request.jwt.claim.sub','b0400000-0000-4000-8000-000000000001',true);
create temporary table opened as select public.open_chat('b0400000-0000-4000-8000-000000000010','b0400000-0000-4000-8000-000000000001') id;
select lives_ok($$select * from public.send_chat_message_v3((select id from opened),'b0400000-0000-4000-8000-000000000020','Первая заметка',null,null,null,null,null,null)$$,'trainer sends first message');
select lives_ok($$select * from public.send_chat_message_v3((select id from opened),'b0400000-0000-4000-8000-000000000021','Вторая заметка',null,null,null,null,null,null)$$,'trainer sends second message');
select lives_ok($$select * from public.edit_chat_message((select id from opened),'b0400000-0000-4000-8000-000000000020','Первая исправленная')$$,'sender edits own message');
select isnt((select edited_at from public.chat_messages where id='b0400000-0000-4000-8000-000000000020'),null,'edited message is marked');
reset role;
select is((select count(*) from private.push_notifications_outbox where kind='chat_message'),2::bigint,'edit creates no duplicate push');

set local role authenticated;
select set_config('request.jwt.claim.sub','b0400000-0000-4000-8000-000000000002',true);
select is((select unread_count from public.get_chat_unread_state((select id from opened))),2::bigint,'recipient sees two unread messages');
select is((select first_message_id from public.get_chat_unread_state((select id from opened))),'b0400000-0000-4000-8000-000000000020'::uuid,'first unread is stable');
select lives_ok($$select public.mark_chat_read_v2((select id from opened),'b0400000-0000-4000-8000-000000000020')$$,'read advances to visible message');
select is((select unread_count from public.get_chat_unread_state((select id from opened))),1::bigint,'later message remains unread');
select is((select unread_count from public.list_chat_threads()),1::bigint,'thread badge uses the same exact unread boundary');
select throws_ok($$select * from public.edit_chat_message((select id from opened),'b0400000-0000-4000-8000-000000000020','Чужое изменение')$$,'PT403','chat_forbidden','recipient cannot edit partner message');
select lives_ok($$select * from public.send_chat_message_v3((select id from opened),'b0400000-0000-4000-8000-000000000022','Понял',null,null,null,null,null,'b0400000-0000-4000-8000-000000000020')$$,'recipient replies to a message');
select is((select reply_to_body from public.list_chat_messages_v3((select id from opened),null,null,50) where id='b0400000-0000-4000-8000-000000000022'),'Первая исправленная','reply preview uses current text');
select is((select count(*) from public.search_chat_messages((select id from opened),'исправленная',50)),1::bigint,'search covers full stored history');
select is((select count(*) from public.search_chat_messages((select id from opened),'%%',50)),0::bigint,'search treats wildcard characters as plain text');
select is((select count(*) from public.get_chat_message_window((select id from opened),'b0400000-0000-4000-8000-000000000020',25)),3::bigint,'message window returns nearby context');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub','b0400000-0000-4000-8000-000000000001',true);
select lives_ok($$select public.delete_chat_message((select id from opened),'b0400000-0000-4000-8000-000000000020')$$,'sender deletes replied-to message');
select is((select reply_to_deleted from public.list_chat_messages_v3((select id from opened),null,null,50) where id='b0400000-0000-4000-8000-000000000022'),true,'reply keeps a deleted-original marker');
select is((select count(*) from public.search_chat_messages((select id from opened),'исправленная',50)),0::bigint,'deleted content is absent from search');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub','b0400000-0000-4000-8000-000000000003',true);
select throws_ok($$select * from public.search_chat_messages((select id from opened),'заметка',50)$$,'PT403','chat_forbidden','stranger cannot search');
select throws_ok($$select * from public.get_chat_message_window((select id from opened),'b0400000-0000-4000-8000-000000000021',25)$$,'PT403','chat_forbidden','stranger cannot load context');
reset role;

select * from finish();
rollback;
