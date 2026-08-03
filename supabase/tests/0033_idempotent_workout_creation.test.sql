begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password) values
  ('50000000-0000-4000-8000-000000000033', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'idem33@example.test', '');
insert into public.profiles (id) values ('50000000-0000-4000-8000-000000000033');
insert into public.trainers (profile_id) values ('50000000-0000-4000-8000-000000000033');
insert into public.clients (id, trainer_id, full_name, gender, age_years, height_cm) values
  ('c0000000-0000-4000-8000-000000000033', '50000000-0000-4000-8000-000000000033', 'Идемпотентность 33', 'male', 30, 180);

set local role authenticated;
select set_config('request.jwt.claim.sub', '50000000-0000-4000-8000-000000000033', true);

create temp table planned_once as
select public.save_workout('{"clientId":"c0000000-0000-4000-8000-000000000033","requestId":"a0000000-0000-4000-8000-000000000033","workoutDate":"2026-08-03","exercises":[]}'::jsonb, null) as id;
select is(
  public.save_workout('{"clientId":"c0000000-0000-4000-8000-000000000033","requestId":"a0000000-0000-4000-8000-000000000033","workoutDate":"2026-08-03","exercises":[]}'::jsonb, null),
  (select id from planned_once),
  'повтор создания плана возвращает исходную тренировку'
);
select is((select count(*) from public.workouts where id = (select id from planned_once)), 1::bigint, 'повтор плана не создаёт дубль');

create temp table completed_once as
select public.save_completed_workout('{"clientId":"c0000000-0000-4000-8000-000000000033","requestId":"b0000000-0000-4000-8000-000000000033","workoutDate":"2026-08-03","exercises":[]}'::jsonb, null) as id;
select is(
  public.save_completed_workout('{"clientId":"c0000000-0000-4000-8000-000000000033","requestId":"b0000000-0000-4000-8000-000000000033","workoutDate":"2026-08-03","exercises":[]}'::jsonb, null),
  (select id from completed_once),
  'повтор завершённой записи возвращает исходную тренировку'
);
select is((select count(*) from public.workouts where id = (select id from completed_once) and status = 'done'), 1::bigint, 'повтор завершённой записи не создаёт дубль');

reset role;
select * from finish();
rollback;
