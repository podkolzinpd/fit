begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password) values
  ('a6000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'favorite-one@example.test', ''),
  ('a6000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'favorite-two@example.test', ''),
  ('a6000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'favorite-trainer@example.test', '');
insert into public.profiles (id, account_role) values
  ('a6000000-0000-4000-8000-000000000001', 'client'),
  ('a6000000-0000-4000-8000-000000000002', 'client'),
  ('a6000000-0000-4000-8000-000000000003', 'trainer');

select has_table('public', 'favorite_workouts', 'favorite workouts table exists');
select has_function('public', 'list_favorite_workouts', array[]::text[], 'list RPC exists');
select has_function('public', 'save_favorite_workout', array['text', 'jsonb'], 'save RPC exists');
select has_function('public', 'delete_favorite_workout', array['uuid'], 'delete RPC exists');
select ok(has_table_privilege('authenticated', 'public.favorite_workouts', 'SELECT') = false,
  'raw favorite workouts table is not exposed');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a6000000-0000-4000-8000-000000000001', true);
select is(jsonb_array_length(public.list_favorite_workouts()), 0, 'list starts empty');
select throws_like(
  $$select public.save_favorite_workout('', jsonb_build_array(jsonb_build_object('name', 'Присед')))$$,
  '%invalid_favorite_workout_title%',
  'blank title is rejected'
);
select throws_like(
  $$select public.save_favorite_workout('Ноги', '[]'::jsonb)$$,
  '%invalid_favorite_workout_exercises%',
  'empty exercises array is rejected'
);

select is(
  (public.save_favorite_workout('Ноги и кор', jsonb_build_array(jsonb_build_object('name', 'Присед')))->>'title'),
  'Ноги и кор', 'save returns the saved title'
);
select is(jsonb_array_length(public.list_favorite_workouts()), 1, 'list reflects the saved favorite');
select is(
  (public.list_favorite_workouts()->0->'exercises'->0->>'name'),
  'Присед', 'stored exercises snapshot round-trips'
);

select set_config('request.jwt.claim.sub', 'a6000000-0000-4000-8000-000000000002', true);
select is(jsonb_array_length(public.list_favorite_workouts()), 0, 'favorites are isolated between clients');

select set_config('request.jwt.claim.sub', 'a6000000-0000-4000-8000-000000000003', true);
select throws_like(
  $$select public.save_favorite_workout('Ноги', jsonb_build_array(jsonb_build_object('name', 'Присед')))$$,
  '%client_role_required%',
  'a trainer cannot save a favorite workout'
);

select set_config('request.jwt.claim.sub', 'a6000000-0000-4000-8000-000000000001', true);
select public.save_favorite_workout('Спина', jsonb_build_array(jsonb_build_object('name', 'Тяга')));
select public.save_favorite_workout('Грудь', jsonb_build_array(jsonb_build_object('name', 'Жим')));
select public.save_favorite_workout('Плечи', jsonb_build_array(jsonb_build_object('name', 'Жим стоя')));
select public.save_favorite_workout('Руки', jsonb_build_array(jsonb_build_object('name', 'Сгибания')));
select public.save_favorite_workout('Кардио', jsonb_build_array(jsonb_build_object('name', 'Бег')));
select public.save_favorite_workout('Растяжка', jsonb_build_array(jsonb_build_object('name', 'Мобильность')));
select public.save_favorite_workout('Фулбади', jsonb_build_array(jsonb_build_object('name', 'Присед')));
select public.save_favorite_workout('Ягодицы', jsonb_build_array(jsonb_build_object('name', 'Ягодичный мостик')));
select public.save_favorite_workout('Пресс', jsonb_build_array(jsonb_build_object('name', 'Скручивания')));
select is(jsonb_array_length(public.list_favorite_workouts()), 10, 'ten favorites accumulate for one client');
select throws_like(
  $$select public.save_favorite_workout('Одиннадцатая', jsonb_build_array(jsonb_build_object('name', 'Присед')))$$,
  '%favorite_workout_limit_reached%',
  'an eleventh favorite is rejected'
);

select throws_like(
  $$select public.delete_favorite_workout('00000000-0000-4000-8000-000000000000'::uuid)$$,
  '%favorite_workout_not_found%',
  'deleting a missing favorite fails'
);
select public.delete_favorite_workout((public.list_favorite_workouts()->0->>'id')::uuid);
select is(jsonb_array_length(public.list_favorite_workouts()), 9, 'delete removes exactly one favorite');

reset role;
set local role anon;
select throws_like(
  $$select public.list_favorite_workouts()$$,
  '%permission denied for function list_favorite_workouts%',
  'anonymous actor cannot list favorites'
);

reset role;
select * from finish();
rollback;
