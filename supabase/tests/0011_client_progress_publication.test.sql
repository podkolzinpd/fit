begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password)
values
  ('85000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'publication-trainer@example.test', ''),
  ('85000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'publication-client@example.test', ''),
  ('85000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'other-client@example.test', '');

insert into public.profiles (id)
values ('85000000-0000-4000-8000-000000000001');
insert into public.trainers (profile_id)
values ('85000000-0000-4000-8000-000000000001');
insert into public.clients (
  id,
  trainer_id,
  auth_user_id,
  full_name,
  gender,
  age_years,
  height_cm
) values (
  '85000000-0000-4000-8000-000000000004',
  '85000000-0000-4000-8000-000000000001',
  '85000000-0000-4000-8000-000000000002',
  'Publication Client',
  'female',
  30,
  170
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '85000000-0000-4000-8000-000000000001', true);
insert into public.client_training_summaries (
  id,
  trainer_id,
  client_id,
  period_start,
  period_end,
  summary,
  trainer_summary,
  client_summary,
  display_metrics,
  model_uri,
  prompt_version,
  input_fingerprint
) values (
  '85000000-0000-4000-8000-000000000005',
  '85000000-0000-4000-8000-000000000001',
  '85000000-0000-4000-8000-000000000004',
  '2026-01-01',
  '2026-06-30',
  'Internal trainer summary',
  '{"headline":"Internal","progress":["Progress"],"consistency":"Mixed","attention":["Check gap"]}',
  '{"headline":"Client draft","achievements":["Achievement"],"consistency":"Good","encouragement":"Keep going"}',
  '{"completed_workouts":24,"workouts_per_week":0.9,"longest_gap_days":21}',
  'gpt://folder/yandexgpt-lite/latest',
  'training-progress-v3',
  'publication-fingerprint'
);

select is(
  (select count(*) from public.client_training_summaries),
  1::bigint,
  'trainer can read internal summary'
);
select is(
  (select count(*) from public.client_published_training_summaries),
  0::bigint,
  'draft is not published automatically'
);
select lives_ok(
  $$select * from public.publish_training_summary(
    '85000000-0000-4000-8000-000000000005',
    '{"headline":"Shared","achievements":["Achievement"],"consistency":"Good","encouragement":"Keep going"}',
    1
  )$$,
  'trainer can publish client version'
);
select is(
  (select count(*) from public.client_published_training_summaries),
  1::bigint,
  'trainer sees published summary'
);
select is(
  (
    select summary->>'headline'
    from public.client_published_training_summaries
  ),
  'Shared',
  'published summary contains reviewed client copy'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '85000000-0000-4000-8000-000000000002', true);
select is(
  (select count(*) from public.client_training_summaries),
  0::bigint,
  'client cannot read internal summary after publication'
);
select is(
  (select count(*) from public.client_published_training_summaries),
  1::bigint,
  'linked client can read published summary'
);
select is(
  (
    select summary->>'headline'
    from public.client_published_training_summaries
  ),
  'Shared',
  'client reads only the reviewed client copy'
);
select throws_ok(
  $$select * from public.publish_training_summary(
    '85000000-0000-4000-8000-000000000005',
    '{"headline":"Tampered","achievements":[],"consistency":"","encouragement":""}',
    2
  )$$,
  'PT404',
  'training_summary_not_found',
  'client cannot publish a summary'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '85000000-0000-4000-8000-000000000003', true);
select is(
  (select count(*) from public.client_published_training_summaries),
  0::bigint,
  'another client cannot read the publication'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '85000000-0000-4000-8000-000000000001', true);
select is(
  public.unpublish_training_summary(
    '85000000-0000-4000-8000-000000000005',
    2
  ),
  3::bigint,
  'trainer can unpublish with optimistic concurrency'
);
select is(
  (select count(*) from public.client_published_training_summaries),
  0::bigint,
  'publication is removed'
);
select throws_ok(
  $$select public.unpublish_training_summary(
    '85000000-0000-4000-8000-000000000005',
    2
  )$$,
  'PT409',
  'training_summary_conflict',
  'stale unpublish is rejected'
);
reset role;

select * from finish();
rollback;
