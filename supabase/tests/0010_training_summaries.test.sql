begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

select has_table(
  'public',
  'client_training_summaries',
  'training summaries table exists'
);
select col_type_is(
  'public',
  'client_training_summaries',
  'summary',
  'text',
  'training summary is text'
);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password)
values
  ('81000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'trainer-a@example.test', ''),
  ('82000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'trainer-b@example.test', ''),
  ('83000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'client-a@example.test', '');
insert into public.profiles (id) values
  ('81000000-0000-4000-8000-000000000001'),
  ('82000000-0000-4000-8000-000000000002');
insert into public.trainers (profile_id) values
  ('81000000-0000-4000-8000-000000000001'),
  ('82000000-0000-4000-8000-000000000002');
insert into public.clients (
  id,
  trainer_id,
  auth_user_id,
  full_name,
  gender,
  age_years,
  height_cm
) values (
  '84000000-0000-4000-8000-000000000004',
  '81000000-0000-4000-8000-000000000001',
  '83000000-0000-4000-8000-000000000003',
  'Client A',
  'female',
  30,
  170
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '81000000-0000-4000-8000-000000000001', true);
insert into public.client_training_summaries (
  trainer_id,
  client_id,
  period_start,
  period_end,
  summary,
  trainer_summary,
  client_summary,
  model_uri,
  prompt_version,
  input_fingerprint
) values (
  '81000000-0000-4000-8000-000000000001',
  '84000000-0000-4000-8000-000000000004',
  '2026-07-01',
  '2026-07-31',
  'Progress summary',
  '{"headline":"Progress summary","progress":["Progress"],"consistency":"Mixed","attention":[]}',
  '{"headline":"Progress summary","achievements":["Progress"],"consistency":"Mixed","encouragement":"Keep going"}',
  'gpt://folder/yandexgpt-lite/latest',
  'training-summary-v1',
  'fingerprint'
);
select is(
  (select count(*) from public.client_training_summaries),
  1::bigint,
  'trainer sees own summary'
);
select lives_ok(
  $$update public.client_training_summaries set summary = 'Updated summary'$$,
  'trainer can update own summary'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '82000000-0000-4000-8000-000000000002', true);
select is(
  (select count(*) from public.client_training_summaries),
  0::bigint,
  'other trainer cannot read summary'
);
select throws_ok(
  $$insert into public.client_training_summaries (
    trainer_id,
    client_id,
    period_start,
    period_end,
    summary,
    trainer_summary,
    client_summary,
    model_uri,
    prompt_version,
    input_fingerprint
  ) values (
    '82000000-0000-4000-8000-000000000002',
    '84000000-0000-4000-8000-000000000004',
    '2026-07-01',
    '2026-07-31',
    'Forbidden summary',
    '{"headline":"Forbidden","progress":["Progress"],"consistency":"Mixed","attention":[]}',
    '{"headline":"Forbidden","achievements":["Progress"],"consistency":"Mixed","encouragement":"Keep going"}',
    'gpt://folder/yandexgpt-lite/latest',
    'training-summary-v1',
    'fingerprint'
  )$$,
  '42501',
  'new row violates row-level security policy for table "client_training_summaries"',
  'other trainer cannot insert summary for client'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '83000000-0000-4000-8000-000000000003', true);
select is(
  (select count(*) from public.client_training_summaries),
  0::bigint,
  'linked client cannot read internal trainer summary'
);
update public.client_training_summaries set summary = 'Client edit';
select is(
  (select count(*) from public.client_training_summaries),
  0::bigint,
  'linked client update changes no rows'
);
select throws_ok(
  $$insert into public.client_training_summaries (
    trainer_id,
    client_id,
    period_start,
    period_end,
    summary,
    trainer_summary,
    client_summary,
    model_uri,
    prompt_version,
    input_fingerprint
  ) values (
    '81000000-0000-4000-8000-000000000001',
    '84000000-0000-4000-8000-000000000004',
    '2026-06-01',
    '2026-06-30',
    'Client-created summary',
    '{"headline":"Client-created","progress":["Progress"],"consistency":"Mixed","attention":[]}',
    '{"headline":"Client-created","achievements":["Progress"],"consistency":"Mixed","encouragement":"Keep going"}',
    'gpt://folder/yandexgpt-lite/latest',
    'training-summary-v1',
    'fingerprint'
  )$$,
  '42501',
  'new row violates row-level security policy for table "client_training_summaries"',
  'linked client cannot insert summary'
);
reset role;

set local role anon;
select throws_ok(
  'select * from public.client_training_summaries',
  '42501',
  'permission denied for table client_training_summaries',
  'anon cannot read summaries'
);
reset role;

select throws_ok(
  $$insert into public.client_training_summaries (
    trainer_id,
    client_id,
    period_start,
    period_end,
    summary,
    trainer_summary,
    client_summary,
    model_uri,
    prompt_version,
    input_fingerprint
  ) values (
    '81000000-0000-4000-8000-000000000001',
    '84000000-0000-4000-8000-000000000004',
    '2026-08-02',
    '2026-08-01',
    'Invalid period',
    '{"headline":"Invalid","progress":["Progress"],"consistency":"Mixed","attention":[]}',
    '{"headline":"Invalid","achievements":["Progress"],"consistency":"Mixed","encouragement":"Keep going"}',
    'gpt://folder/yandexgpt-lite/latest',
    'training-summary-v1',
    'fingerprint'
  )$$,
  '23514',
  'new row for relation "client_training_summaries" violates check constraint "client_training_summaries_period_order"',
  'period order is enforced'
);

select * from finish();
rollback;
