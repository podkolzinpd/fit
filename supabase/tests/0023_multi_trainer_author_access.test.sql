begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password) values
  ('e1000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'matrix-root@example.test', ''),
  ('e2000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'matrix-member@example.test', ''),
  ('e3000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'matrix-client@example.test', ''),
  ('eb000000-0000-4000-8000-00000000000b', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'matrix-outsider@example.test', '');
insert into public.profiles (id, account_role, first_name) values
  ('e1000000-0000-4000-8000-000000000001', 'trainer', 'Root'),
  ('e2000000-0000-4000-8000-000000000002', 'trainer', 'Member'),
  ('e3000000-0000-4000-8000-000000000003', 'client', 'Client'),
  ('eb000000-0000-4000-8000-00000000000b', 'trainer', 'Outsider');
insert into public.trainers (profile_id) values
  ('e1000000-0000-4000-8000-000000000001'),
  ('e2000000-0000-4000-8000-000000000002'),
  ('eb000000-0000-4000-8000-00000000000b');
insert into public.clients (id, trainer_id, auth_user_id, full_name, gender, age_years, height_cm)
values (
  'e4000000-0000-4000-8000-000000000004',
  'e1000000-0000-4000-8000-000000000001',
  'e3000000-0000-4000-8000-000000000003',
  'Matrix client', 'female', 30, 170
);
insert into public.client_trainers (client_id, trainer_id) values
  ('e4000000-0000-4000-8000-000000000004', 'e1000000-0000-4000-8000-000000000001'),
  ('e4000000-0000-4000-8000-000000000004', 'e2000000-0000-4000-8000-000000000002');
insert into public.workouts (id, trainer_id, client_id, created_by, workout_date, status, completed_at) values
  ('e5000000-0000-4000-8000-000000000005', 'e1000000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-000000000004', 'e1000000-0000-4000-8000-000000000001', current_date, 'planned', null),
  ('e6000000-0000-4000-8000-000000000006', 'e1000000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-000000000004', 'e2000000-0000-4000-8000-000000000002', current_date + 1, 'planned', null),
  ('e7000000-0000-4000-8000-000000000007', 'e1000000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-000000000004', 'e3000000-0000-4000-8000-000000000003', current_date - 1, 'done', now());
insert into public.client_progress (
  id, trainer_id, client_id, created_by, recorded_on, weight_kg
) values
  ('e8000000-0000-4000-8000-000000000008', 'e1000000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-000000000004', 'e1000000-0000-4000-8000-000000000001', current_date, 70),
  ('e9000000-0000-4000-8000-000000000009', 'e1000000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-000000000004', 'e2000000-0000-4000-8000-000000000002', current_date + 1, 69),
  ('ea000000-0000-4000-8000-00000000000a', 'e1000000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-000000000004', 'e3000000-0000-4000-8000-000000000003', current_date + 2, 68);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000001', true);
select is(
  (select count(*) from public.list_workouts(null, null, 'e4000000-0000-4000-8000-000000000004', 50, 0)),
  2::bigint,
  'root trainer lists own and completed client-authored workouts'
);
select is(
  (select total_count from public.list_workouts(null, null, 'e4000000-0000-4000-8000-000000000004', 1, 0)),
  2::bigint,
  'root total count includes completed client history but excludes other trainers'
);
select is((select count(*) from public.workouts where id = 'e5000000-0000-4000-8000-000000000005'), 1::bigint, 'root reads own workout by UUID');
select is((select count(*) from public.workouts where id = 'e6000000-0000-4000-8000-000000000006'), 0::bigint, 'root cannot read member workout by UUID');
select is((select count(*) from public.workouts where id = 'e7000000-0000-4000-8000-000000000007'), 1::bigint, 'root reads completed client workout by UUID');
select throws_ok(
  $$select public.save_workout('{"id":"e7000000-0000-4000-8000-000000000007","clientId":"e4000000-0000-4000-8000-000000000004","workoutDate":"2030-01-01","exercises":[]}', 1)$$,
  'PT403', 'workout_access_denied', 'root cannot edit client-authored workout'
);
select throws_ok(
  $$select public.soft_delete_workout('e7000000-0000-4000-8000-000000000007', 1)$$,
  'PT403', 'workout_access_denied', 'root cannot delete client-authored workout'
);
select is((select count(*) from public.client_progress where client_id = 'e4000000-0000-4000-8000-000000000004'), 3::bigint, 'root reads shared progress');
select lives_ok(
  $$select public.save_progress('{"id":"e8000000-0000-4000-8000-000000000008","clientId":"e4000000-0000-4000-8000-000000000004","recordedOn":"2030-01-01","weightKg":70.5,"customMetrics":[]}', 1)$$,
  'root edits own progress'
);
select throws_ok(
  $$select public.save_progress('{"id":"e9000000-0000-4000-8000-000000000009","clientId":"e4000000-0000-4000-8000-000000000004","recordedOn":"2030-01-02","weightKg":69.5,"customMetrics":[]}', 1)$$,
  'PT403', 'progress_edit_denied', 'root cannot edit member progress'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'e2000000-0000-4000-8000-000000000002', true);
select is(
  (select count(*) from public.list_workouts(null, null, 'e4000000-0000-4000-8000-000000000004', 50, 0)),
  2::bigint,
  'member trainer lists own and completed client-authored workouts'
);
select is(
  (select total_count from public.list_workouts(null, null, 'e4000000-0000-4000-8000-000000000004', 1, 0)),
  2::bigint,
  'member total count includes completed client history but excludes other trainers'
);
select is((select count(*) from public.workouts where id = 'e5000000-0000-4000-8000-000000000005'), 0::bigint, 'member cannot read root workout by UUID');
select is((select count(*) from public.workouts where id = 'e6000000-0000-4000-8000-000000000006'), 1::bigint, 'member reads own workout by UUID');
select is((select count(*) from public.workouts where id = 'e7000000-0000-4000-8000-000000000007'), 1::bigint, 'member reads completed client workout by UUID');
select throws_ok(
  $$select public.start_workout('e7000000-0000-4000-8000-000000000007', 1)$$,
  'PT403', 'workout_access_denied', 'member cannot execute client-authored workout'
);
select is((select count(*) from public.client_progress where client_id = 'e4000000-0000-4000-8000-000000000004'), 3::bigint, 'member reads shared progress');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'eb000000-0000-4000-8000-00000000000b', true);
select is(
  (select count(*) from public.list_workouts(null, null, 'e4000000-0000-4000-8000-000000000004', 50, 0)),
  0::bigint,
  'unconnected trainer cannot list client history'
);
select is((select count(*) from public.workouts where id = 'e7000000-0000-4000-8000-000000000007'), 0::bigint, 'unconnected trainer cannot read client workout by UUID');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'e3000000-0000-4000-8000-000000000003', true);
select is(
  (select count(*) from public.list_workouts(null, null, 'e4000000-0000-4000-8000-000000000004', 50, 0)),
  3::bigint,
  'client lists workouts from both trainers and self'
);
select is(
  (select total_count from public.list_workouts(null, null, 'e4000000-0000-4000-8000-000000000004', 1, 1)),
  3::bigint,
  'client total count is preserved after root pagination'
);
select lives_ok(
  $$select public.save_progress('{"id":"e9000000-0000-4000-8000-000000000009","clientId":"e4000000-0000-4000-8000-000000000004","recordedOn":"2030-01-02","weightKg":69.5,"customMetrics":[]}', 1)$$,
  'client edits progress created by a trainer'
);
reset role;

select * from finish();
rollback;
