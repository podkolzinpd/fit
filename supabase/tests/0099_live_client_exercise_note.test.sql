begin;
create extension if not exists pgtap with schema extensions;
select plan(9);
insert into auth.users (id, instance_id, aud, role, email, encrypted_password) values
('99000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','note-trainer@example.test',''),
('99000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','note-client@example.test',''),
('99000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','note-other@example.test','');
insert into public.profiles (id,account_role) values
('99000000-0000-4000-8000-000000000001','trainer'),('99000000-0000-4000-8000-000000000002','client'),('99000000-0000-4000-8000-000000000003','client');
insert into public.trainers(profile_id) values ('99000000-0000-4000-8000-000000000001');
insert into public.clients(id,trainer_id,auth_user_id,full_name,gender,age_years,height_cm) values
('99000000-0000-4000-8000-000000000004','99000000-0000-4000-8000-000000000001','99000000-0000-4000-8000-000000000002','Note client','male',30,180);
insert into public.workouts(id,trainer_id,client_id,created_by,workout_date,status,started_at,version) values
('99000000-0000-4000-8000-000000000005','99000000-0000-4000-8000-000000000001','99000000-0000-4000-8000-000000000004','99000000-0000-4000-8000-000000000001',current_date,'in_progress',now(),1);
insert into public.workout_exercises(id,workout_id,trainer_id,client_id,position,exercise_source,exercise_ref,exercise_name,muscle_group,input_kind,trainer_comment) values
('99000000-0000-4000-8000-000000000006','99000000-0000-4000-8000-000000000005','99000000-0000-4000-8000-000000000001','99000000-0000-4000-8000-000000000004',0,'system','squat','Присед','legs','strength','Указание тренера');
set local role authenticated;
select set_config('request.jwt.claim.sub','99000000-0000-4000-8000-000000000002',true);
select is(public.set_exercise_comment('99000000-0000-4000-8000-000000000006','  Моя заметка  ',1),2::bigint,'client can note trainer assigned Live exercise');
select is((select client_note from public.workout_exercises where id='99000000-0000-4000-8000-000000000006'),'Моя заметка','note trimmed and readable');
select is((select trainer_comment from public.workout_exercises where id='99000000-0000-4000-8000-000000000006'),'Указание тренера','trainer cue unchanged');
select throws_ok($$select public.set_exercise_comment('99000000-0000-4000-8000-000000000006','stale',1)$$,'PT409','workout_conflict','stale version rejected');
select throws_ok($$select public.set_exercise_comment('99000000-0000-4000-8000-000000000006',repeat('x',5001),2)$$,'PT422','workout_invalid','oversized note rejected');
select set_config('request.jwt.claim.sub','99000000-0000-4000-8000-000000000003',true);
select throws_ok($$select public.set_exercise_comment('99000000-0000-4000-8000-000000000006','other',2)$$,'PT403','workout_access_denied','other client rejected');
select set_config('request.jwt.claim.sub','99000000-0000-4000-8000-000000000001',true);
select is(public.set_exercise_comment('99000000-0000-4000-8000-000000000006','Новая подсказка',2),3::bigint,'trainer updates own cue');
select is((select client_note from public.workout_exercises where id='99000000-0000-4000-8000-000000000006'),'Моя заметка','trainer cannot overwrite client note');
select set_config('request.jwt.claim.sub','99000000-0000-4000-8000-000000000002',true);
select is(public.set_exercise_comment('99000000-0000-4000-8000-000000000006','',3),4::bigint,'client clears own note');
reset role;
select * from finish();
rollback;
