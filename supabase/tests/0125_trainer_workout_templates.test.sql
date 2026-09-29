begin;
create extension if not exists pgtap with schema extensions;
select plan(13);
select private.set_source_cutover_write_gate(false);

insert into auth.users (id,instance_id,aud,role,email,encrypted_password) values
 ('91000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','template-owner@example.test',''),
 ('92000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','template-other@example.test',''),
 ('93000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','template-client@example.test','');
insert into public.profiles(id,account_role) values
 ('91000000-0000-4000-8000-000000000001','trainer'),
 ('92000000-0000-4000-8000-000000000002','trainer'),
 ('93000000-0000-4000-8000-000000000003','client');
insert into public.trainers(profile_id) values
 ('91000000-0000-4000-8000-000000000001'),
 ('92000000-0000-4000-8000-000000000002');

set local role authenticated;
select set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000001',true);
select is(public.save_workout_template('{"id":"91100000-0000-4000-8000-000000000011","name":"Ноги","notes":"Темп","exercises":[{"source":"system","ref":"squat","name":"Присед","muscleGroup":"legs","inputKind":"strength","position":0,"sets":[{"position":0,"weightKg":50,"reps":8}]}]}'::jsonb), '91100000-0000-4000-8000-000000000011'::uuid, 'trainer creates a template');
select is((select count(*) from public.workout_templates),1::bigint,'owner sees template');
select is((select trainer_id from public.workout_templates limit 1),'91000000-0000-4000-8000-000000000001'::uuid,'owner is derived from actor');
select is(public.save_workout_template('{"id":"91100000-0000-4000-8000-000000000011","name":"Ноги 2","exercises":[]}'::jsonb,1),'91100000-0000-4000-8000-000000000011'::uuid,'owner updates template');
select is((select version from public.workout_templates where id='91100000-0000-4000-8000-000000000011'),2::bigint,'update increments version');
select throws_ok($$select public.save_workout_template('{"id":"91100000-0000-4000-8000-000000000011","name":"Старая","exercises":[]}'::jsonb,1)$$,'PT409','workout_template_conflict','stale update rejected');
select throws_ok($$select public.save_workout_template('{"id":"91200000-0000-4000-8000-000000000012","name":"Факты","exercises":[{"source":"system","ref":"squat","name":"Присед","muscleGroup":"legs","inputKind":"strength","position":0,"sets":[{"position":0,"fact":{"weightKg":70}}]}]}'::jsonb)$$,'PT422','invalid_workout_template','performed facts cannot enter a template');

select set_config('request.jwt.claim.sub','92000000-0000-4000-8000-000000000002',true);
select is((select count(*) from public.workout_templates),0::bigint,'other trainer cannot read template');
select throws_ok($$select public.save_workout_template('{"id":"91100000-0000-4000-8000-000000000011","name":"Чужой","exercises":[]}'::jsonb,2)$$,'PT404','workout_template_not_found','other trainer cannot update template');
select throws_ok($$select public.archive_workout_template('91100000-0000-4000-8000-000000000011',2)$$,'PT404','workout_template_not_found','other trainer cannot archive template');

select set_config('request.jwt.claim.sub','93000000-0000-4000-8000-000000000003',true);
select throws_ok($$select public.save_workout_template('{"id":"93100000-0000-4000-8000-000000000031","name":"Клиент","exercises":[]}'::jsonb)$$,'PT403','trainer_not_initialized','client cannot create template');

select set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000001',true);
select is(public.archive_workout_template('91100000-0000-4000-8000-000000000011',2),3::bigint,'owner archives current template');
select is((select count(*) from public.workout_templates where archived_at is null),0::bigint,'archived template leaves active list');

select * from finish();
rollback;
