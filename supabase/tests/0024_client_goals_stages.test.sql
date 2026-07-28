begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password) values
  ('a1000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'g-trainer@example.test', ''),
  ('a2000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'g-other-trainer@example.test', ''),
  ('a3000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'g-client@example.test', '');
insert into public.profiles (id, account_role, first_name) values
  ('a1000000-0000-4000-8000-000000000001', 'trainer', 'Тренер'),
  ('a2000000-0000-4000-8000-000000000002', 'trainer', 'Чужой'),
  ('a3000000-0000-4000-8000-000000000003', 'client', 'Клиент');
insert into public.trainers (profile_id) values
  ('a1000000-0000-4000-8000-000000000001'),
  ('a2000000-0000-4000-8000-000000000002');

-- Тренер создаёт клиента и цель. Идентификаторы ловим в psql-переменные,
-- чтобы ссылаться на них даже когда RLS прячет клиента от чужого тренера.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', true);
select public.create_client(jsonb_build_object(
  'fullName', 'Клиент Цели', 'gender', 'female', 'ageYears', 30,
  'ageUpdatedAt', current_date, 'heightCm', 170
)) as client_id \gset

select public.save_client_goal(jsonb_build_object(
  'clientId', :'client_id', 'title', 'Похудеть к отпуску', 'targetDate', (current_date + 60)::text
)) as goal_id \gset
select ok(:'goal_id' is not null, 'trainer creates a goal');
select is(
  (public.get_client_goal(:'client_id')->>'title'),
  'Похудеть к отпуску', 'goal is readable with title'
);
select is(
  jsonb_array_length(public.get_client_goal(:'client_id')->'stages'),
  0, 'goal starts with zero stages'
);

-- Одна активная цель на клиента.
select throws_ok(
  format($$select public.save_client_goal(jsonb_build_object(
    'clientId', %L, 'title', 'Вторая активная'))$$, :'client_id'),
  '23505', null, 'cannot create a second active goal'
);

-- Обновление цели (id + version).
select is(
  public.save_client_goal(jsonb_build_object(
    'clientId', :'client_id', 'id', :'goal_id',
    'title', 'Похудеть к лету', 'targetDate', (current_date + 90)::text
  ), 1),
  :'goal_id'::uuid,
  'trainer updates the goal by version'
);

-- Пустой title отклоняется.
select throws_ok(
  format($$select public.save_client_goal(jsonb_build_object(
    'clientId', %L, 'id', %L, 'title', '   '), 2)$$, :'client_id', :'goal_id'),
  'PT422', null, 'empty title is rejected'
);

-- Этапы: добавить два, прочитать, проверить период.
select public.save_goal_stage(jsonb_build_object(
  'goalId', :'goal_id', 'title', 'Набор',
  'startsOn', current_date::text, 'endsOn', (current_date + 30)::text, 'position', 0
)) as stage1_id \gset
select ok(:'stage1_id' is not null, 'trainer adds first stage');
select public.save_goal_stage(jsonb_build_object(
  'goalId', :'goal_id', 'title', 'Сушка',
  'startsOn', (current_date + 31)::text, 'endsOn', (current_date + 60)::text, 'position', 1
)) as stage2_id \gset
select ok(:'stage2_id' is not null, 'trainer adds second stage');
select is(
  jsonb_array_length(public.get_client_goal(:'client_id')->'stages'),
  2, 'goal now has two stages'
);
select throws_ok(
  format($$select public.save_goal_stage(jsonb_build_object(
    'goalId', %L, 'title', 'Кривой период', 'startsOn', %L, 'endsOn', %L))$$,
    :'goal_id', (current_date + 10)::text, current_date::text),
  'PT422', null, 'stage with ends_on < starts_on is rejected'
);
reset role;

-- Чужой тренер не видит цель и не может писать.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a2000000-0000-4000-8000-000000000002', true);
select is(
  public.get_client_goal(:'client_id'),
  null::jsonb, 'unconnected trainer cannot read the goal'
);
select throws_ok(
  format($$select public.save_client_goal(jsonb_build_object(
    'clientId', %L, 'title', 'Взлом'))$$, :'client_id'),
  'PT403', null, 'unconnected trainer cannot write a goal'
);
reset role;

-- Архивирование освобождает слот активной цели.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', true);
select lives_ok(
  format($$select public.archive_client_goal(%L::uuid, (public.get_client_goal(%L)->>'version')::bigint)$$,
    :'goal_id', :'client_id'),
  'trainer archives the goal'
);
select is(
  public.get_client_goal(:'client_id'),
  null::jsonb, 'no active goal after archiving'
);
reset role;

select * from finish();
rollback;
