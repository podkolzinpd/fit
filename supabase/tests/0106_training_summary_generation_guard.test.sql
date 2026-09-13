begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password) values
  ('a6000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'guard-trainer@example.test', '');
insert into public.profiles (id, account_role) values
  ('a6000000-0000-4000-8000-000000000001', 'trainer');
insert into public.trainers (profile_id) values
  ('a6000000-0000-4000-8000-000000000001');
insert into public.clients (id, trainer_id, full_name, gender, age_years, height_cm) values
  ('a6000000-0000-4000-8000-000000000010', 'a6000000-0000-4000-8000-000000000001', 'Guard Client', 'male', 30, 180);

select has_table('app_private', 'training_summary_generation_guards', 'generation guard table exists');
select ok(not has_table_privilege('authenticated', 'app_private.training_summary_generation_guards', 'SELECT'),
  'raw generation state is not exposed');
select ok(not has_function_privilege('authenticated', 'public.claim_training_summary_generation(uuid,date,date,text,uuid,integer,integer)', 'EXECUTE'),
  'browser actors cannot call the generation guard directly');

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);

select is(
  public.claim_training_summary_generation('a6000000-0000-4000-8000-000000000010', '2026-09-01', '2026-09-30', 'fp-1', 'a6000000-0000-4000-8000-000000000101', 100000, 18000)->>'decision',
  'claimed', 'first fingerprint gets the only paid slot'
);
select is(
  public.claim_training_summary_generation('a6000000-0000-4000-8000-000000000010', '2026-09-01', '2026-09-30', 'fp-1', 'a6000000-0000-4000-8000-000000000102', 100000, 18000)->>'decision',
  'in_progress', 'a concurrent duplicate is stopped before the model'
);
select ok(
  public.fail_training_summary_generation('a6000000-0000-4000-8000-000000000010', '2026-09-01', '2026-09-30', 'fp-1', 'a6000000-0000-4000-8000-000000000101', 'quality_failed', '{"totalTokens":"9000"}'),
  'failed call is recorded'
);
select is(
  public.claim_training_summary_generation('a6000000-0000-4000-8000-000000000010', '2026-09-01', '2026-09-30', 'fp-1', 'a6000000-0000-4000-8000-000000000103', 100000, 18000)->>'decision',
  'cooldown', 'same failed fingerprint is cached for thirty minutes'
);
select is(
  public.claim_training_summary_generation('a6000000-0000-4000-8000-000000000010', '2026-09-01', '2026-09-30', 'fp-2', 'a6000000-0000-4000-8000-000000000104', 100000, 18000)->>'decision',
  'period_limit', 'a changed fingerprint cannot spend twice for one period on the same day'
);
select is(
  public.claim_training_summary_generation('a6000000-0000-4000-8000-000000000010', '2026-07-01', '2026-09-30', 'fp-2', 'a6000000-0000-4000-8000-000000000104', 100000, 18000)->>'decision',
  'claimed', 'changed source fingerprint can generate'
);
select ok(
  public.complete_training_summary_generation('a6000000-0000-4000-8000-000000000010', '2026-07-01', '2026-09-30', 'fp-2', 'a6000000-0000-4000-8000-000000000104', '{"totalTokens":"7500"}'),
  'successful call is recorded'
);
select is(
  public.claim_training_summary_generation('a6000000-0000-4000-8000-000000000010', '2026-07-01', '2026-09-30', 'fp-2', 'a6000000-0000-4000-8000-000000000105', 100000, 18000)->>'decision',
  'cached', 'successful identical input never reaches the model again'
);
select is(
  public.claim_training_summary_generation('a6000000-0000-4000-8000-000000000010', '2026-04-01', '2026-09-30', 'fp-3', 'a6000000-0000-4000-8000-000000000106', 100000, 18000)->>'decision',
  'claimed', 'third changed fingerprint is allowed'
);
select is(
  public.claim_training_summary_generation('a6000000-0000-4000-8000-000000000010', '2026-01-01', '2026-09-30', 'fp-4', 'a6000000-0000-4000-8000-000000000107', 100000, 18000)->>'decision',
  'daily_limit', 'fourth paid analysis for the client is blocked for the UTC day'
);

reset role;
select * from finish();
rollback;
