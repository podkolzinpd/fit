begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

select has_index(
  'public',
  'workouts',
  'workouts_active_trainer_client_date_idx',
  'client workout pagination has a matching active range index'
);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password)
values
  ('71000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'workouts-a@example.test', ''),
  ('72000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'workouts-b@example.test', ''),
  ('73000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'workouts-client@example.test', '');
insert into public.profiles (id) values
  ('71000000-0000-4000-8000-000000000001'),
  ('72000000-0000-4000-8000-000000000002');
insert into public.trainers (profile_id) values
  ('71000000-0000-4000-8000-000000000001'),
  ('72000000-0000-4000-8000-000000000002');
insert into public.clients (id, trainer_id, auth_user_id, full_name, gender, age_years, height_cm) values
  ('7a000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', '73000000-0000-4000-8000-000000000003', 'Client A', 'female', 30, 170),
  ('7b000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000002', null, 'Client B', 'male', 31, 180);
insert into public.workouts (id, trainer_id, client_id, workout_date, start_time, status, started_at, completed_at, deleted_at) values
  ('7c000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', '7a000000-0000-4000-8000-000000000001', '2026-07-20', '10:00', 'done', '2026-07-20 10:00:00+00', '2026-07-20 11:00:00+00', null),
  ('7c000000-0000-4000-8000-000000000002', '71000000-0000-4000-8000-000000000001', '7a000000-0000-4000-8000-000000000001', '2026-07-22', null, 'planned', null, null, null),
  ('7c000000-0000-4000-8000-000000000003', '71000000-0000-4000-8000-000000000001', '7a000000-0000-4000-8000-000000000001', '2026-07-23', null, 'planned', null, null, '2026-07-23'),
  ('7d000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000002', '7b000000-0000-4000-8000-000000000001', '2026-07-21', '11:00', 'done', '2026-07-21 11:00:00+00', '2026-07-21 12:00:00+00', null);
insert into public.workout_exercises (id, workout_id, trainer_id, client_id, position, exercise_source, exercise_ref, exercise_name, muscle_group, input_kind) values
  ('7e000000-0000-4000-8000-000000000002', '7c000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', '7a000000-0000-4000-8000-000000000001', 1, 'system', 'press', 'Жим', 'chest', 'strength'),
  ('7e000000-0000-4000-8000-000000000001', '7c000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', '7a000000-0000-4000-8000-000000000001', 0, 'system', 'squat', 'Присед', 'legs', 'strength');
insert into public.workout_sets (id, workout_exercise_id, trainer_id, client_id, position, plan_weight_kg, plan_reps, fact_weight_kg, fact_reps, confirmed_at) values
  ('7f000000-0000-4000-8000-000000000002', '7e000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', '7a000000-0000-4000-8000-000000000001', 1, 45, 8, 45, 8, '2026-07-20 10:35:00+00'),
  ('7f000000-0000-4000-8000-000000000001', '7e000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', '7a000000-0000-4000-8000-000000000001', 0, 40, 10, 42.5, 10, '2026-07-20 10:30:00+00');

set local role anon;
select throws_ok(
  'select * from public.list_workouts(null, null, null)',
  '42501', null,
  'anon cannot execute list_workouts'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000001', true);
select is((select count(*) from public.list_workouts(null, null, null)), 2::bigint, 'deleted workouts are excluded');
select is((select count(*) from public.list_workouts('2026-07-21', null, null)), 1::bigint, 'from date is inclusive');
select is((select count(*) from public.list_workouts(null, '2026-07-20', null)), 1::bigint, 'to date is inclusive');
select is((select count(*) from public.list_workouts(null, null, '7b000000-0000-4000-8000-000000000001')), 0::bigint, 'client filter cannot cross tenants');
select is((select client_name from public.list_workouts(null, null, null) limit 1), 'Client A', 'client name is returned');
select is((select jsonb_array_length(exercises) from public.list_workouts(null, null, null) where id = '7c000000-0000-4000-8000-000000000001'), 2, 'exercises are aggregated');
select is((select jsonb_array_length(exercises->0->'sets') from public.list_workouts(null, null, null) where id = '7c000000-0000-4000-8000-000000000001'), 2, 'sets are aggregated');
select is((select (exercises->0->'sets'->0->>'fact_weight_kg')::numeric from public.list_workouts(null, null, null) where id = '7c000000-0000-4000-8000-000000000001'), 42.5::numeric, 'set facts are preserved');
select is((select string_agg(item->>'exercise_ref', ',' order by ordinal) from public.list_workouts(null, null, null), jsonb_array_elements(exercises) with ordinality as nested(item, ordinal) where id = '7c000000-0000-4000-8000-000000000001'), 'squat,press', 'exercises preserve position order');
select is((select string_agg(item->>'position', ',' order by ordinal) from public.list_workouts(null, null, null), jsonb_array_elements(exercises->0->'sets') with ordinality as nested(item, ordinal) where id = '7c000000-0000-4000-8000-000000000001'), '0,1', 'sets preserve position order');
select is((select count(*) from public.list_workouts(null, null, null, 1, 0)), 1::bigint, 'aggregate page size is bounded');
select is((select id from public.list_workouts(null, null, null, 1, 1)), '7c000000-0000-4000-8000-000000000002'::uuid, 'aggregate offset returns the next stable row');
select is((select total_count from public.list_workouts(null, null, null, 1, 0)), 2::bigint, 'page reports the complete filtered workout count');
select is((select count(*) from public.list_workout_summaries('7a000000-0000-4000-8000-000000000001')), 2::bigint, 'summary RPC returns active workouts without nested aggregates');
select is((select count(*) from public.list_workout_summaries('7b000000-0000-4000-8000-000000000001')), 0::bigint, 'summary RPC cannot cross tenants');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '73000000-0000-4000-8000-000000000003', true);
select throws_ok(
  'select * from public.list_workouts(null, null, null)',
  'P0001', 'trainer_not_initialized',
  'linked client cannot call trainer list RPC'
);
reset role;

select * from finish();
rollback;
