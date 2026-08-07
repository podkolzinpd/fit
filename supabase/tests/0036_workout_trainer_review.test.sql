begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password) values
  ('36000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'review-trainer@example.test', ''),
  ('36000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'review-client@example.test', '');
insert into public.profiles (id, account_role, first_name) values
  ('36000000-0000-4000-8000-000000000001', 'trainer', 'Trainer'),
  ('36000000-0000-4000-8000-000000000002', 'client', 'Client');
insert into public.trainers (profile_id) values ('36000000-0000-4000-8000-000000000001');
insert into public.clients (id, trainer_id, auth_user_id, full_name, gender, age_years, height_cm) values
  ('36000000-0000-4000-8000-000000000003', '36000000-0000-4000-8000-000000000001', '36000000-0000-4000-8000-000000000002', 'Review client', 'female', 30, 170);
insert into public.workouts (id, trainer_id, client_id, created_by, workout_date, status, started_at, completed_at, version) values
  ('36000000-0000-4000-8000-000000000004', '36000000-0000-4000-8000-000000000001', '36000000-0000-4000-8000-000000000003', '36000000-0000-4000-8000-000000000001', current_date, 'done', now() - interval '1 hour', now(), 1),
  ('36000000-0000-4000-8000-000000000005', '36000000-0000-4000-8000-000000000001', '36000000-0000-4000-8000-000000000003', '36000000-0000-4000-8000-000000000001', current_date + 1, 'planned', null, null, 1);

select has_function('public', 'set_workout_review', array['uuid', 'text', 'bigint'], 'trainer review RPC exists');

set local role authenticated;
select set_config('request.jwt.claim.sub', '36000000-0000-4000-8000-000000000001', true);
select is(
  public.set_workout_review('36000000-0000-4000-8000-000000000004', '  Хорошая техника, добавь отдых  ', 1),
  2::bigint,
  'trainer saves a review and bumps the version'
);
select is(
  (select trainer_review from public.workouts where id = '36000000-0000-4000-8000-000000000004'),
  'Хорошая техника, добавь отдых',
  'review is trimmed before storage'
);
select throws_ok(
  $$select public.set_workout_review('36000000-0000-4000-8000-000000000005', 'рано', 1)$$,
  'PT404', 'workout_not_found', 'planned workout cannot receive a review'
);
select throws_ok(
  $$select public.set_workout_review('36000000-0000-4000-8000-000000000004', 'устаревшая версия', 1)$$,
  'PT409', 'workout_conflict', 'stale review update is a business conflict'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '36000000-0000-4000-8000-000000000002', true);
select is(
  (select trainer_review from public.list_workouts(null, null, '36000000-0000-4000-8000-000000000003', 50, 0)
   where id = '36000000-0000-4000-8000-000000000004'),
  'Хорошая техника, добавь отдых',
  'client can read the trainer review in own workout list'
);
select throws_ok(
  $$select public.set_workout_review('36000000-0000-4000-8000-000000000004', 'подмена', 2)$$,
  'PT403', 'workout_access_denied', 'client cannot write the trainer review'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '36000000-0000-4000-8000-000000000001', true);
select is(
  public.set_workout_review('36000000-0000-4000-8000-000000000004', '   ', 2),
  3::bigint,
  'blank review clears the field and bumps the version'
);
select is(
  (select trainer_review from public.workouts where id = '36000000-0000-4000-8000-000000000004'),
  null::text,
  'blank review is stored as null'
);
reset role;

select * from finish();
rollback;
