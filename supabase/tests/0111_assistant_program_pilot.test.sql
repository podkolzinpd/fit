begin;
create extension if not exists pgtap with schema extensions;
select plan(15);
insert into auth.users (id, instance_id, aud, role, email, encrypted_password) values
  ('50000000-0000-4000-8000-000000000057', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'assistant-a@example.test', ''),
  ('50000000-0000-0000-0000-000000000058', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'assistant-b@example.test', ''),
  ('50000000-0000-0000-0000-000000000059', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'assistant-client@example.test', '');
insert into public.profiles (id, account_role) values
  ('50000000-0000-4000-8000-000000000057', 'trainer'),
  ('50000000-0000-0000-0000-000000000058', 'trainer'),
  ('50000000-0000-0000-0000-000000000059', 'client');
insert into public.trainers (profile_id) values
  ('50000000-0000-4000-8000-000000000057'),
  ('50000000-0000-0000-0000-000000000058');
insert into public.clients (id, trainer_id, full_name, gender, age_years, height_cm) values
  ('c0000000-0000-4000-8000-000000000057', '50000000-0000-4000-8000-000000000057', 'Assistant A', 'male', 30, 180);
insert into public.assistant_conversations (id, owner_id, title)
values ('a0000000-0000-4000-8000-000000000057', '50000000-0000-4000-8000-000000000057', 'Assistant test');

create temporary table pilot_cases(n int, action_id uuid, message_id uuid, workouts jsonb);
insert into pilot_cases
select n, gen_random_uuid(), gen_random_uuid(), (
  select jsonb_agg(jsonb_build_object(
    'requestId', gen_random_uuid(), 'clientId', 'c0000000-0000-4000-8000-000000000057',
    'workoutDate', (current_date + i)::text, 'notes', 'Pilot ' || n,
    'exercises', jsonb_build_array(jsonb_build_object(
      'position',0,'source','system','ref','bench-press','name','Жим лёжа','muscleGroup','chest','inputKind','strength',
      'blockId',gen_random_uuid(),'blockType','single','blockRounds',1,'restBetweenSetsSec',90,
      'sets',jsonb_build_array(jsonb_build_object('position',0,'reps',8,'rpe',6.5))
    ))
  )) from generate_series(1,n) i
) from (values (4),(8),(12)) sizes(n);
insert into public.assistant_messages(id,conversation_id,turn_id,author,content)
select message_id,'a0000000-0000-4000-8000-000000000057',gen_random_uuid(),'assistant','Program' from pilot_cases;
insert into public.assistant_actions(id,owner_id,conversation_id,assistant_message_id,tool,payload)
select action_id,'50000000-0000-4000-8000-000000000057','a0000000-0000-4000-8000-000000000057',message_id,'create_program_draft',
 jsonb_build_object('schemaVersion','program-v1','clientId','c0000000-0000-4000-8000-000000000057','sourceCapturedAt',now(),'canonicalWorkouts',workouts) from pilot_cases;
grant select on pilot_cases to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub','50000000-0000-4000-8000-000000000057',true);
select is(public.apply_assistant_action(action_id, jsonb_build_object('workouts', jsonb_set(workouts,'{0,workoutDate}','"2099-01-01"')),1)->>'status','failed','Reject browser tampering ' || n) from pilot_cases order by n;
select is((select count(*) from public.workouts),0::bigint,'Tampering saves nothing');
select is(public.apply_assistant_action(action_id,jsonb_build_object('workouts',workouts),1)->>'status','applied','Save all ' || n) from pilot_cases order by n;
select is((select count(*) from public.workouts where notes='Pilot ' || n),n::bigint,'Correct count ' || n) from pilot_cases order by n;
select is(public.apply_assistant_action(action_id,jsonb_build_object('workouts',workouts),1)->>'status','applied','Idempotent retry ' || n) from pilot_cases order by n;
select is((select count(*) from public.workouts),24::bigint,'No duplicate workouts on retry');
select is((select count(*) from public.workout_sets where plan_rpe=6.5),24::bigint,'Prescriptions survive persistence');
reset role;
select * from finish();
rollback;
