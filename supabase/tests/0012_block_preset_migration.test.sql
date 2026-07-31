begin;
create extension if not exists pgtap with schema extensions;
select plan(2);

-- Регресс прод-падения Этапа A: миграция superset/triset/circuit → group не
-- должна нарушать constraint block_type на СУЩЕСТВУЮЩИХ строках. Локальный
-- db reset накатывал на пустую БД и не ловил это. Здесь сеем «дореформенную»
-- строку и проигрываем исправленный порядок (drop → update → add).

insert into auth.users (id, instance_id, aud, role, email, encrypted_password) values
  ('aa000000-0000-4000-8000-0000000000f2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'migf2@example.test', '');
insert into public.profiles (id) values ('aa000000-0000-4000-8000-0000000000f2');
insert into public.trainers (profile_id) values ('aa000000-0000-4000-8000-0000000000f2');
insert into public.clients (id, trainer_id, full_name, gender, age_years, height_cm) values
  ('cc000000-0000-4000-8000-0000000000f2', 'aa000000-0000-4000-8000-0000000000f2', 'Mig', 'male', 30, 180);
insert into public.workouts (id, trainer_id, client_id, workout_date, status) values
  ('dd000000-0000-4000-8000-0000000000f2', 'aa000000-0000-4000-8000-0000000000f2', 'cc000000-0000-4000-8000-0000000000f2', '2026-07-24', 'planned');

-- Возвращаем «старый» constraint, допускающий circuit, и вставляем такую строку.
-- Тест запускается поверх уже мигрированной seed-базы, где есть block_type=group.
-- NOT VALID не перепроверяет эти постмиграционные строки, но продолжает
-- проверять новую «дореформенную» строку и позволяет воспроизвести миграцию.
alter table public.workout_exercises drop constraint workout_exercises_block_type_allowed;
alter table public.workout_exercises add constraint workout_exercises_block_type_allowed
  check (block_type in ('single', 'superset', 'triset', 'circuit')) not valid;
insert into public.workout_exercises (
  id, workout_id, trainer_id, client_id, position, exercise_source, exercise_ref,
  exercise_name, muscle_group, input_kind, block_id, block_type, block_preset, block_rounds
) values (
  'ee000000-0000-4000-8000-0000000000f2', 'dd000000-0000-4000-8000-0000000000f2',
  'aa000000-0000-4000-8000-0000000000f2', 'cc000000-0000-4000-8000-0000000000f2',
  0, 'system', 'bench', 'Жим', 'chest', 'strength', 'bb000000-0000-4000-8000-0000000000f2', 'circuit', 'set', 2
);

-- Исправленный порядок миграции: сначала drop, потом update, потом add.
select lives_ok($$
  alter table public.workout_exercises drop constraint if exists workout_exercises_block_type_allowed;
  update public.workout_exercises set block_preset = 'circuit', rest_between_exercises_sec = 15, rest_between_rounds_sec = 60 where block_type in ('superset','triset','circuit');
  update public.workout_exercises set block_type = 'group' where block_type in ('superset','triset','circuit');
  alter table public.workout_exercises add constraint workout_exercises_block_type_allowed check (block_type in ('single','group'));
$$, 'миграция circuit→group на существующей строке не нарушает constraint');

select is(
  (select block_type || '/' || block_preset from public.workout_exercises where id = 'ee000000-0000-4000-8000-0000000000f2'),
  'group/circuit', 'circuit смигрирован в group + preset circuit'
);

select * from finish();
rollback;
