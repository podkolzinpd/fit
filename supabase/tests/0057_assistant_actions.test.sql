begin;
create extension if not exists pgtap with schema extensions;
select plan(28);

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
insert into public.assistant_messages (id, conversation_id, turn_id, author, content, action)
values ('b0000000-0000-4000-8000-000000000057', 'a0000000-0000-4000-8000-000000000057', 'd0000000-0000-4000-8000-000000000057', 'assistant', 'Программа готова', '{"id":"e0000000-0000-4000-8000-000000000057","tool":"create_program_draft","status":"proposed","title":"Программа","description":"Черновик","payload":{"step":"confirm","clientId":"c0000000-0000-4000-8000-000000000057"}}'::jsonb);
set local role postgres;
insert into public.assistant_actions (id, owner_id, conversation_id, assistant_message_id, tool, payload)
values ('e0000000-0000-4000-8000-000000000057', '50000000-0000-4000-8000-000000000057', 'a0000000-0000-4000-8000-000000000057', 'b0000000-0000-4000-8000-000000000057', 'create_program_draft', '{"step":"confirm","clientId":"c0000000-0000-4000-8000-000000000057"}');
insert into public.assistant_messages (id, conversation_id, turn_id, author, content, action) values
  ('b0000000-0000-4000-8000-000000000058', 'a0000000-0000-4000-8000-000000000057', 'd0000000-0000-4000-8000-000000000058', 'assistant', 'Программа A', null),
  ('b0000000-0000-4000-8000-000000000059', 'a0000000-0000-4000-8000-000000000057', 'd0000000-0000-4000-8000-000000000059', 'assistant', 'Программа B', null),
  ('b0000000-0000-4000-8000-000000000060', 'a0000000-0000-4000-8000-000000000057', 'd0000000-0000-4000-8000-000000000060', 'assistant', 'Запись', null);
insert into public.assistant_actions (id, owner_id, conversation_id, assistant_message_id, tool, payload) values
  ('e0000000-0000-4000-8000-000000000058', '50000000-0000-4000-8000-000000000057', 'a0000000-0000-4000-8000-000000000057', 'b0000000-0000-4000-8000-000000000058', 'create_program_draft', '{"step":"confirm","clientId":"c0000000-0000-4000-8000-000000000057"}'),
  ('e0000000-0000-4000-8000-000000000059', '50000000-0000-4000-8000-000000000057', 'a0000000-0000-4000-8000-000000000057', 'b0000000-0000-4000-8000-000000000059', 'create_program_draft', '{"step":"confirm","clientId":"c0000000-0000-4000-8000-000000000057"}'),
  ('e0000000-0000-4000-8000-000000000060', '50000000-0000-4000-8000-000000000057', 'a0000000-0000-4000-8000-000000000057', 'b0000000-0000-4000-8000-000000000060', 'record_workout', '{"step":"confirm","clientId":"c0000000-0000-4000-8000-000000000057"}');
reset role;

select has_table('public', 'assistant_actions', 'assistant actions table exists');
select has_function('public', 'persist_assistant_response', array['uuid', 'uuid', 'text', 'jsonb'], 'assistant response persistence RPC exists');
select has_function('public', 'apply_assistant_action', array['uuid', 'jsonb', 'bigint'], 'assistant apply RPC exists');
select has_function('public', 'complete_assistant_summary', array['uuid', 'bigint'], 'summary completion RPC exists');
select has_function('public', 'cancel_assistant_action', array['uuid', 'bigint'], 'cancel RPC exists');
select is(has_table_privilege('anon', 'public.assistant_actions', 'SELECT'), false, 'anon cannot read assistant actions');
select is(has_table_privilege('authenticated', 'public.assistant_actions', 'INSERT'), false, 'authenticated cannot insert assistant actions directly');
select is(has_table_privilege('service_role', 'public.assistant_messages', 'SELECT'), true, 'backend can read assistant history');
select is(has_table_privilege('service_role', 'public.assistant_messages', 'INSERT'), true, 'backend can append assistant history');
set local role service_role;
select public.persist_assistant_response('a0000000-0000-4000-8000-000000000057'::uuid, 'd0000000-0000-4000-8000-000000000061'::uuid, 'Один ответ', null);
select is((public.persist_assistant_response('a0000000-0000-4000-8000-000000000057'::uuid, 'd0000000-0000-4000-8000-000000000061'::uuid, 'Другой ответ', null)->>'deduplicated'), 'true', 'same turn RPC returns the stored response');
select is((select count(*) from public.assistant_messages where turn_id = 'd0000000-0000-4000-8000-000000000061'), 1::bigint, 'same turn persists one assistant message');
select is((select content from public.assistant_messages where turn_id = 'd0000000-0000-4000-8000-000000000061'), 'Один ответ', 'same turn retry keeps original assistant result');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '50000000-0000-0000-0000-000000000058', true);
select is((select count(*) from public.assistant_actions), 0::bigint, 'foreign trainer cannot read actions');
select throws_ok(
  $$select public.apply_assistant_action('e0000000-0000-4000-8000-000000000057'::uuid, '{}'::jsonb, 1)$$,
  'PT404', null, 'foreign trainer cannot apply action');

