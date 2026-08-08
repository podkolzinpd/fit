begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password) values
  ('37000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'comment-trainer@example.test', ''),
  ('37000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'comment-client@example.test', ''),
  ('37000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'comment-outsider@example.test', '');
insert into public.profiles (id, account_role, first_name) values
  ('37000000-0000-4000-8000-000000000001', 'trainer', 'Тренер'),
  ('37000000-0000-4000-8000-000000000002', 'client', 'Клиент'),
  ('37000000-0000-4000-8000-000000000003', 'client', 'Чужой');
insert into public.trainers (profile_id) values ('37000000-0000-4000-8000-000000000001');
insert into public.clients (id, trainer_id, auth_user_id, full_name, gender, age_years, height_cm) values
  ('37000000-0000-4000-8000-000000000004', '37000000-0000-4000-8000-000000000001', '37000000-0000-4000-8000-000000000002', 'Клиент комментария', 'female', 30, 170);
insert into public.workouts (id, trainer_id, client_id, created_by, workout_date, status, version) values
  ('37000000-0000-4000-8000-000000000005', '37000000-0000-4000-8000-000000000001', '37000000-0000-4000-8000-000000000004', '37000000-0000-4000-8000-000000000001', current_date, 'planned', 1);

select has_function('public', 'set_client_workout_comment', array['uuid', 'text', 'bigint'], 'client comment RPC exists');

set local role authenticated;
select set_config('request.jwt.claim.sub', '37000000-0000-4000-8000-000000000002', true);
select is(
  public.set_client_workout_comment('37000000-0000-4000-8000-000000000005', '  Нужна корректировка веса  ', 1),
  2::bigint,
  'client saves own comment and bumps version'
);
select is(
  (select client_comment from public.workouts where id = '37000000-0000-4000-8000-000000000005'),
  'Нужна корректировка веса',
  'client comment is trimmed before storage'
);
select is(
  (select client_comment from public.list_workouts(null, null, '37000000-0000-4000-8000-000000000004', 50, 0)
   where id = '37000000-0000-4000-8000-000000000005'),
  'Нужна корректировка веса',
  'client sees own comment in workout list'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '37000000-0000-4000-8000-000000000001', true);
select is(
  (select client_comment from public.list_workouts(null, null, '37000000-0000-4000-8000-000000000004', 50, 0)
   where id = '37000000-0000-4000-8000-000000000005'),
  'Нужна корректировка веса',
  'author trainer sees client comment'
);
select throws_ok(
  $$select public.set_client_workout_comment('37000000-0000-4000-8000-000000000005', 'подмена', 2)$$,
  'PT403', 'workout_access_denied', 'trainer cannot write client comment'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '37000000-0000-4000-8000-000000000003', true);
select throws_ok(
  $$select public.set_client_workout_comment('37000000-0000-4000-8000-000000000005', 'подмена', 2)$$,
  'PT403', 'workout_access_denied', 'another client cannot write the comment'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '37000000-0000-4000-8000-000000000002', true);
select is(
  public.set_client_workout_comment('37000000-0000-4000-8000-000000000005', '   ', 2),
  3::bigint,
  'blank client comment clears the field'
);
select is(
  (select client_comment from public.workouts where id = '37000000-0000-4000-8000-000000000005'),
  null::text,
  'blank client comment is stored as null'
);
reset role;

select * from finish();
rollback;
