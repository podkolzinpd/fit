begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users (id, instance_id, aud, role, email, encrypted_password) values
 ('50000000-0000-4000-8000-000000000074','00000000-0000-0000-0000-000000000000','authenticated','authenticated','trainer74@example.test',''),
 ('50000000-0000-4000-8000-000000000075','00000000-0000-0000-0000-000000000000','authenticated','authenticated','client74@example.test',''),
 ('50000000-0000-4000-8000-000000000076','00000000-0000-0000-0000-000000000000','authenticated','authenticated','other74@example.test','');
insert into public.profiles (id, account_role) values
 ('50000000-0000-4000-8000-000000000074','trainer'),
 ('50000000-0000-4000-8000-000000000075','client'),
 ('50000000-0000-4000-8000-000000000076','trainer');
insert into public.trainers (profile_id) values ('50000000-0000-4000-8000-000000000074'),('50000000-0000-4000-8000-000000000076');
insert into public.clients (id, trainer_id, auth_user_id, full_name, gender, age_years, height_cm) values
 ('c0000000-0000-4000-8000-000000000074','50000000-0000-4000-8000-000000000074','50000000-0000-4000-8000-000000000075','Removal fixture','male',30,180);
set local role authenticated;
select set_config('request.jwt.claim.sub','50000000-0000-4000-8000-000000000074',true);
create temp table fixture (id uuid, payload jsonb);
insert into fixture(payload) select jsonb_build_object('clientId','c0000000-0000-4000-8000-000000000074','workoutDate','2026-09-04','exercises',jsonb_agg(jsonb_build_object(
 'source','system','ref','squat','name','Exercise '||i,'muscleGroup','legs','inputKind','strength','position',i,
 'sets',jsonb_build_array(jsonb_build_object('position',0,'weightKg',10,'reps',10),jsonb_build_object('position',1,'weightKg',20,'reps',15))
 ) order by i)) from generate_series(0,2) i;
update fixture set id = public.save_completed_workout(payload);
create temp table original_exercises as select e.* from public.workout_exercises e where workout_id=(select id from fixture);
create temp table original_sets as select s.* from public.workout_sets s join original_exercises e on e.id=s.workout_exercise_id;
-- Delete first and middle exercise and first set in the surviving exercise.
update fixture set payload = payload || jsonb_build_object('id',id,'exercises',jsonb_build_array(jsonb_build_object(
 'sourceExerciseId',(select id from original_exercises where position=2),'source','system','ref','squat','name','Exercise 2','muscleGroup','legs','inputKind','strength','position',0,
 'sets',jsonb_build_array(jsonb_build_object('sourceSetId',(select s.id from original_sets s join original_exercises e on e.id=s.workout_exercise_id where e.position=2 and s.position=1),'position',0,'weightKg',25,'reps',12))
 )));
