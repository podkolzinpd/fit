begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

select is(
  (
    select count(*)
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and (
        case when procedure.prokind = 'f' then pg_get_functiondef(procedure.oid) else '' end like '%P0001%'
        or case when procedure.prokind = 'f' then pg_get_functiondef(procedure.oid) else '' end like '%P0002%'
      )
  ),
  0::bigint,
  'public RPCs do not expose legacy business SQLSTATEs'
);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password) values
  ('a0000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'taxonomy@example.test', ''),
  ('a0000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'uninitialized@example.test', '');
insert into public.profiles (id) values ('a0000000-0000-4000-8000-000000000001');
insert into public.trainers (profile_id) values ('a0000000-0000-4000-8000-000000000001');
insert into public.clients (id, trainer_id, full_name, gender, age_years, height_cm) values (
  'b0000000-0000-4000-8000-000000000001',
  'a0000000-0000-4000-8000-000000000001',
  'Taxonomy Client',
  'female',
  30,
  170
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000001', true);

select throws_ok(
  $$select public.save_workout(
    '{"clientId":"b0000000-0000-4000-8000-000000000099","workoutDate":"2026-07-23","exercises":[]}'::jsonb,
    null
  )$$,
  'PT404', 'client_not_found', 'missing workout client is PT404'
);
select throws_ok(
  $$select public.save_progress(
    '{"clientId":"b0000000-0000-4000-8000-000000000099","recordedOn":"2026-07-23","customMetrics":[]}'::jsonb,
    null
  )$$,
  'PT404', 'client_not_found', 'missing progress client is PT404'
);
select throws_ok(
  $$select public.append_live_set('e0000000-0000-4000-8000-000000000099', 1)$$,
  'PT403', 'workout_access_denied', 'missing exercise is inaccessible'
);
select throws_ok(
  $$select public.save_workout(
    jsonb_build_object(
      'id', 'd0000000-0000-4000-8000-000000000099',
      'clientId', 'b0000000-0000-4000-8000-000000000001',
      'workoutDate', '2026-07-23',
      'exercises', '[]'::jsonb
    ),
    1
  )$$,
  'PT403', 'workout_access_denied', 'missing workout is inaccessible'
);
select throws_ok(
  $$select public.append_live_exercise(
    'd0000000-0000-4000-8000-000000000099',
    '{"source":"invalid","ref":"running","name":"Бег","muscleGroup":"cardio","inputKind":"distance"}'::jsonb,
    1
  )$$,
  'PT403', 'workout_access_denied', 'invalid exercise source is inaccessible'
);
select throws_ok(
  $$select public.save_progress(
    '{"clientId":"b0000000-0000-4000-8000-000000000001","recordedOn":"2026-07-23","customMetrics":[{"metricId":"c0000000-0000-4000-8000-000000000099","value":10}]}'::jsonb,
    null
  )$$,
  'PT404', 'metric_not_found', 'missing custom metric is PT404'
);

select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000002', true);
select throws_ok(
  $$select public.create_client(
    '{"fullName":"No Trainer","gender":"female","ageYears":30,"heightCm":170}'::jsonb
  )$$,
  'PT422', 'trainer_not_initialized', 'missing trainer initialization is PT422'
);

reset role;
select * from finish();
rollback;
