begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password) values
  ('b1000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'criteria-trainer@example.test', ''),
  ('b2000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'criteria-other@example.test', '');
insert into public.profiles (id, account_role, first_name) values
  ('b1000000-0000-4000-8000-000000000001', 'trainer', 'Тренер'),
  ('b2000000-0000-4000-8000-000000000002', 'trainer', 'Чужой');
insert into public.trainers (profile_id) values
  ('b1000000-0000-4000-8000-000000000001'),
  ('b2000000-0000-4000-8000-000000000002');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'b1000000-0000-4000-8000-000000000001', true);
select public.create_client(jsonb_build_object(
  'fullName', 'Клиент без критерия', 'gender', 'female', 'ageYears', 30,
  'ageUpdatedAt', current_date, 'heightCm', 170
)) as legacy_client_id \gset
select public.save_client_goal(jsonb_build_object(
  'clientId', :'legacy_client_id', 'title', 'Старая текстовая цель'
)) as legacy_goal_id \gset

select is(
  jsonb_array_length(public.get_client_goal(:'legacy_client_id')->'criteria'),
  0, 'legacy goal receives no inferred criteria'
);

select public.create_client(jsonb_build_object(
  'fullName', 'Клиент с критерием', 'gender', 'female', 'ageYears', 31,
  'ageUpdatedAt', current_date, 'heightCm', 168
)) as client_id \gset
select public.save_client_goal(jsonb_build_object(
  'clientId', :'client_id', 'title', 'Держать вес 59 кг',
  'criterion', jsonb_build_object(
    'metric', 'weight', 'operation', 'maintain_range',
    'rangeMin', 58.5, 'rangeMax', 59.5, 'unit', 'кг',
    'confirmationStatus', 'confirmed', 'position', 0
  )
)) as goal_id \gset

select is(
  jsonb_array_length(public.get_client_goal(:'client_id')->'criteria'),
  1, 'goal and manual criterion are created atomically'
);
select is(
  public.get_client_goal(:'client_id')->>'title',
  'Держать вес 59 кг', 'goal title remains the user source of truth'
);
select is(
  public.get_client_goal(:'client_id')->'criteria'->0->>'metric',
  'weight', 'criterion metric is returned'
);
select is(
  public.get_client_goal(:'client_id')->'criteria'->0->>'confirmationStatus',
  'confirmed', 'manual criterion is confirmed'
);
select is(
  (public.get_client_goal(:'client_id')->'criteria'->0->>'rangeMin')::numeric,
  58.5::numeric, 'criterion range is preserved'
);

select throws_ok(
  format($$select public.save_client_goal(jsonb_build_object(
    'clientId', %L, 'id', %L, 'title', 'Держать вес 59 кг',
    'criterion', jsonb_build_object(
      'metric', 'weight', 'operation', 'maintain_range',
      'rangeMin', 59.5, 'rangeMax', 58.5, 'unit', 'кг',
      'confirmationStatus', 'confirmed')),
    (public.get_client_goal(%L)->>'version')::bigint)$$,
    :'client_id', :'goal_id', :'client_id'),
  'PT422', null, 'invalid range is rejected'
);
select throws_ok(
  format($$select public.save_client_goal(jsonb_build_object(
    'clientId', %L, 'id', %L, 'title', 'Держать вес 59 кг',
    'criterion', jsonb_build_object(
      'metric', 'weight', 'operation', 'track_only', 'unit', 'см',
      'confirmationStatus', 'confirmed')),
    (public.get_client_goal(%L)->>'version')::bigint)$$,
    :'client_id', :'goal_id', :'client_id'),
  'PT422', null, 'metric unit mismatch is rejected'
);

select public.save_client_goal(jsonb_build_object(
  'clientId', :'client_id', 'id', :'goal_id', 'title', 'Держать вес около 59 кг'
), (public.get_client_goal(:'client_id')->>'version')::bigint);
select is(
  public.get_client_goal(:'client_id')->'criteria'->0->>'confirmationStatus',
  'needs_review', 'title change requires criterion review'
);

select public.get_client_goal(:'client_id')->'criteria'->0->>'id' as criterion_id \gset
select (public.get_client_goal(:'client_id')->'criteria'->0->>'version')::bigint as criterion_version \gset
select public.save_client_goal(jsonb_build_object(
  'clientId', :'client_id', 'id', :'goal_id', 'title', 'Держать вес около 59 кг',
  'criterion', jsonb_build_object(
    'id', :'criterion_id', 'version', :'criterion_version',
    'metric', 'weight', 'operation', 'maintain_range',
    'rangeMin', 58.5, 'rangeMax', 59.5, 'unit', 'кг',
    'confirmationStatus', 'confirmed', 'position', 0
  )
), (public.get_client_goal(:'client_id')->>'version')::bigint);
select is(
  public.get_client_goal(:'client_id')->'criteria'->0->>'confirmationStatus',
  'confirmed', 'user can explicitly reconfirm a reviewed criterion'
);

select (public.get_client_goal(:'client_id')->'criteria'->0->>'version')::bigint as criterion_version \gset
select public.save_client_goal(jsonb_build_object(
  'clientId', :'client_id', 'id', :'goal_id', 'title', 'Сохранять вес около 59 кг',
  'criterion', jsonb_build_object(
    'id', :'criterion_id', 'version', :'criterion_version',
    'metric', 'weight', 'operation', 'maintain_range',
    'rangeMin', 58.5, 'rangeMax', 59.5, 'unit', 'кг',
    'confirmationStatus', 'confirmed', 'position', 0
  )
), (public.get_client_goal(:'client_id')->>'version')::bigint);
select is(
  public.get_client_goal(:'client_id')->'criteria'->0->>'confirmationStatus',
  'confirmed', 'title and explicitly confirmed criterion can change atomically'
);

select public.save_client_goal(jsonb_build_object(
  'clientId', :'client_id', 'id', :'goal_id', 'title', 'Сохранять вес около 59 кг',
  'criterion', null
), (public.get_client_goal(:'client_id')->>'version')::bigint);
select is(
  jsonb_array_length(public.get_client_goal(:'client_id')->'criteria'),
  0, 'goal can be saved without automatic evaluation'
);
select is(
  (select count(*)::integer from public.goal_criteria where goal_id = :'goal_id' and archived_at is not null),
  1, 'removed criterion stays in history'
);

select public.create_client(jsonb_build_object(
  'fullName', 'Атомарная проверка', 'gender', 'male', 'ageYears', 29,
  'ageUpdatedAt', current_date, 'heightCm', 180
)) as invalid_client_id \gset
select throws_ok(
  format($$select public.save_client_goal(jsonb_build_object(
    'clientId', %L, 'title', 'Некорректная цель',
    'criterion', jsonb_build_object(
      'metric', 'weight', 'operation', 'decrease_to',
      'targetValue', -1, 'unit', 'кг', 'confirmationStatus', 'confirmed')))$$,
    :'invalid_client_id'),
  'PT422', null, 'invalid criterion rejects the aggregate'
);
select is(
  public.get_client_goal(:'invalid_client_id'),
  null::jsonb, 'invalid criterion rolls goal creation back'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'b2000000-0000-4000-8000-000000000002', true);
select is(public.get_client_goal(:'client_id'), null::jsonb, 'unconnected trainer cannot read criteria');
select throws_ok(
  format($$select public.save_client_goal(jsonb_build_object(
    'clientId', %L, 'id', %L, 'title', 'Чужая цель', 'criterion', null), 1)$$,
    :'client_id', :'goal_id'),
  'PT403', null, 'unconnected trainer cannot change criteria'
);
reset role;

select * from finish();
rollback;
