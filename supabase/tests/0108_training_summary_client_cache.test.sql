begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password) values
  ('a8000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cache-trainer@example.test', ''),
  ('a8000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cache-client@example.test', '');
insert into public.profiles (id, account_role) values
  ('a8000000-0000-4000-8000-000000000001', 'trainer');
insert into public.trainers (profile_id) values
  ('a8000000-0000-4000-8000-000000000001');
insert into public.clients (id, trainer_id, auth_user_id, full_name, gender, age_years, height_cm) values
  ('a8000000-0000-4000-8000-000000000010', 'a8000000-0000-4000-8000-000000000001',
   'a8000000-0000-4000-8000-000000000002', 'Cache Client', 'male', 30, 180);
insert into public.client_training_summaries (
  id, trainer_id, client_id, period_start, period_end, summary,
  trainer_summary, client_summary, display_metrics, model_uri,
  prompt_version, input_fingerprint
) values (
  'a8000000-0000-4000-8000-000000000020', 'a8000000-0000-4000-8000-000000000001',
  'a8000000-0000-4000-8000-000000000010', '2026-08-01', '2026-08-31', 'Trainer only',
  '{"headline":"Trainer secret","progress":["Private"],"consistency":"ok","attention":[]}',
  '{"headline":"Client result","achievements":["Done"],"consistency":"ok","encouragement":"Keep going","goalAlignment":"On track","nextSteps":["Continue"],"analysisVersion":"v1","inputFingerprint":"shared-fp"}',
  '{"completed_workouts":3}', 'model://summary', 'training-progress-v13', 'shared-fp'
);

select ok(
  not has_function_privilege('authenticated', 'public.publish_cached_training_summary_for_client(uuid,date,date,text,text)', 'EXECUTE'),
  'browser actors cannot publish an internal cache directly'
);

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);

select is(
  public.publish_cached_training_summary_for_client(
    'a8000000-0000-4000-8000-000000000010', '2026-08-01', '2026-08-31',
    'training-progress-v13', 'shared-fp'
  ) #>> '{summary,headline}',
  'Client result',
  'the existing client-facing result is published without a model call'
);
select is(
  (select count(*) from public.client_published_training_summaries where client_id = 'a8000000-0000-4000-8000-000000000010'),
  1::bigint,
  'one published cache row is created'
);
select ok(
  not (public.publish_cached_training_summary_for_client(
    'a8000000-0000-4000-8000-000000000010', '2026-08-01', '2026-08-31',
    'training-progress-v13', 'shared-fp'
  ) ? 'trainer_summary'),
  'the client response never contains the trainer summary'
);
select is(
  public.publish_cached_training_summary_for_client(
    'a8000000-0000-4000-8000-000000000010', '2026-08-01', '2026-08-31',
    'training-progress-v13', 'different-fingerprint'
  ),
  null::jsonb,
  'a different source fingerprint is not reused'
);

reset role;
select * from finish();
rollback;
