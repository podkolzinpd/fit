begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password) values
  ('b1000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'self-root@example.test', ''),
  ('b2000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'self-owner@example.test', ''),
  ('b3000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'self-stranger@example.test', '');
insert into public.profiles (id, account_role, first_name) values
  ('b1000000-0000-4000-8000-000000000001', 'trainer', 'Root'),
  ('b2000000-0000-4000-8000-000000000002', 'client', 'Owner'),
  ('b3000000-0000-4000-8000-000000000003', 'client', 'Stranger');
insert into public.trainers (profile_id) values ('b1000000-0000-4000-8000-000000000001');
insert into public.clients (id, trainer_id, auth_user_id, full_name, gender, age_years, height_cm)
values ('b4000000-0000-4000-8000-000000000004', 'b1000000-0000-4000-8000-000000000001',
  'b2000000-0000-4000-8000-000000000002', 'Self client', 'female', 30, 170);
insert into public.client_trainers (client_id, trainer_id)
values ('b4000000-0000-4000-8000-000000000004', 'b1000000-0000-4000-8000-000000000001');
insert into public.workouts (id, trainer_id, client_id, created_by, workout_date)
values ('b5000000-0000-4000-8000-000000000005', 'b1000000-0000-4000-8000-000000000001',
  'b4000000-0000-4000-8000-000000000004', 'b1000000-0000-4000-8000-000000000001', current_date);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'b2000000-0000-4000-8000-000000000002', true);
select isnt(
  public.save_workout(
    jsonb_build_object(
      'clientId', 'b4000000-0000-4000-8000-000000000004',
      'workoutDate', current_date,
      'exercises', jsonb_build_array(jsonb_build_object(
        'position', 0, 'source', 'system', 'ref', 'run', 'name', 'Бег',
        'muscleGroup', 'cardio', 'inputKind', 'distance',
        'trainerComment', 'must not persist',
        'sets', jsonb_build_array(jsonb_build_object('position', 0, 'durationMin', 20))
      ))
    ),
    null
  ),
  null::uuid,
  'client owner creates a workout'
);
select is(
  (select count(*) from public.workouts
   where client_id = 'b4000000-0000-4000-8000-000000000004'
     and created_by = 'b2000000-0000-4000-8000-000000000002'),
  1::bigint,
  'new workout records the client creator'
);
select is(
  (select trainer_comment from public.workout_exercises
   where workout_id = (select id from public.workouts where created_by = 'b2000000-0000-4000-8000-000000000002')),
  null::text,
  'client cannot persist trainer comments'
);
select isnt(
  public.save_workout(
    jsonb_build_object(
      'id', (select id from public.workouts where created_by = 'b2000000-0000-4000-8000-000000000002'),
      'clientId', 'b4000000-0000-4000-8000-000000000004',
      'workoutDate', current_date + 1,
      'exercises', '[]'::jsonb
    ),
    1
  ),
  null::uuid,
  'client owner edits own planned workout'
);
select throws_ok(
  $$select public.save_workout(
    jsonb_build_object('id', 'b5000000-0000-4000-8000-000000000005',
      'clientId', 'b4000000-0000-4000-8000-000000000004',
      'workoutDate', current_date, 'exercises', '[]'::jsonb),
    1
  )$$,
  'PT403', 'client_workout_edit_denied', 'client cannot edit trainer-created workout'
);
select throws_ok(
  $$select public.soft_delete_workout('b5000000-0000-4000-8000-000000000005', 1)$$,
  'PT403', 'client_workout_delete_denied', 'client cannot delete trainer-created workout'
);
select lives_ok(
  format(
    'select public.soft_delete_workout(%L, 2)',
    (select id from public.workouts where created_by = 'b2000000-0000-4000-8000-000000000002')
  ),
  'client deletes own workout'
);
select is(
  (select count(*) from public.workouts
   where created_by = 'b2000000-0000-4000-8000-000000000002' and deleted_at is null),
  0::bigint,
  'deleted client workout is no longer active'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'b3000000-0000-4000-8000-000000000003', true);
select throws_ok(
  $$select public.save_workout(
    jsonb_build_object('clientId', 'b4000000-0000-4000-8000-000000000004',
      'workoutDate', current_date, 'exercises', '[]'::jsonb),
    null
  )$$,
  'PT403', 'client_access_denied', 'foreign client cannot create a workout'
);
reset role;

select * from finish();
rollback;
