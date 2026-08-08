begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

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

insert into auth.users (id, instance_id, aud, role, email, encrypted_password) values
  ('50000000-0000-4000-8000-000000000034', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'client-idempotency@example.test', '');
insert into public.profiles (id, account_role, first_name) values
  ('50000000-0000-4000-8000-000000000034', 'client', 'Клиент');
insert into public.clients (id, trainer_id, auth_user_id, full_name, gender, age_years, height_cm) values
  ('c0000000-0000-4000-8000-000000000034', '50000000-0000-4000-8000-000000000034', '50000000-0000-4000-8000-000000000034', 'Клиент идемпотентности', 'female', 30, 170);
-- Подключение тренера не меняет самостоятельный partition owner клиента.
insert into public.client_trainers (client_id, trainer_id) values
  ('c0000000-0000-4000-8000-000000000034', '50000000-0000-4000-8000-000000000033');

set local role authenticated;
select set_config('request.jwt.claim.sub', '50000000-0000-4000-8000-000000000034', true);

create temp table client_copy_once as
select public.save_workout('{
  "clientId":"c0000000-0000-4000-8000-000000000034",
  "requestId":"a0000000-0000-4000-8000-000000000034",
  "workoutDate":"2026-08-03",
  "exercises":[{
    "position":0,"source":"system","ref":"bench-press","name":"Жим лёжа",
    "muscleGroup":"chest","inputKind":"strength","blockId":"b0000000-0000-4000-8000-000000000034",
    "sets":[{"position":0,"weightKg":25,"reps":15}]
  }]
}'::jsonb, null) as id;
select isnt((select id from client_copy_once), null::uuid, 'клиент сохраняет скопированную тренировку с requestId');
select is(
  public.save_workout('{
    "clientId":"c0000000-0000-4000-8000-000000000034",
    "requestId":"a0000000-0000-4000-8000-000000000034",
    "workoutDate":"2026-08-03","exercises":[]
  }'::jsonb, null),
  (select id from client_copy_once),
  'повтор клиентского сохранения возвращает исходную копию'
);
select is(
  (select created_by from public.workouts where id = (select id from client_copy_once)),
  '50000000-0000-4000-8000-000000000034'::uuid,
  'копия остаётся созданной клиентом'
);
select is(
  (select count(*) from public.workouts where id = (select id from client_copy_once)),
  1::bigint,
  'клиентский повтор не создаёт дубль'
);

create temp table client_completed_copy_once as
select public.save_completed_workout('{"clientId":"c0000000-0000-4000-8000-000000000034","requestId":"b0000000-0000-4000-8000-000000000034","workoutDate":"2026-08-03","exercises":[]}'::jsonb, null) as id;
select isnt((select id from client_completed_copy_once), null::uuid, 'клиент сохраняет скопированную завершённую тренировку');
select is(
  public.save_completed_workout('{"clientId":"c0000000-0000-4000-8000-000000000034","requestId":"b0000000-0000-4000-8000-000000000034","workoutDate":"2026-08-03","exercises":[]}'::jsonb, null),
  (select id from client_completed_copy_once),
  'повтор клиентской завершённой копии возвращает исходную тренировку'
);
select is(
  (select count(*) from public.workouts where id = (select id from client_completed_copy_once) and status = 'done'),
  1::bigint,
  'клиентская завершённая копия сохраняется без дубля'
);

reset role;
select * from finish();
rollback;
