begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

select has_table('public', 'profiles', 'profiles exists');
select has_table('public', 'trainers', 'trainers exists');
select has_table('public', 'clients', 'clients exists');
select has_table('public', 'custom_exercises', 'custom_exercises exists');
select has_table('public', 'workouts', 'workouts exists');
select has_table('public', 'workout_exercises', 'workout_exercises exists');
select has_table('public', 'workout_sets', 'workout_sets exists');
select has_table('public', 'client_progress', 'client_progress exists');
select has_table('public', 'client_custom_metrics', 'client_custom_metrics exists');
select has_pk('public', 'clients', 'clients has pk');
select col_type_is('public', 'clients', 'id', 'uuid', 'client id is uuid');
select col_type_is('public', 'workouts', 'id', 'uuid', 'workout id is uuid');
select col_type_is('public', 'client_progress', 'id', 'uuid', 'progress id is uuid');
select has_function('public', 'initialize_trainer', array['text', 'text', 'text'], 'initialize RPC exists');
select has_function('public', 'save_workout', array['jsonb', 'bigint'], 'workout RPC exists');
select has_function('public', 'start_workout', array['uuid', 'bigint'], 'start RPC exists');
select has_function('public', 'save_live_set_draft', array['uuid', 'jsonb', 'bigint'], 'live draft RPC exists');
select has_function('public', 'confirm_live_set', array['uuid', 'bigint'], 'confirm RPC exists');
select has_function('public', 'finish_workout', array['uuid', 'bigint'], 'finish RPC exists');
select has_function('public', 'save_progress', array['jsonb', 'bigint'], 'progress RPC exists');

select * from finish();
rollback;
