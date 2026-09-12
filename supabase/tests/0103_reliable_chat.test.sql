begin;
create extension if not exists pgtap with schema extensions;
select plan(34);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password) values
  ('a0300000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','chat-trainer@example.test',''),
  ('a0300000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','chat-client@example.test',''),
  ('a0300000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','chat-stranger@example.test','');
insert into public.profiles (id, account_role, first_name, last_name) values
  ('a0300000-0000-4000-8000-000000000001','trainer','Анна','Тренер'),
  ('a0300000-0000-4000-8000-000000000002','client','Иван','Спортсмен'),
  ('a0300000-0000-4000-8000-000000000003','trainer','Чужой','Тренер');
insert into public.trainers (profile_id) values
  ('a0300000-0000-4000-8000-000000000001'),('a0300000-0000-4000-8000-000000000003');
insert into public.clients (id, trainer_id, auth_user_id, full_name) values
  ('a0300000-0000-4000-8000-000000000010','a0300000-0000-4000-8000-000000000002','a0300000-0000-4000-8000-000000000002','Иван Спортсмен');
insert into public.client_trainers (client_id, trainer_id) values
  ('a0300000-0000-4000-8000-000000000010','a0300000-0000-4000-8000-000000000001');
insert into public.client_trainer_relationships (client_id, trainer_id, connected_by) values
  ('a0300000-0000-4000-8000-000000000010','a0300000-0000-4000-8000-000000000001','a0300000-0000-4000-8000-000000000002');
insert into public.push_subscriptions (user_id, endpoint, p256dh, auth_key) values
  ('a0300000-0000-4000-8000-000000000002','https://push.example/chat-client','key','auth');

select has_function('public','open_chat',array['uuid','uuid']::text[],'open function exists');
select has_function('public','send_chat_message',array['uuid','uuid','text']::text[],'send function exists');
select has_function('public','list_chat_messages_v2',array['uuid','timestamp with time zone','uuid','integer']::text[],'photo-aware list exists');
select has_function('public','send_chat_message_v2',array['uuid','uuid','text','text','text','integer','integer','integer']::text[],'photo-aware send exists');
select has_function('public','delete_chat_message',array['uuid','uuid']::text[],'delete function exists');

set local role authenticated;
select set_config('request.jwt.claim.sub','a0300000-0000-4000-8000-000000000001',true);
create temporary table opened as select public.open_chat('a0300000-0000-4000-8000-000000000010','a0300000-0000-4000-8000-000000000001') id;
select is((select count(*) from public.list_chat_threads()),1::bigint,'trainer sees one thread');
select is((select partner_name from public.list_chat_threads()),'Иван Спортсмен','trainer sees athlete name');
select lives_ok($$select * from public.send_chat_message((select id from opened),'a0300000-0000-4000-8000-000000000020','Привет')$$,'trainer sends a message');
select lives_ok($$select * from public.send_chat_message((select id from opened),'a0300000-0000-4000-8000-000000000020','Привет')$$,'retry with same id is idempotent');
select is((select count(*) from public.chat_messages),1::bigint,'retry does not duplicate message');
select throws_ok($$select * from public.send_chat_message((select id from opened),'a0300000-0000-4000-8000-000000000020','Другой текст')$$,'PT409','chat_message_conflict','same id cannot change content');
select lives_ok($$select * from public.send_chat_message_v2((select id from opened),'a0300000-0000-4000-8000-000000000022','',
  (select id::text from opened)||'/a0300000-0000-4000-8000-000000000022.jpg','image/jpeg',1200,900,120000)$$,'trainer sends a photo');
select lives_ok($$select * from public.send_chat_message_v2((select id from opened),'a0300000-0000-4000-8000-000000000022','',
  (select id::text from opened)||'/a0300000-0000-4000-8000-000000000022.jpg','image/jpeg',1200,900,120000)$$,'photo retry is idempotent');
select is((select count(*) from public.chat_messages),2::bigint,'photo retry does not duplicate message');
select is((select image_width from public.list_chat_messages_v2((select id from opened),null,null,50) where id='a0300000-0000-4000-8000-000000000022'),1200,'photo metadata is returned');
select is((select last_message_body from public.list_chat_threads()),'Фото','photo has a clear thread preview');
reset role;

select is((select count(*) from private.push_notifications_outbox where kind='chat_message'),2::bigint,'text and photo create one push each');
select is((select data->>'url' from private.push_notifications_outbox where kind='chat_message' and data->>'message_id'='a0300000-0000-4000-8000-000000000020'),'/chat/'||(select id from opened),'push opens exact thread');
select is((select body from private.push_notifications_outbox where data->>'message_id'='a0300000-0000-4000-8000-000000000022'),'Фото','photo push has a short preview');

set local role authenticated;
select set_config('request.jwt.claim.sub','a0300000-0000-4000-8000-000000000002',true);
select is((select unread_count from public.list_chat_threads()),2::bigint,'recipient sees unread count');
select lives_ok($$select public.mark_chat_read((select id from opened))$$,'recipient marks thread read');
select is((select unread_count from public.list_chat_threads()),0::bigint,'read count clears');
select is((select count(*) from public.list_chat_messages_v2((select id from opened),null,null,50)),2::bigint,'recipient reads history');
select throws_ok($$select public.delete_chat_message((select id from opened),'a0300000-0000-4000-8000-000000000020')$$,'PT403','chat_forbidden','recipient cannot delete trainer message');
reset role;

delete from public.client_trainers where client_id='a0300000-0000-4000-8000-000000000010';
update public.client_trainer_relationships
set status='disconnected', disconnected_at=now(), disconnected_by='a0300000-0000-4000-8000-000000000002'
where client_id='a0300000-0000-4000-8000-000000000010' and status='active';
set local role authenticated;
select set_config('request.jwt.claim.sub','a0300000-0000-4000-8000-000000000001',true);
select is((select active_connection from public.list_chat_threads()),false,'thread records disconnected state');
select lives_ok($$select * from public.send_chat_message((select id from opened),'a0300000-0000-4000-8000-000000000021','Остаёмся на связи')$$,'disconnected trainer can still write');
select lives_ok($$select public.delete_chat_message((select id from opened),'a0300000-0000-4000-8000-000000000020')$$,'sender deletes own message');
select lives_ok($$select public.delete_chat_message((select id from opened),'a0300000-0000-4000-8000-000000000020')$$,'delete retry is idempotent');
select is((select body from public.chat_messages where id='a0300000-0000-4000-8000-000000000020'),'','deleted text is scrubbed');
select is((select count(*) from public.list_chat_messages_v2((select id from opened),null,null,50)),2::bigint,'deleted message disappears from history');
select is(public.can_access_client('a0300000-0000-4000-8000-000000000010'),false,'chat does not restore athlete data access');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub','a0300000-0000-4000-8000-000000000003',true);
select throws_ok($$select * from public.list_chat_messages((select id from opened),null,null,50)$$,'PT403','chat_forbidden','stranger cannot read messages');
select throws_ok($$select public.open_chat('a0300000-0000-4000-8000-000000000010','a0300000-0000-4000-8000-000000000003')$$,'PT403','chat_forbidden','stranger cannot open a thread');
reset role;

select is((select count(*) from public.chat_conversations
  where client_id='a0300000-0000-4000-8000-000000000010'
    and trainer_id='a0300000-0000-4000-8000-000000000001'),1::bigint,'one durable conversation remains');
select * from finish();
rollback;
