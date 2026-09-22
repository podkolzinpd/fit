begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password) values
  ('50000000-0000-4000-8000-000000000120', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'client-program@example.test', ''),
  ('50000000-0000-4000-8000-000000000121', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'other-client-program@example.test', ''),
  ('50000000-0000-4000-8000-000000000122', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'trainer-client-program@example.test', '');
insert into public.profiles (id, account_role) values
  ('50000000-0000-4000-8000-000000000120', 'client'),
  ('50000000-0000-4000-8000-000000000121', 'client'),
  ('50000000-0000-4000-8000-000000000122', 'trainer');
insert into public.trainers (profile_id) values ('50000000-0000-4000-8000-000000000122');
insert into public.clients (id, trainer_id, auth_user_id, full_name, gender, age_years, height_cm) values
  ('c0000000-0000-4000-8000-000000000120', '50000000-0000-4000-8000-000000000122', '50000000-0000-4000-8000-000000000120', 'Client Program', 'female', 30, 170),
  ('c0000000-0000-4000-8000-000000000121', '50000000-0000-4000-8000-000000000122', '50000000-0000-4000-8000-000000000121', 'Other Client Program', 'male', 31, 180);

insert into public.assistant_conversations (id, owner_id, title)
values ('a0000000-0000-4000-8000-000000000120', '50000000-0000-4000-8000-000000000120', 'Client program');
insert into public.assistant_messages (id, conversation_id, turn_id, author, content) values
  ('b0000000-0000-4000-8000-000000000120', 'a0000000-0000-4000-8000-000000000120', 'd0000000-0000-4000-8000-000000000120', 'assistant', 'Program'),
  ('b0000000-0000-4000-8000-000000000121', 'a0000000-0000-4000-8000-000000000120', 'd0000000-0000-4000-8000-000000000121', 'assistant', 'Foreign program'),
  ('b0000000-0000-4000-8000-000000000122', 'a0000000-0000-4000-8000-000000000120', 'd0000000-0000-4000-8000-000000000122', 'assistant', 'Legacy program'),
  ('b0000000-0000-4000-8000-000000000123', 'a0000000-0000-4000-8000-000000000120', 'd0000000-0000-4000-8000-000000000123', 'assistant', 'Cancel program');

create temporary table client_program_fixture(workouts jsonb);
insert into client_program_fixture
select jsonb_agg(jsonb_build_object(
  'requestId', gen_random_uuid(),
  'clientId', 'c0000000-0000-4000-8000-000000000120',
  'workoutDate', (current_date + day_offset)::text,
  'notes', 'Client recommendation',
  'exercises', jsonb_build_array(jsonb_build_object(
    'position', 0, 'source', 'system', 'ref', 'goblet-squat', 'name', 'Приседания с гантелью',
    'muscleGroup', 'legs', 'inputKind', 'strength', 'blockId', gen_random_uuid(),
    'blockType', 'single', 'blockRounds', 1, 'restBetweenSetsSec', 90,
    'sets', jsonb_build_array(jsonb_build_object('position', 0, 'reps', 8, 'rpe', 6.5))
  ))
)) from (values (1), (4), (8), (11)) as day_offsets(day_offset);

insert into public.assistant_actions (id, owner_id, conversation_id, assistant_message_id, tool, payload)
select 'e0000000-0000-4000-8000-000000000120', '50000000-0000-4000-8000-000000000120',
  'a0000000-0000-4000-8000-000000000120', 'b0000000-0000-4000-8000-000000000120', 'create_program_draft',
  jsonb_build_object('schemaVersion', 'program-v1', 'clientId', 'c0000000-0000-4000-8000-000000000120',
    'sourceCapturedAt', now(), 'canonicalWorkouts', workouts)
from client_program_fixture;
insert into public.assistant_actions (id, owner_id, conversation_id, assistant_message_id, tool, payload) values
  ('e0000000-0000-4000-8000-000000000121', '50000000-0000-4000-8000-000000000120', 'a0000000-0000-4000-8000-000000000120', 'b0000000-0000-4000-8000-000000000121', 'create_program_draft', '{"schemaVersion":"program-v1","clientId":"c0000000-0000-4000-8000-000000000121"}'),
  ('e0000000-0000-4000-8000-000000000122', '50000000-0000-4000-8000-000000000120', 'a0000000-0000-4000-8000-000000000120', 'b0000000-0000-4000-8000-000000000122', 'create_program_draft', '{"clientId":"c0000000-0000-4000-8000-000000000120"}'),
  ('e0000000-0000-4000-8000-000000000123', '50000000-0000-4000-8000-000000000120', 'a0000000-0000-4000-8000-000000000120', 'b0000000-0000-4000-8000-000000000123', 'create_program_draft', '{"schemaVersion":"program-v1","clientId":"c0000000-0000-4000-8000-000000000120"}');

grant select on client_program_fixture to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub', '50000000-0000-4000-8000-000000000120', true);
select is(
  public.apply_assistant_action(
    'e0000000-0000-4000-8000-000000000120',
    jsonb_build_object('workouts', (select workouts from client_program_fixture)),
    1
  )->>'status',
  'applied', 'client applies own validated program'
);
select is((select count(*) from public.workouts where notes = 'Client recommendation'), 4::bigint, 'client program creates four planned workouts');
select is((select count(*) from public.workouts where notes = 'Client recommendation' and created_by = '50000000-0000-4000-8000-000000000120'), 4::bigint, 'client remains the program author');
select is((select count(*) from public.workouts where notes = 'Client recommendation' and origin = 'ai'), 4::bigint, 'assistant-generated program workouts are marked origin=ai');
select is(public.apply_assistant_action('e0000000-0000-4000-8000-000000000120', '{}'::jsonb, 2)->>'status', 'applied', 'client program retry is idempotent');
select is((select count(*) from public.workouts where notes = 'Client recommendation'), 4::bigint, 'client program retry creates no duplicates');
select throws_ok(
  $$select public.apply_assistant_action('e0000000-0000-4000-8000-000000000121', '{}'::jsonb, 1)$$,
  'PT403', null, 'client program cannot target another client card');
select throws_ok(
  $$select public.apply_assistant_action('e0000000-0000-4000-8000-000000000122', '{}'::jsonb, 1)$$,
  'PT403', null, 'client cannot apply an unvalidated legacy program');
select is(public.cancel_assistant_action('e0000000-0000-4000-8000-000000000123', 1)->>'status', 'cancelled', 'client cancels own program action');

reset role;
select * from finish();
rollback;
