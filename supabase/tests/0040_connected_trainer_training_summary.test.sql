begin;
create extension if not exists pgtap with schema extensions;
select plan(3);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password)
values
  ('aa000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'summary-root@example.test', ''),
  ('aa000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000000', 'authenticated', 'authenticated', 'summary-connected@example.test', ''),
  ('aa000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000000', 'authenticated', 'authenticated', 'summary-foreign@example.test', '');
insert into public.profiles (id, account_role, first_name)
values
  ('aa000000-0000-4000-8000-000000000001', 'trainer', 'Root trainer'),
  ('aa000000-0000-4000-8000-000000000002', 'trainer', 'Connected trainer'),
  ('aa000000-0000-4000-8000-000000000003', 'trainer', 'Foreign trainer');
insert into public.trainers (profile_id)
values
  ('aa000000-0000-4000-8000-000000000001'),
  ('aa000000-0000-4000-8000-000000000002'),
  ('aa000000-0000-4000-8000-000000000003');
insert into public.clients (id, trainer_id, full_name, gender, age_years, height_cm)
values ('aa000000-0000-4000-8000-000000000004', 'aa000000-0000-4000-8000-000000000001', 'Summary client', 'female', 30, 170);
insert into public.client_trainers (client_id, trainer_id)
values
  ('aa000000-0000-4000-8000-000000000004', 'aa000000-0000-4000-8000-000000000001'),
  ('aa000000-0000-4000-8000-000000000004', 'aa000000-0000-4000-8000-000000000002');
insert into public.client_training_summaries (
  id, trainer_id, client_id, period_start, period_end, summary, trainer_summary,
  client_summary, display_metrics, model_uri, prompt_version, input_fingerprint
) values (
  'aa000000-0000-4000-8000-000000000005',
  'aa000000-0000-4000-8000-000000000001',
  'aa000000-0000-4000-8000-000000000004',
  current_date - 7, current_date,
  'Root summary',
  '{"headline":"Root","progress":[],"consistency":"ok","attention":[]}'::jsonb,
  '{"headline":"Client","achievements":[],"consistency":"ok","encouragement":"ok"}'::jsonb,
  '{}'::jsonb, 'model://summary', 'v1', 'summary-fingerprint'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'aa000000-0000-4000-8000-000000000001', true);
select is(
  (select count(*) from public.client_training_summaries where client_id = 'aa000000-0000-4000-8000-000000000004'),
  1::bigint,
  'root trainer can read the client summary'
);

select set_config('request.jwt.claim.sub', 'aa000000-0000-4000-8000-000000000002', true);
select is(
  (select count(*) from public.client_training_summaries where client_id = 'aa000000-0000-4000-8000-000000000004'),
  1::bigint,
  'connected trainer can read the shared client summary'
);

select set_config('request.jwt.claim.sub', 'aa000000-0000-4000-8000-000000000003', true);
select is(
  (select count(*) from public.client_training_summaries where client_id = 'aa000000-0000-4000-8000-000000000004'),
  0::bigint,
  'foreign trainer cannot read the client summary'
);

reset role;
select * from finish();
rollback;
