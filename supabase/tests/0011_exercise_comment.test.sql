begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password) values
  ('50000000-0000-4000-8000-00000000000d', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'comment-a@example.test', ''),
  ('60000000-0000-4000-8000-00000000000e', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'comment-b@example.test', '');
insert into public.profiles (id) values
  ('50000000-0000-4000-8000-00000000000d'),
  ('60000000-0000-4000-8000-00000000000e');
insert into public.trainers (profile_id) values
  ('50000000-0000-4000-8000-00000000000d'),
  ('60000000-0000-4000-8000-00000000000e');
insert into public.clients (id, trainer_id, full_name, gender, age_years, height_cm) values
  ('c0000000-0000-4000-8000-00000000000d', '50000000-0000-4000-8000-00000000000d', 'Comment A', 'female', 30, 170);
insert into public.workouts (id, trainer_id, client_id, workout_date, status, started_at, version) values
  ('d0000000-0000-4000-8000-00000000000d', '50000000-0000-4000-8000-00000000000d', 'c0000000-0000-4000-8000-00000000000d', '2026-07-26', 'in_progress', now(), 1);
insert into public.workout_exercises (
  id, workout_id, trainer_id, client_id, position, exercise_source, exercise_ref,
  exercise_name, muscle_group, input_kind, block_id, block_type, block_rounds
) values (
  'a0000000-0000-4000-8000-00000000000d', 'd0000000-0000-4000-8000-00000000000d',
  '50000000-0000-4000-8000-00000000000d', 'c0000000-0000-4000-8000-00000000000d',
  0, 'system', 'squat', 'Присед', 'legs', 'strength', 'b1000000-0000-4000-8000-00000000000d', 'single', 1
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '50000000-0000-4000-8000-00000000000d', true);

-- Задаём комментарий: возвращает новую версию, поле проставлено.
select is(
  public.set_exercise_comment('a0000000-0000-4000-8000-00000000000d', '  Держи спину прямо  ', 1),
  2::bigint, 'set comment bumps version to 2'
);
select is(
  (select comment from public.workout_exercises where id = 'a0000000-0000-4000-8000-00000000000d'),
  'Держи спину прямо', 'comment saved, trimmed'
);

-- Пустой комментарий → null (очистка).
select is(
  public.set_exercise_comment('a0000000-0000-4000-8000-00000000000d', '   ', 2),
  3::bigint, 'clearing comment bumps version to 3'
);
select is(
  (select comment from public.workout_exercises where id = 'a0000000-0000-4000-8000-00000000000d'),
  null::text, 'empty comment cleared to null'
);
reset role;

-- Чужой тренер не может комментировать.
set local role authenticated;
select set_config('request.jwt.claim.sub', '60000000-0000-4000-8000-00000000000e', true);
select throws_ok(
  $$select public.set_exercise_comment('a0000000-0000-4000-8000-00000000000d', 'взлом', 3)$$,
  'PT404', 'exercise_not_found', 'foreign trainer cannot comment'
);
reset role;

select * from finish();
rollback;
