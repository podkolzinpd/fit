begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

select is(
  (select count(*) from pg_proc procedure join pg_namespace namespace on namespace.oid = procedure.pronamespace where namespace.nspname = 'public' and procedure.proname like 'legacy_%'),
  0::bigint,
  'legacy mutation functions are not exposed in public schema'
);
select is(
  (select count(*) from pg_proc procedure join pg_namespace namespace on namespace.oid = procedure.pronamespace where namespace.nspname = 'private' and procedure.proname like 'legacy_%'),
  17::bigint,
  'all legacy mutation functions live in private schema'
);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password) values
  ('91000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'shared-root@example.test', ''),
  ('92000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'shared-member@example.test', ''),
  ('93000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'shared-owner@example.test', ''),
  ('94000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'shared-stranger@example.test', '');
insert into public.profiles (id, account_role) values
  ('91000000-0000-4000-8000-000000000001', 'trainer'),
  ('92000000-0000-4000-8000-000000000002', 'trainer'),
  ('93000000-0000-4000-8000-000000000003', 'client'),
  ('94000000-0000-4000-8000-000000000004', 'client');
insert into public.trainers (profile_id) values
  ('91000000-0000-4000-8000-000000000001'),
  ('92000000-0000-4000-8000-000000000002');
insert into public.clients (id, trainer_id, auth_user_id, full_name, gender, age_years, height_cm)
values ('95000000-0000-4000-8000-000000000005', '91000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000003', 'Shared client', 'female', 30, 170);
insert into public.client_trainers (client_id, trainer_id) values
  ('95000000-0000-4000-8000-000000000005', '91000000-0000-4000-8000-000000000001'),
  ('95000000-0000-4000-8000-000000000005', '92000000-0000-4000-8000-000000000002');
insert into public.workouts (id, trainer_id, client_id, workout_date)
values ('96000000-0000-4000-8000-000000000006', '91000000-0000-4000-8000-000000000001', '95000000-0000-4000-8000-000000000005', '2026-07-27');
insert into public.workout_exercises (
  id, workout_id, trainer_id, client_id, position, exercise_source, exercise_ref,
  exercise_name, muscle_group, input_kind
) values (
  '97000000-0000-4000-8000-000000000007', '96000000-0000-4000-8000-000000000006',
  '91000000-0000-4000-8000-000000000001', '95000000-0000-4000-8000-000000000005',
  0, 'system', 'squat', 'Присед', 'legs', 'strength'
);
insert into public.workout_sets (
  id, workout_exercise_id, trainer_id, client_id, position, plan_weight_kg, plan_reps
) values (
  '98000000-0000-4000-8000-000000000008', '97000000-0000-4000-8000-000000000007',
  '91000000-0000-4000-8000-000000000001', '95000000-0000-4000-8000-000000000005',
  0, 40, 10
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '92000000-0000-4000-8000-000000000002', true);
select lives_ok(
  $$select public.save_progress('{"clientId":"95000000-0000-4000-8000-000000000005","recordedOn":"2026-07-26","weightKg":68,"customMetrics":[]}', null)$$,
  'membership trainer saves shared progress'
);
select is(auth.uid(), '92000000-0000-4000-8000-000000000002'::uuid, 'trainer actor context is restored');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '93000000-0000-4000-8000-000000000003', true);
select lives_ok(
  $$select public.save_progress('{"clientId":"95000000-0000-4000-8000-000000000005","recordedOn":"2026-07-27","weightKg":67.5,"customMetrics":[]}', null)$$,
  'client owner saves own progress'
);
select lives_ok(
  $$select public.save_workout('{"clientId":"95000000-0000-4000-8000-000000000005","workoutDate":"2026-07-28","exercises":[]}', null)$$,
  'client owner creates own workout plan'
);
select is(public.start_workout('96000000-0000-4000-8000-000000000006', 1), 2::bigint, 'client owner starts assigned workout');
select is(
  public.save_live_set_draft('98000000-0000-4000-8000-000000000008', '{"weightKg":40,"reps":10}', 1),
  2::bigint,
  'client owner saves live fact'
);
select is(public.confirm_live_set('98000000-0000-4000-8000-000000000008', 2), 3::bigint, 'client owner confirms live set');
select is(
  public.append_live_set('97000000-0000-4000-8000-000000000007', 2),
  3::bigint,
  'client owner adds a set to trainer workout during live'
);
select is(public.finish_workout('96000000-0000-4000-8000-000000000006', 3), 4::bigint, 'client owner finishes workout');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '94000000-0000-4000-8000-000000000004', true);
select throws_ok(
  $$select public.save_progress('{"clientId":"95000000-0000-4000-8000-000000000005","recordedOn":"2026-07-28","weightKg":70,"customMetrics":[]}', null)$$,
  'PT403', 'client_access_denied', 'foreign client cannot mutate progress'
);
reset role;

select * from finish();
rollback;
