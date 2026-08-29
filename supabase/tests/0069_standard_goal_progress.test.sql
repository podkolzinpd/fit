begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password) values
  ('d1000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'progress-12@example.test', '');
insert into public.profiles (id, account_role, first_name) values
  ('d1000000-0000-4000-8000-000000000001', 'trainer', 'Тренер');
insert into public.trainers (profile_id) values ('d1000000-0000-4000-8000-000000000001');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000001', true);
select public.create_client(jsonb_build_object(
  'fullName', 'Клиент Progress 1.2', 'gender', 'female', 'ageYears', 30,
  'ageUpdatedAt', current_date, 'heightCm', 170
)) as client_id \gset
reset role;

insert into public.client_progress (
  id, trainer_id, client_id, created_by, recorded_on, weight_kg
) values
  ('d1100000-0000-4000-8000-000000000011', 'd1000000-0000-4000-8000-000000000001', :'client_id', 'd1000000-0000-4000-8000-000000000001', current_date - 20, 80),
  ('d1200000-0000-4000-8000-000000000012', 'd1000000-0000-4000-8000-000000000001', :'client_id', 'd1000000-0000-4000-8000-000000000001', current_date - 10, 79);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000001', true);
select public.save_client_goal(jsonb_build_object(
  'clientId', :'client_id', 'title', 'Снизить вес на 3 кг',
  'criterion', jsonb_build_object(
    'metric', 'weight', 'operation', 'change_by', 'targetValue', -3,
    'unit', 'кг', 'confirmationStatus', 'confirmed', 'position', 0
  )
)) as goal_id \gset

select is(
  (public.get_client_goal(:'client_id')->'criteria'->0->>'baselineValue')::numeric,
  79::numeric, 'relative goal captures the latest standard measurement as baseline'
);
select is(
  (public.get_client_goal(:'client_id')->'criteria'->0->>'baselineRecordedOn')::date,
  current_date - 10, 'baseline date is returned to the application'
);
select is(
  (select baseline_progress_id from public.goal_criteria where goal_id = :'goal_id'),
  'd1200000-0000-4000-8000-000000000012'::uuid, 'baseline keeps its source measurement identity'
);
reset role;

update public.client_progress set weight_kg = 78.5, version = version + 1
where id = 'd1200000-0000-4000-8000-000000000012';
select is(
  (select baseline_value from public.goal_criteria where goal_id = :'goal_id'),
  78.5::numeric, 'historical correction refreshes the captured baseline value'
);

insert into public.client_progress (
  id, trainer_id, client_id, created_by, recorded_on, weight_kg
) values (
  'd1300000-0000-4000-8000-000000000013', 'd1000000-0000-4000-8000-000000000001', :'client_id',
  'd1000000-0000-4000-8000-000000000001', current_date, 77
);
select is(
  (select baseline_value from public.goal_criteria where goal_id = :'goal_id'),
  78.5::numeric, 'later measurements do not move an established baseline'
);

update public.client_progress set deleted_at = now(), version = version + 1
where id = 'd1200000-0000-4000-8000-000000000012';
select is(
  (select baseline_value from public.goal_criteria where goal_id = :'goal_id'),
  80::numeric, 'deleting the baseline falls back to the preceding valid measurement'
);
select is(
  (select baseline_progress_id from public.goal_criteria where goal_id = :'goal_id'),
  'd1100000-0000-4000-8000-000000000011'::uuid, 'fallback keeps a traceable measurement source'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000001', true);
select public.create_client(jsonb_build_object(
  'fullName', 'Без baseline', 'gender', 'male', 'ageYears', 31,
  'ageUpdatedAt', current_date, 'heightCm', 180
)) as no_data_client_id \gset
select public.save_client_goal(jsonb_build_object(
  'clientId', :'no_data_client_id', 'title', 'Изменить талию на 2 см',
  'criterion', jsonb_build_object(
    'metric', 'waist', 'operation', 'change_by', 'targetValue', -2,
    'unit', 'см', 'confirmationStatus', 'confirmed', 'position', 0
  )
)) as no_data_goal_id \gset
select is(
  public.get_client_goal(:'no_data_client_id')->'criteria'->0->'baselineValue',
  'null'::jsonb, 'relative criterion remains valid and explicitly lacks a baseline without measurements'
);
reset role;

insert into public.client_progress (
  id, trainer_id, client_id, created_by, recorded_on, waist_cm
) values (
  'd1400000-0000-4000-8000-000000000014', 'd1000000-0000-4000-8000-000000000001', :'no_data_client_id',
  'd1000000-0000-4000-8000-000000000001', current_date, 72
);
select is(
  (select baseline_value from public.goal_criteria where goal_id = :'no_data_goal_id'),
  72::numeric, 'the first later measurement establishes a previously missing baseline'
);

select * from finish();
rollback;
