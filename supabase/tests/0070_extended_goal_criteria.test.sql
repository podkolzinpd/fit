begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

insert into auth.users(id,instance_id,aud,role,email,encrypted_password) values('e1000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','progress-13@example.test','');
insert into public.profiles(id,account_role,first_name) values('e1000000-0000-4000-8000-000000000001','trainer','Тренер');
insert into public.trainers(profile_id) values('e1000000-0000-4000-8000-000000000001');
set local role authenticated;
select set_config('request.jwt.claim.sub','e1000000-0000-4000-8000-000000000001',true);
select public.create_client(jsonb_build_object('fullName','Клиент Progress 1.3','gender','female','ageYears',30,'ageUpdatedAt',current_date,'heightCm',170)) as client_id \gset
reset role;
insert into public.custom_exercises(id,trainer_id,name,muscle_group,input_kind) values('e1100000-0000-4000-8000-000000000011','e1000000-0000-4000-8000-000000000001','Особый бег','cardio','distance');
insert into public.client_custom_metrics(id,trainer_id,client_id,name,unit) values('e1200000-0000-4000-8000-000000000012','e1000000-0000-4000-8000-000000000001',:'client_id','Сон','ч');

set local role authenticated;
select set_config('request.jwt.claim.sub','e1000000-0000-4000-8000-000000000001',true);
select public.save_client_goal(jsonb_build_object('clientId',:'client_id','title','Бежать быстрее, тренироваться и спать',
  'criteria',jsonb_build_array(
    jsonb_build_object('metric','cardio_distance_time','operation','increase_to','targetValue',5,'unit','км','secondaryTargetValue',30,'secondaryUnit','мин','exerciseSource','system','exerciseRef','running','exerciseName','Бег','confirmationStatus','confirmed','position',0),
    jsonb_build_object('metric','workout_regularity','operation','increase_to','targetValue',3,'unit','трен.','regularityPeriod','week','regularityMode','each_period','confirmationStatus','confirmed','position',1),
    jsonb_build_object('metric','custom','operation','increase_to','targetValue',8,'unit','ч','customMetricId','e1200000-0000-4000-8000-000000000012','customMetricName','Сон','confirmationStatus','confirmed','position',2)
  ))) as goal_id \gset

select is(jsonb_array_length(public.get_client_goal(:'client_id')->'criteria'),3,'composite goal stores all confirmed criteria');
select is(public.get_client_goal(:'client_id')->'criteria'->0->>'exerciseRef','running','system exercise snapshot is returned');
select is((public.get_client_goal(:'client_id')->'criteria'->0->>'secondaryTargetValue')::numeric,30::numeric,'linked cardio time is returned');
select is(public.get_client_goal(:'client_id')->'criteria'->1->>'regularityMode','each_period','strict regularity mode is returned');
select is(public.get_client_goal(:'client_id')->'criteria'->2->>'customMetricName','Сон','custom metric snapshot is returned');

select public.save_client_goal(jsonb_build_object('clientId',:'client_id','id',:'goal_id','title','Новая формулировка'),1);
select is((select count(*)::integer from public.goal_criteria where goal_id=:'goal_id' and confirmation_status='needs_review'),3,'title-only edit marks every criterion for review');

select jsonb_agg(jsonb_build_object('id',id,'version',version,'metric',metric,'operation',operation,'targetValue',target_value,'rangeMin',range_min,'rangeMax',range_max,'unit',unit,'secondaryTargetValue',secondary_target_value,'secondaryUnit',secondary_unit,'exerciseSource',exercise_source,'exerciseRef',exercise_ref,'exerciseName',exercise_name,'customExerciseId',custom_exercise_id,'customMetricId',custom_metric_id,'customMetricName',custom_metric_name,'regularityPeriod',regularity_period,'regularityMode',regularity_mode,'confirmationStatus','confirmed','position',position) order by position) as confirmed_criteria from public.goal_criteria where goal_id=:'goal_id' and archived_at is null \gset
select public.save_client_goal(jsonb_build_object('clientId',:'client_id','id',:'goal_id','title','Новая формулировка','criteria',:'confirmed_criteria'::jsonb),2);
select is((select count(*)::integer from public.goal_criteria where goal_id=:'goal_id' and confirmation_status='confirmed'),3,'all criteria can be explicitly reconfirmed atomically');

select jsonb_build_object('id',id,'version',version,'metric',metric,'operation',operation,'targetValue',target_value,'rangeMin',range_min,'rangeMax',range_max,'unit',unit,'secondaryTargetValue',secondary_target_value,'secondaryUnit',secondary_unit,'exerciseSource',exercise_source,'exerciseRef',exercise_ref,'exerciseName',exercise_name,'customExerciseId',custom_exercise_id,'customMetricId',custom_metric_id,'customMetricName',custom_metric_name,'regularityPeriod',regularity_period,'regularityMode',regularity_mode,'confirmationStatus','confirmed','position',0) as first_criterion from public.goal_criteria where goal_id=:'goal_id' and archived_at is null order by position limit 1 \gset
select public.save_client_goal(jsonb_build_object('clientId',:'client_id','id',:'goal_id','title','Новая формулировка','criteria',jsonb_build_array(:'first_criterion'::jsonb)),3);
select is(jsonb_array_length(public.get_client_goal(:'client_id')->'criteria'),1,'replacing a composite goal archives omitted criteria');
select is((select count(*)::integer from public.goal_criteria where goal_id=:'goal_id' and archived_at is not null),2,'omitted criteria remain in history');

select throws_ok(format($$select public.save_client_goal(jsonb_build_object('clientId',%L,'id',%L,'title','Ошибка','criteria',jsonb_build_array(jsonb_build_object('metric','cardio_distance','operation','increase_to','targetValue',5,'unit','км','exerciseSource','system','exerciseRef','unknown','exerciseName','','confirmationStatus','confirmed','position',0))),4)$$,:'client_id',:'goal_id'),'PT422',null,'blank or unresolved exercise is rejected');
select throws_ok(format($$select public.save_client_goal(jsonb_build_object('clientId',%L,'id',%L,'title','Ошибка','criteria',jsonb_build_array(jsonb_build_object('metric','workout_regularity','operation','increase_to','targetValue',2.5,'unit','трен.','regularityPeriod','week','regularityMode','average','confirmationStatus','confirmed','position',0))),4)$$,:'client_id',:'goal_id'),'PT422',null,'regularity target must be an integer');
select throws_ok(format($$select public.save_client_goal(jsonb_build_object('clientId',%L,'id',%L,'title','Ошибка','criteria',jsonb_build_array(jsonb_build_object('metric','cardio_distance_time','operation','increase_to','targetValue',5,'unit','км','secondaryTargetValue',30,'secondaryUnit','мин','exerciseSource','custom','exerciseRef','e1100000-0000-4000-8000-000000000011','exerciseName','Особый бег','customExerciseId','e1100000-0000-4000-8000-000000000099','confirmationStatus','confirmed','position',0))),4)$$,:'client_id',:'goal_id'),'PT422',null,'custom exercise must exist in the same trainer partition');

select * from finish();
rollback;
