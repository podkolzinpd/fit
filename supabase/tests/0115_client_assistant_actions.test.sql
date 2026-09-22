begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password) values
  ('50000000-0000-4000-8000-000000000115', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'client-assistant@example.test', ''),
  ('50000000-0000-4000-8000-000000000116', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'other-client-assistant@example.test', ''),
  ('50000000-0000-4000-8000-000000000117', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'trainer-client-assistant@example.test', '');
insert into public.profiles (id, account_role) values
  ('50000000-0000-4000-8000-000000000115', 'client'),
  ('50000000-0000-4000-8000-000000000116', 'client'),
  ('50000000-0000-4000-8000-000000000117', 'trainer');
insert into public.trainers (profile_id) values ('50000000-0000-4000-8000-000000000117');
insert into public.clients (id, trainer_id, auth_user_id, full_name, gender, age_years, height_cm) values
  ('c0000000-0000-4000-8000-000000000115', '50000000-0000-4000-8000-000000000117', '50000000-0000-4000-8000-000000000115', 'Client Assistant', 'female', 30, 170),
  ('c0000000-0000-4000-8000-000000000116', '50000000-0000-4000-8000-000000000117', '50000000-0000-4000-8000-000000000116', 'Other Client', 'male', 31, 180);

insert into public.assistant_conversations (id, owner_id, title) values
  ('a0000000-0000-4000-8000-000000000115', '50000000-0000-4000-8000-000000000115', 'Client assistant'),
  ('a0000000-0000-4000-8000-000000000116', '50000000-0000-4000-8000-000000000116', 'Other assistant');
insert into public.assistant_messages (id, conversation_id, turn_id, author, content) values
  ('b0000000-0000-4000-8000-000000000115', 'a0000000-0000-4000-8000-000000000115', 'd0000000-0000-4000-8000-000000000115', 'assistant', 'Workout'),
  ('b0000000-0000-4000-8000-000000000116', 'a0000000-0000-4000-8000-000000000115', 'd0000000-0000-4000-8000-000000000116', 'assistant', 'Mismatch'),
  ('b0000000-0000-4000-8000-000000000117', 'a0000000-0000-4000-8000-000000000115', 'd0000000-0000-4000-8000-000000000117', 'assistant', 'Program'),
  ('b0000000-0000-4000-8000-000000000118', 'a0000000-0000-4000-8000-000000000115', 'd0000000-0000-4000-8000-000000000118', 'assistant', 'Cancel'),
  ('b0000000-0000-4000-8000-000000000119', 'a0000000-0000-4000-8000-000000000116', 'd0000000-0000-4000-8000-000000000119', 'assistant', 'Foreign');
insert into public.assistant_actions (id, owner_id, conversation_id, assistant_message_id, tool, payload) values
  ('e0000000-0000-4000-8000-000000000115', '50000000-0000-4000-8000-000000000115', 'a0000000-0000-4000-8000-000000000115', 'b0000000-0000-4000-8000-000000000115', 'record_workout', '{"step":"confirm","clientId":"c0000000-0000-4000-8000-000000000115"}'),
  ('e0000000-0000-4000-8000-000000000116', '50000000-0000-4000-8000-000000000115', 'a0000000-0000-4000-8000-000000000115', 'b0000000-0000-4000-8000-000000000116', 'record_workout', '{"step":"confirm","clientId":"c0000000-0000-4000-8000-000000000116"}'),
  ('e0000000-0000-4000-8000-000000000117', '50000000-0000-4000-8000-000000000115', 'a0000000-0000-4000-8000-000000000115', 'b0000000-0000-4000-8000-000000000117', 'create_program_draft', '{"step":"confirm","clientId":"c0000000-0000-4000-8000-000000000115"}'),
  ('e0000000-0000-4000-8000-000000000118', '50000000-0000-4000-8000-000000000115', 'a0000000-0000-4000-8000-000000000115', 'b0000000-0000-4000-8000-000000000118', 'record_workout', '{"step":"confirm","clientId":"c0000000-0000-4000-8000-000000000115"}'),
  ('e0000000-0000-4000-8000-000000000119', '50000000-0000-4000-8000-000000000116', 'a0000000-0000-4000-8000-000000000116', 'b0000000-0000-4000-8000-000000000119', 'record_workout', '{"step":"confirm","clientId":"c0000000-0000-4000-8000-000000000116"}');

set local role authenticated;
select set_config('request.jwt.claim.sub', '50000000-0000-4000-8000-000000000115', true);
select is(
  public.apply_assistant_action(
    'e0000000-0000-4000-8000-000000000115',
    jsonb_build_object('workout', jsonb_build_object(
      'requestId', 'f0000000-0000-4000-8000-000000000115',
      'clientId', 'c0000000-0000-4000-8000-000000000115',
      'workoutDate', '2026-09-17',
      'exercises', jsonb_build_array(jsonb_build_object(
        'position', 0, 'source', 'system', 'ref', 'bench-press', 'name', 'Жим лёжа',
        'muscleGroup', 'chest', 'inputKind', 'strength',
        'blockId', '10000000-0000-4000-8000-000000000115', 'blockType', 'single', 'blockRounds', 1,
        'sets', jsonb_build_array(jsonb_build_object('position', 0, 'reps', 10, 'weightKg', 60))
      ))
    )), 1
  )->>'status',
  'applied', 'client applies own workout action'
);
select is((select count(*) from public.workouts where client_id = 'c0000000-0000-4000-8000-000000000115'), 1::bigint, 'client assistant creates one workout');
select is((select created_by::text from public.workouts where client_id = 'c0000000-0000-4000-8000-000000000115'), '50000000-0000-4000-8000-000000000115', 'client remains the workout author');
select is((select origin from public.workouts where client_id = 'c0000000-0000-4000-8000-000000000115'), 'manual', 'record_workout dictates an already-done workout, not an AI-authored plan - origin stays manual');
select is(public.apply_assistant_action('e0000000-0000-4000-8000-000000000115', '{}'::jsonb, 2)->>'status', 'applied', 'client retry is idempotent');
select is((select count(*) from public.workouts where client_id = 'c0000000-0000-4000-8000-000000000115'), 1::bigint, 'client retry creates no duplicate');
select throws_ok(
  $$select public.apply_assistant_action('e0000000-0000-4000-8000-000000000119', '{}'::jsonb, 1)$$,
  'PT404', null, 'client cannot apply another client action');
select throws_ok(
  $$select public.apply_assistant_action('e0000000-0000-4000-8000-000000000116', '{}'::jsonb, 1)$$,
  'PT403', null, 'client action cannot target another client card');
select throws_ok(
  $$select public.apply_assistant_action('e0000000-0000-4000-8000-000000000117', '{}'::jsonb, 1)$$,
  'PT403', null, 'client cannot apply an unvalidated legacy program');
select is(public.cancel_assistant_action('e0000000-0000-4000-8000-000000000118', 1)->>'status', 'cancelled', 'client cancels own workout action');

reset role;
select * from finish();
rollback;
