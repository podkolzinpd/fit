begin;
create extension if not exists pgtap with schema extensions;
select plan(37);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password) values
  ('63000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'attach-trainer@example.test', ''),
  ('63000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'attach-client@example.test', ''),
  ('63000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'attach-conflict-client@example.test', '');
insert into public.profiles (id, account_role, first_name) values
  ('63000000-0000-4000-8000-000000000001', 'trainer', 'Trainer'),
  ('63000000-0000-4000-8000-000000000002', 'client', 'Client'),
  ('63000000-0000-4000-8000-000000000003', 'client', 'Conflict');
insert into public.trainers (profile_id)
values ('63000000-0000-4000-8000-000000000001');

-- Каноническая самостоятельная карточка и предварительная карточка тренера.
insert into public.clients (id, trainer_id, auth_user_id, full_name) values
  ('63000000-0000-4000-8000-000000000010', '63000000-0000-4000-8000-000000000002', '63000000-0000-4000-8000-000000000002', 'Canonical client'),
  ('63000000-0000-4000-8000-000000000011', '63000000-0000-4000-8000-000000000001', null, 'Trainer card');
insert into public.client_trainers (client_id, trainer_id, alias, note)
values ('63000000-0000-4000-8000-000000000011', '63000000-0000-4000-8000-000000000001', 'Athlete alias', 'Private trainer note');

insert into public.custom_exercises (id, trainer_id, created_by, name, muscle_group, input_kind)
values ('63000000-0000-4000-8000-000000000020', '63000000-0000-4000-8000-000000000001', '63000000-0000-4000-8000-000000000001', 'Custom press', 'chest', 'strength');
insert into public.workouts (
  id, trainer_id, client_id, created_by, updated_by, workout_date,
  status, started_at, completed_at
) values
  (
    '63000000-0000-4000-8000-000000000030', '63000000-0000-4000-8000-000000000002',
    '63000000-0000-4000-8000-000000000010', '63000000-0000-4000-8000-000000000002',
    '63000000-0000-4000-8000-000000000002', '2026-08-01', 'done',
    '2026-08-01 10:00+00', '2026-08-01 11:00+00'
  ),
  (
    '63000000-0000-4000-8000-000000000031', '63000000-0000-4000-8000-000000000001',
    '63000000-0000-4000-8000-000000000011', '63000000-0000-4000-8000-000000000001',
    '63000000-0000-4000-8000-000000000001', '2026-08-02', 'done',
    '2026-08-02 10:00+00', '2026-08-02 11:00+00'
  );
insert into public.workout_exercises (
  id, workout_id, trainer_id, client_id, position, exercise_source,
  exercise_ref, custom_exercise_id, exercise_name, muscle_group, input_kind, updated_by
) values (
  '63000000-0000-4000-8000-000000000032', '63000000-0000-4000-8000-000000000031',
  '63000000-0000-4000-8000-000000000001', '63000000-0000-4000-8000-000000000011', 0, 'custom',
  'custom:63000000-0000-4000-8000-000000000020', '63000000-0000-4000-8000-000000000020',
  'Custom press', 'chest', 'strength', '63000000-0000-4000-8000-000000000001'
);
insert into public.workout_sets (
  id, workout_exercise_id, trainer_id, client_id, position,
  fact_weight_kg, fact_reps, confirmed_at, updated_by
) values (
  '63000000-0000-4000-8000-000000000033', '63000000-0000-4000-8000-000000000032',
  '63000000-0000-4000-8000-000000000001', '63000000-0000-4000-8000-000000000011', 0,
  20, 10, '2026-08-02 10:00+00', '63000000-0000-4000-8000-000000000001'
);

insert into public.client_progress (
  id, trainer_id, client_id, recorded_on, weight_kg, created_by, updated_by
) values (
  '63000000-0000-4000-8000-000000000040', '63000000-0000-4000-8000-000000000001',
  '63000000-0000-4000-8000-000000000011', '2026-08-02', 70,
  '63000000-0000-4000-8000-000000000001', '63000000-0000-4000-8000-000000000001'
);
insert into public.client_custom_metrics (id, trainer_id, client_id, name, unit)
values ('63000000-0000-4000-8000-000000000041', '63000000-0000-4000-8000-000000000001', '63000000-0000-4000-8000-000000000011', 'Jump', 'cm');
insert into public.client_progress_custom (id, trainer_id, client_id, progress_id, metric_id, value)
values (
  '63000000-0000-4000-8000-000000000042', '63000000-0000-4000-8000-000000000001',
  '63000000-0000-4000-8000-000000000011', '63000000-0000-4000-8000-000000000040',
  '63000000-0000-4000-8000-000000000041', 50
);

insert into public.client_goals (id, client_id, trainer_id, created_by, title)
values ('63000000-0000-4000-8000-000000000050', '63000000-0000-4000-8000-000000000011', '63000000-0000-4000-8000-000000000001', '63000000-0000-4000-8000-000000000001', 'Get stronger');
insert into public.goal_stages (id, goal_id, trainer_id, client_id, title, starts_on, ends_on)
values ('63000000-0000-4000-8000-000000000051', '63000000-0000-4000-8000-000000000050', '63000000-0000-4000-8000-000000000001', '63000000-0000-4000-8000-000000000011', 'Base', '2026-08-01', '2026-08-31');

insert into public.client_training_summaries (
  id, trainer_id, client_id, period_start, period_end, summary,
  trainer_summary, client_summary, model_uri, prompt_version, input_fingerprint
) values (
  '63000000-0000-4000-8000-000000000060', '63000000-0000-4000-8000-000000000001',
  '63000000-0000-4000-8000-000000000011', '2026-08-01', '2026-08-31', 'Summary',
  '{"headline":"Trainer","progress":[],"consistency":"Stable","attention":[]}',
  '{"headline":"Client","achievements":[],"consistency":"Stable","encouragement":"Keep going","goalAlignment":"On track","nextSteps":[]}',
  'model', 'v1', 'attach-fingerprint'
);
insert into public.client_published_training_summaries (
  id, source_summary_id, trainer_id, client_id, period_start, period_end,
  summary, generated_at, published_by
) values (
  '63000000-0000-4000-8000-000000000061', '63000000-0000-4000-8000-000000000060',
  '63000000-0000-4000-8000-000000000001', '63000000-0000-4000-8000-000000000011',
  '2026-08-01', '2026-08-31',
  '{"headline":"Published","achievements":[],"consistency":"Stable","encouragement":"Keep going","goalAlignment":"On track","nextSteps":[]}',
  '2026-08-31 10:00+00',
  '63000000-0000-4000-8000-000000000001'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '63000000-0000-4000-8000-000000000001', true);
create temporary table attach_code as
select public.create_client_invitation('63000000-0000-4000-8000-000000000011', 'client') code;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '63000000-0000-4000-8000-000000000002', true);
select is(
  public.claim_client_invitation((select code from attach_code)),
  '63000000-0000-4000-8000-000000000010'::uuid,
  'standalone client remains the canonical card'
);
reset role;

select is((select merged_into_client_id from public.clients where id = '63000000-0000-4000-8000-000000000011'), '63000000-0000-4000-8000-000000000010'::uuid, 'source card redirects to canonical card');
select ok((select archived_at is not null from public.clients where id = '63000000-0000-4000-8000-000000000011'), 'source card is archived without deletion');
select is((select auth_user_id from public.clients where id = '63000000-0000-4000-8000-000000000010'), '63000000-0000-4000-8000-000000000002'::uuid, 'canonical owner is unchanged');
select is((select trainer_id from public.client_trainer_relationships where client_id = '63000000-0000-4000-8000-000000000010' and status = 'active'), '63000000-0000-4000-8000-000000000001'::uuid, 'active trainer relation is created');
select is((select note from public.client_trainers where client_id = '63000000-0000-4000-8000-000000000010' and trainer_id = '63000000-0000-4000-8000-000000000001'), 'Private trainer note', 'trainer private note follows the membership');
select is((select claimed_by from public.client_invitations where client_id = '63000000-0000-4000-8000-000000000011'), '63000000-0000-4000-8000-000000000002'::uuid, 'invitation is claimed by the client');

select is((select client_id from public.workouts where id = '63000000-0000-4000-8000-000000000031'), '63000000-0000-4000-8000-000000000010'::uuid, 'workout moves to the canonical card');
select is((select trainer_id from public.workouts where id = '63000000-0000-4000-8000-000000000031'), '63000000-0000-4000-8000-000000000002'::uuid, 'workout moves to the canonical data partition');
select is((select created_by from public.workouts where id = '63000000-0000-4000-8000-000000000031'), '63000000-0000-4000-8000-000000000001'::uuid, 'workout authorship is preserved');
select is((select updated_by from public.workout_sets where id = '63000000-0000-4000-8000-000000000033'), '63000000-0000-4000-8000-000000000001'::uuid, 'set authorship is preserved');
select is((select trainer_id from public.custom_exercises where id = '63000000-0000-4000-8000-000000000020'), '63000000-0000-4000-8000-000000000001'::uuid, 'trainer custom exercise remains in the trainer catalog');
select is((select exercise_source from public.workout_exercises where id = '63000000-0000-4000-8000-000000000032'), 'system', 'moved custom exercise becomes a self-contained snapshot');
select is((select exercise_ref from public.workout_exercises where id = '63000000-0000-4000-8000-000000000032'), 'snapshot:custom:63000000-0000-4000-8000-000000000020', 'snapshot keeps a stable source reference');
select ok((select custom_exercise_id is null from public.workout_exercises where id = '63000000-0000-4000-8000-000000000032'), 'snapshot no longer depends on the trainer catalog');
select is((select exercise_name from public.workout_exercises where id = '63000000-0000-4000-8000-000000000032'), 'Custom press', 'snapshot keeps the exercise name');

select is((select client_id from public.client_progress where id = '63000000-0000-4000-8000-000000000040'), '63000000-0000-4000-8000-000000000010'::uuid, 'progress moves to the canonical card');
select is((select created_by from public.client_progress where id = '63000000-0000-4000-8000-000000000040'), '63000000-0000-4000-8000-000000000001'::uuid, 'progress authorship is preserved');
select is((select client_id from public.client_custom_metrics where id = '63000000-0000-4000-8000-000000000041'), '63000000-0000-4000-8000-000000000010'::uuid, 'custom metric moves to the canonical card');
select is((select client_id from public.client_progress_custom where id = '63000000-0000-4000-8000-000000000042'), '63000000-0000-4000-8000-000000000010'::uuid, 'custom metric value moves to the canonical card');
select is((select client_id from public.client_goals where id = '63000000-0000-4000-8000-000000000050'), '63000000-0000-4000-8000-000000000010'::uuid, 'goal moves to the canonical card');
select is((select created_by from public.client_goals where id = '63000000-0000-4000-8000-000000000050'), '63000000-0000-4000-8000-000000000001'::uuid, 'goal authorship is preserved');
select is((select client_id from public.goal_stages where id = '63000000-0000-4000-8000-000000000051'), '63000000-0000-4000-8000-000000000010'::uuid, 'goal stage moves to the canonical card');
select is((select client_id from public.client_training_summaries where id = '63000000-0000-4000-8000-000000000060'), '63000000-0000-4000-8000-000000000010'::uuid, 'training summary moves to the canonical card');
select is((select client_id from public.client_published_training_summaries where id = '63000000-0000-4000-8000-000000000061'), '63000000-0000-4000-8000-000000000010'::uuid, 'published summary moves to the canonical card');
select is((select published_by from public.client_published_training_summaries where id = '63000000-0000-4000-8000-000000000061'), '63000000-0000-4000-8000-000000000001'::uuid, 'published summary authorship is preserved');

select is((select dependency_counts_after->'source'->>'workouts' from public.client_merge_operations where source_client_id = '63000000-0000-4000-8000-000000000011'), '0', 'source dependency count is zero after merge');
select is((select dependency_counts_before->'source'->>'workouts' from public.client_merge_operations where source_client_id = '63000000-0000-4000-8000-000000000011'), '1', 'merge audit stores exact source count before merge');
select is((select dependency_counts_after->'target'->>'workouts' from public.client_merge_operations where source_client_id = '63000000-0000-4000-8000-000000000011'), '2', 'merge audit stores exact target count after merge');

set local role authenticated;
select set_config('request.jwt.claim.sub', '63000000-0000-4000-8000-000000000002', true);
select is(public.claim_client_invitation((select code from attach_code)), '63000000-0000-4000-8000-000000000010'::uuid, 'repeating the same code is idempotent');
reset role;
select is((select count(*) from public.client_merge_operations where source_client_id = '63000000-0000-4000-8000-000000000011'), 1::bigint, 'idempotent retry does not duplicate the merge');
select throws_ok(
  $$update public.workouts
    set client_id = '63000000-0000-4000-8000-000000000011'
    where id = '63000000-0000-4000-8000-000000000030'$$,
  'PT403', 'workout_client_immutable', 'ordinary workout reassignment remains blocked'
);

-- Коллизия не должна оставлять частично перенесённые данные.
insert into public.clients (id, trainer_id, auth_user_id, full_name) values
  ('63000000-0000-4000-8000-000000000070', '63000000-0000-4000-8000-000000000003', '63000000-0000-4000-8000-000000000003', 'Conflict canonical'),
  ('63000000-0000-4000-8000-000000000071', '63000000-0000-4000-8000-000000000001', null, 'Conflict source');
insert into public.client_trainers (client_id, trainer_id)
values ('63000000-0000-4000-8000-000000000071', '63000000-0000-4000-8000-000000000001');
insert into public.client_progress (trainer_id, client_id, recorded_on, weight_kg) values
  ('63000000-0000-4000-8000-000000000003', '63000000-0000-4000-8000-000000000070', '2026-08-05', 60),
  ('63000000-0000-4000-8000-000000000001', '63000000-0000-4000-8000-000000000071', '2026-08-05', 61);
set local role authenticated;
select set_config('request.jwt.claim.sub', '63000000-0000-4000-8000-000000000001', true);
create temporary table conflict_code as
select public.create_client_invitation('63000000-0000-4000-8000-000000000071', 'client') code;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '63000000-0000-4000-8000-000000000003', true);
select throws_ok(
  $$select public.claim_client_invitation((select code from conflict_code))$$,
  'PT409', 'client_merge_progress_conflict', 'ambiguous progress conflict rejects the whole merge'
);
reset role;
select ok((select archived_at is null from public.clients where id = '63000000-0000-4000-8000-000000000071'), 'failed merge keeps the source active');
select ok((select claimed_at is null from public.client_invitations where client_id = '63000000-0000-4000-8000-000000000071'), 'failed merge keeps the invitation usable');
select is((select count(*) from public.client_progress where client_id = '63000000-0000-4000-8000-000000000071'), 1::bigint, 'failed merge keeps source data in place');
select is((select count(*) from public.client_merge_operations where source_client_id = '63000000-0000-4000-8000-000000000071'), 0::bigint, 'failed merge leaves no partial audit row');

select * from finish();
rollback;