select set_config('request.jwt.claim.sub', '50000000-0000-4000-8000-000000000057', true);
select is((select count(*) from public.assistant_actions), 4::bigint, 'owner can read own actions');
select is(
  public.apply_assistant_action('e0000000-0000-4000-8000-000000000058'::uuid, jsonb_build_object('workouts', jsonb_build_array(jsonb_build_object('requestId','f0000000-0000-4000-8000-000000000058','clientId','c0000000-0000-4000-8000-000000000057','workoutDate','2026-08-25','notes','Program A','exercises',jsonb_build_array(jsonb_build_object('position',0,'source','system','ref','bench-press','name','Жим лёжа','muscleGroup','chest','inputKind','strength','blockId','10000000-0000-4000-8000-000000000058','blockType','single','blockRounds',1,'sets',jsonb_build_array(jsonb_build_object('position',0,'reps',8,'weightKg',20))))))), 1)->>'status',
  'applied', 'program apply succeeds');
select is((select count(*) from public.workouts where notes = 'Program A'), 1::bigint, 'program creates one workout');
select is(public.apply_assistant_action('e0000000-0000-4000-8000-000000000058'::uuid, '{}'::jsonb, 2)->>'status', 'applied', 'same program action retry returns applied');
select is((select count(*) from public.workouts where notes = 'Program A'), 1::bigint, 'same program action retry creates no duplicate');
select is(
  public.apply_assistant_action('e0000000-0000-4000-8000-000000000059'::uuid, jsonb_build_object('workouts', jsonb_build_array(jsonb_build_object('requestId','f0000000-0000-4000-8000-000000000059','clientId','c0000000-0000-4000-8000-000000000057','workoutDate','2026-08-25','notes','Program B','exercises',jsonb_build_array(jsonb_build_object('position',0,'source','system','ref','bench-press','name','Жим лёжа','muscleGroup','chest','inputKind','strength','blockId','10000000-0000-4000-8000-000000000059','blockType','single','blockRounds',1,'sets',jsonb_build_array(jsonb_build_object('position',0,'reps',8))))), jsonb_build_object('requestId','f0000000-0000-4000-8000-000000000060','clientId','c0000000-0000-4000-8000-000000000999','workoutDate','2026-08-25','notes','Program B','exercises',jsonb_build_array(jsonb_build_object('position',0))))), 1)->>'status',
  'failed', 'invalid second program child fails whole apply');
select is((select count(*) from public.workouts where notes = 'Program B'), 0::bigint, 'invalid second child rolls back first child');
select is(
  public.apply_assistant_action(
    'e0000000-0000-4000-8000-000000000060'::uuid,
    jsonb_build_object(
      'workout', jsonb_build_object(
        'requestId', 'f0000000-0000-4000-8000-000000000060',
        'clientId', 'c0000000-0000-4000-8000-000000000057',
        'workoutDate', '2026-08-25',
        'exercises', jsonb_build_array(jsonb_build_object(
          'position', 0,
          'source', 'system',
          'ref', 'bench-press',
          'name', 'Жим лёжа',
          'muscleGroup', 'chest',
          'inputKind', 'strength',
          'blockId', '10000000-0000-4000-8000-000000000060',
          'blockType', 'single',
          'blockRounds', 1,
          'sets', jsonb_build_array(jsonb_build_object('position', 0, 'reps', 8))
        ))
      )
    ),
    1
  )->>'status',
  'applied',
  'record workout apply succeeds'
);
select is(public.apply_assistant_action('e0000000-0000-4000-8000-000000000060'::uuid, '{}'::jsonb, 2)->>'status', 'applied', 'record workout retry returns applied');
select is((select count(*) from public.workouts where id = (select (result->>'workoutId')::uuid from public.assistant_actions where id = 'e0000000-0000-4000-8000-000000000060')), 1::bigint, 'record workout retry creates no duplicate');
select is(public.cancel_assistant_action('e0000000-0000-4000-8000-000000000057'::uuid, 1)->>'status', 'cancelled', 'owner can cancel proposed action');
select is(public.cancel_assistant_action('e0000000-0000-4000-8000-000000000057'::uuid, 2)->>'status', 'cancelled', 'cancel is idempotent');
select throws_ok(
  $$select public.apply_assistant_action('e0000000-0000-4000-8000-000000000057'::uuid, '{}'::jsonb, 2)$$,
  'PT409', null, 'cancelled action cannot be applied');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '50000000-0000-0000-0000-000000000059', true);
select throws_ok(
  $$select public.apply_assistant_action('e0000000-0000-4000-8000-000000000058'::uuid, '{}'::jsonb, 2)$$,
  'PT403', null, 'client cannot invoke trainer assistant action');
reset role;
select * from finish();
rollback;
