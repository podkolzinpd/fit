begin;
create extension if not exists pgtap with schema extensions;
select plan(15);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password) values
  ('c1000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'goal-owner@example.test', ''),
  ('c2000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'goal-linked@example.test', ''),
  ('c3000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'goal-trainer@example.test', ''),
  ('c4000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'goal-outsider@example.test', '');
insert into public.profiles (id, account_role, first_name) values
  ('c1000000-0000-4000-8000-000000000001', 'client', 'Самостоятельный'),
  ('c2000000-0000-4000-8000-000000000002', 'client', 'Связанный'),
  ('c3000000-0000-4000-8000-000000000003', 'trainer', 'Тренер'),
  ('c4000000-0000-4000-8000-000000000004', 'trainer', 'Посторонний');
insert into public.trainers (profile_id) values
  ('c3000000-0000-4000-8000-000000000003'),
  ('c4000000-0000-4000-8000-000000000004');
insert into public.clients (id, trainer_id, auth_user_id, full_name) values
  ('c1100000-0000-4000-8000-000000000011', 'c1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', 'Самостоятельный клиент'),
  ('c2200000-0000-4000-8000-000000000022', 'c3000000-0000-4000-8000-000000000003', 'c2000000-0000-4000-8000-000000000002', 'Клиент с тренером');
insert into public.client_trainers (client_id, trainer_id) values
  ('c2200000-0000-4000-8000-000000000022', 'c3000000-0000-4000-8000-000000000003');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'c1000000-0000-4000-8000-000000000001', true);
select public.save_client_goal(jsonb_build_object(
  'clientId', 'c1100000-0000-4000-8000-000000000011',
  'title', 'Держать вес 59 кг',
  'criterion', jsonb_build_object(
    'metric', 'weight', 'operation', 'maintain_range',
    'rangeMin', 58.5, 'rangeMax', 59.5, 'unit', 'кг',
    'confirmationStatus', 'confirmed', 'position', 0
  )
)) as standalone_goal_id \gset

select ok(:'standalone_goal_id' is not null, 'standalone client creates a goal');
select is(
  (select created_by from public.client_goals where id = :'standalone_goal_id'),
  'c1000000-0000-4000-8000-000000000001'::uuid,
  'standalone client remains the goal author'
);
select is(
  public.get_client_goal('c1100000-0000-4000-8000-000000000011')->'criteria'->0->>'metric',
  'weight', 'standalone client creates a confirmed criterion atomically'
);
select public.save_goal_stage(jsonb_build_object(
  'goalId', :'standalone_goal_id', 'title', 'Стабилизация',
  'startsOn', current_date::text, 'endsOn', (current_date + 14)::text, 'position', 0
)) as standalone_stage_id \gset
select ok(:'standalone_stage_id' is not null, 'standalone client adds a goal stage');
select lives_ok(
  format($$select public.delete_goal_stage(%L::uuid)$$, :'standalone_stage_id'),
  'standalone client deletes a goal stage'
);
select throws_ok(
  $$insert into public.client_goals (client_id, trainer_id, created_by, title)
    values ('c1100000-0000-4000-8000-000000000011',
      'c1000000-0000-4000-8000-000000000001',
      'c1000000-0000-4000-8000-000000000001', 'Обход RPC')$$,
  '42501', null, 'RLS and grants still prevent direct client writes'
);
select lives_ok(
  format($$select public.archive_client_goal(%L::uuid, 1)$$, :'standalone_goal_id'),
  'standalone client archives the goal'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'c2000000-0000-4000-8000-000000000002', true);
select public.save_client_goal(jsonb_build_object(
  'clientId', 'c2200000-0000-4000-8000-000000000022',
  'title', 'Подготовиться к старту'
)) as linked_goal_id \gset
select ok(:'linked_goal_id' is not null, 'linked client creates their own goal');
select is(
  (select trainer_id from public.client_goals where id = :'linked_goal_id'),
  'c3000000-0000-4000-8000-000000000003'::uuid,
  'linked client keeps the existing trainer partition'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'c3000000-0000-4000-8000-000000000003', true);
select is(
  public.get_client_goal('c2200000-0000-4000-8000-000000000022')->>'title',
  'Подготовиться к старту', 'linked trainer reads the client-created goal'
);
select is(
  public.save_client_goal(jsonb_build_object(
    'clientId', 'c2200000-0000-4000-8000-000000000022',
    'id', :'linked_goal_id', 'title', 'Подготовиться к старту вместе'
  ), 1),
  :'linked_goal_id'::uuid, 'linked trainer can still update the goal'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'c2000000-0000-4000-8000-000000000002', true);
select is(
  public.get_client_goal('c2200000-0000-4000-8000-000000000022')->>'title',
  'Подготовиться к старту вместе', 'linked client sees the trainer update'
);
select is(
  public.save_client_goal(jsonb_build_object(
    'clientId', 'c2200000-0000-4000-8000-000000000022',
    'id', :'linked_goal_id', 'title', 'Моя формулировка цели'
  ), 2),
  :'linked_goal_id'::uuid, 'linked client can reformulate the goal'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'c4000000-0000-4000-8000-000000000004', true);
select is(
  public.get_client_goal('c2200000-0000-4000-8000-000000000022'),
  null::jsonb, 'unrelated trainer cannot read the goal'
);
select throws_ok(
  $$select public.save_client_goal(jsonb_build_object(
    'clientId', 'c2200000-0000-4000-8000-000000000022',
    'title', 'Чужая формулировка'))$$,
  'PT403', null, 'unrelated trainer cannot create or replace the goal'
);
reset role;

select * from finish();
rollback;
