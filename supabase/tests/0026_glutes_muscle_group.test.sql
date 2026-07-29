begin;
create extension if not exists pgtap with schema extensions;
select plan(3);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password) values
  ('d1000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'glutes-trainer@example.test', '');
insert into public.profiles (id, account_role, first_name) values
  ('d1000000-0000-4000-8000-000000000001', 'trainer', 'Тренер');
insert into public.trainers (profile_id) values ('d1000000-0000-4000-8000-000000000001');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000001', true);

-- Своё упражнение в группе «Ягодицы» (glutes) сохраняется.
select lives_ok(
  $$insert into public.custom_exercises (trainer_id, name, muscle_group, input_kind)
    values ('d1000000-0000-4000-8000-000000000001', 'Мах назад в кроссовере', 'glutes', 'strength')$$,
  'custom exercise with glutes group is accepted'
);

-- Тренировка с упражнением группы glutes создаётся (workout_exercises constraint).
select public.create_client(jsonb_build_object(
  'fullName', 'Клиент', 'gender', 'female', 'ageYears', 30, 'ageUpdatedAt', current_date, 'heightCm', 170
)) as client_id \gset
select lives_ok(
  format($$select public.save_workout(jsonb_build_object(
    'clientId', %L, 'workoutDate', current_date::text,
    'exercises', jsonb_build_array(jsonb_build_object(
      'position', 0, 'source', 'system', 'ref', 'hip-thrust', 'name', 'Ягодичный мостик',
      'muscleGroup', 'glutes', 'inputKind', 'strength', 'sets', '[]'::jsonb
    ))
  ))$$, :'client_id'),
  'workout exercise with glutes group is accepted'
);

-- Некорректная группа по-прежнему отклоняется.
select throws_ok(
  $$insert into public.custom_exercises (trainer_id, name, muscle_group, input_kind)
    values ('d1000000-0000-4000-8000-000000000001', 'Кривая группа', 'bogus', 'strength')$$,
  '23514', null, 'unknown muscle group is still rejected'
);
reset role;

select * from finish();
rollback;