select lives_ok($$select public.save_completed_workout(payload,(select version from public.workouts where id=fixture.id)) from fixture$$,'trainer saves after deleting exercises and first set');
select is((select count(*) from public.workout_exercises where workout_id=(select id from fixture)),3::bigint,'omitted exercises remain in original plan');
select is((select count(*) from public.workout_sets s join original_exercises e on e.id=s.workout_exercise_id where s.confirmed_at is not null),1::bigint,'only remaining set is fact');
select is((select fact_weight_kg from public.workout_sets where id=(select s.id from original_sets s join original_exercises e on e.id=s.workout_exercise_id where e.position=2 and s.position=1)),25::numeric,'remaining fact survives');
select is((select sum(plan_weight_kg) from public.workout_sets s join original_exercises e on e.id=s.workout_exercise_id),90::numeric,'original plan values preserved');
select lives_ok($$select public.save_completed_workout(payload,(select version from public.workouts where id=fixture.id)) from fixture$$,'repeated save does not reintroduce position collisions');
select throws_ok($$select public.save_completed_workout(payload,0) from fixture$$,'PT409','workout_conflict','stale completed write rolls back parking');
select is((select position from public.workout_exercises where id=(select id from original_exercises where position=2)),0::smallint,'failed save leaves position unchanged');
-- Explicit removal from the completed detail deletes the occurrence rather
-- than merely excluding its fact. Both the authoring trainer and the owning
-- client can use it; an unrelated trainer cannot.
select set_config('request.jwt.claim.sub','50000000-0000-4000-8000-000000000076',true);
select throws_ok($$select public.remove_live_exercise((select id from fixture),(select id from original_exercises where position=0),(select version from public.workouts where id=(select id from fixture)))$$,'PT403',null,'unrelated trainer cannot delete completed exercise');
select set_config('request.jwt.claim.sub','50000000-0000-4000-8000-000000000074',true);
select lives_ok($$select public.remove_live_exercise((select id from fixture),(select id from original_exercises where position=0),(select version from public.workouts where id=(select id from fixture)))$$,'trainer deletes unperformed exercise from completed workout');
select is((select count(*) from public.workout_exercises where id=(select id from original_exercises where position=0)),0::bigint,'completed occurrence is deleted');
select is((select count(*) from public.workout_sets where workout_exercise_id=(select id from original_exercises where position=0)),0::bigint,'completed occurrence sets are deleted');
select set_config('request.jwt.claim.sub','50000000-0000-4000-8000-000000000075',true);
select throws_ok($$select public.remove_live_exercise((select id from fixture),(select id from original_exercises where position=2),0)$$,'PT409','workout_conflict','stale completed delete is rejected');
select lives_ok($$select public.remove_live_exercise((select id from fixture),(select id from original_exercises where position=2),(select version from public.workouts where id=(select id from fixture)))$$,'owning client deletes performed exercise from completed trainer workout');
select is((select count(*) from public.workout_sets where workout_exercise_id=(select id from original_exercises where position=2)),0::bigint,'performed facts are removed with completed occurrence');
select is((select count(*) from public.workout_exercises where workout_id=(select id from fixture)),1::bigint,'other completed exercise remains');
-- Live structure is shared between trainer and owning client.
select set_config('request.jwt.claim.sub','50000000-0000-4000-8000-000000000074',true);
update fixture set id=public.save_workout((payload - 'id') || jsonb_build_object('exercises',jsonb_build_array(
 jsonb_build_object('source','system','ref','squat','name','First','muscleGroup','legs','inputKind','strength','position',0,'sets',jsonb_build_array(jsonb_build_object('position',0,'weightKg',10,'reps',10))),
 jsonb_build_object('source','system','ref','plank','name','Second','muscleGroup','core','inputKind','duration','position',1,'sets',jsonb_build_array(jsonb_build_object('position',0,'durationSec',30)))
 )));
select public.start_workout(id,(select version from public.workouts where id=fixture.id)) from fixture;
create temp table live_exercises as select * from public.workout_exercises where workout_id=(select id from fixture);
select public.confirm_live_set(s.id,s.version) from public.workout_sets s join live_exercises e on e.id=s.workout_exercise_id where e.position=0;
select set_config('request.jwt.claim.sub','50000000-0000-4000-8000-000000000076',true);
select throws_ok($$select public.remove_live_exercise((select id from fixture),(select id from live_exercises where position=0),1)$$,'PT403',null,'unrelated trainer cannot delete');
select set_config('request.jwt.claim.sub','50000000-0000-4000-8000-000000000074',true);
select throws_ok($$select public.remove_live_exercise((select id from fixture),(select id from original_exercises limit 1),(select version from public.workouts where id=(select id from fixture)))$$,'PT404','exercise_not_found','exercise must belong to exact workout');
select throws_ok($$select public.remove_live_exercise((select id from fixture),(select id from live_exercises where position=0),0)$$,'PT409','workout_conflict','stale live delete rejected');
select lives_ok($$select public.remove_live_exercise((select id from fixture),(select id from live_exercises where position=0),(select version from public.workouts where id=(select id from fixture)))$$,'trainer deletes exercise with confirmed set');
select is((select count(*) from public.workout_sets where workout_exercise_id=(select id from live_exercises where position=0)),0::bigint,'deleted occurrence sets removed');
select is((select plan_duration_sec from public.workout_sets where workout_exercise_id=(select id from live_exercises where position=1)),30,'other exercise intact');
select set_config('request.jwt.claim.sub','50000000-0000-4000-8000-000000000075',true);
select lives_ok($$select public.remove_live_exercise((select id from fixture),(select id from live_exercises where position=1),(select version from public.workouts where id=(select id from fixture)))$$,'owning client deletes final exercise from trainer workout');
select is((select count(*) from public.workout_exercises where workout_id=(select id from fixture)),0::bigint,'empty Live can receive new exercises');
select public.append_live_exercise(id,'{"source":"system","ref":"plank","name":"Планка","muscleGroup":"core","inputKind":"duration"}',(select version from public.workouts where id=fixture.id)) from fixture;
select is((select count(*) from public.workout_exercises where workout_id=(select id from fixture)),1::bigint,'can add again after deleting last exercise');
select * from finish();
rollback;
