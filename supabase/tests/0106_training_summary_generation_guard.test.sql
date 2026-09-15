begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password) values
  ('a6000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'guard-trainer@example.test', '');
insert into public.profiles (id, account_role) values
  ('a6000000-0000-4000-8000-000000000001', 'trainer');
insert into public.trainers (profile_id) values
  ('a6000000-0000-4000-8000-000000000001');
insert into public.clients (id, trainer_id, full_name, gender, age_years, height_cm) values
  ('a6000000-0000-4000-8000-000000000010', 'a6000000-0000-4000-8000-000000000001', 'Guard Client', 'male', 30, 180),
  ('a6000000-0000-4000-8000-000000000011', 'a6000000-0000-4000-8000-000000000001', 'Lease Client', 'female', 30, 170);

select has_table('app_private', 'training_summary_generation_guards', 'generation guard table exists');
select ok(not has_table_privilege('authenticated', 'app_private.training_summary_generation_guards', 'SELECT'),
  'raw generation state is not exposed');
select ok(not has_function_privilege('authenticated', 'public.claim_training_summary_generation(uuid,date,date,text,uuid,integer,integer)', 'EXECUTE'),
  'browser actors cannot call the generation guard directly');
select ok(not has_function_privilege('anon', 'public.claim_training_summary_generation(uuid,date,date,text,uuid,integer,integer)', 'EXECUTE'),
  'anonymous actors cannot call the generation guard directly');
select ok(has_function_privilege('service_role', 'public.claim_training_summary_generation(uuid,date,date,text,uuid,integer,integer)', 'EXECUTE'),
  'service role can claim generation');
select ok(has_function_privilege('service_role', 'public.complete_training_summary_generation(uuid,date,date,text,uuid,jsonb)', 'EXECUTE'),
  'service role can complete generation');
select ok(has_function_privilege('service_role', 'public.fail_training_summary_generation(uuid,date,date,text,uuid,text,jsonb)', 'EXECUTE'),
  'service role can record generation failure');

set local role authenticated;
select throws_ok(
  $$select public.claim_training_summary_generation('a6000000-0000-4000-8000-000000000010', '2026-09-01', '2026-09-30', 'forbidden', 'a6000000-0000-4000-8000-000000000100', 1, 1)$$,
  '42501', null, 'authenticated role cannot execute the backend-only guard'
);
reset role;

set local role service_role;

select is(
  public.claim_training_summary_generation('a6000000-0000-4000-8000-000000000010', '2026-09-01', '2026-09-30', 'fp-1', 'a6000000-0000-4000-8000-000000000101', 100000, 18000)->>'decision',
  'claimed', 'first fingerprint claims a paid slot'
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
  'cooldown', 'a changed fingerprint cannot bypass the period cooldown'
);

reset role;
update app_private.training_summary_generation_guards
set retry_after = now() - interval '1 second'
where client_id = 'a6000000-0000-4000-8000-000000000010'
  and period_start = '2026-09-01' and period_end = '2026-09-30';
set local role service_role;

select is(
  public.claim_training_summary_generation('a6000000-0000-4000-8000-000000000010', '2026-09-01', '2026-09-30', 'fp-1', 'a6000000-0000-4000-8000-000000000103', 100000, 18000)->>'decision',
  'claimed', 'a failed attempt can retry after the cooldown'
);
reset role;
select is(
  (select sum(model_calls_today)::integer
   from app_private.training_summary_generation_guards
   where client_id = 'a6000000-0000-4000-8000-000000000010'),
  2, 'the failed attempt still counts towards the client daily budget'
);
set local role service_role;
select ok(
  public.complete_training_summary_generation('a6000000-0000-4000-8000-000000000010', '2026-09-01', '2026-09-30', 'fp-1', 'a6000000-0000-4000-8000-000000000103', '{"totalTokens":"7500"}'),
  'successful call is recorded'
);
select is(
  public.claim_training_summary_generation('a6000000-0000-4000-8000-000000000010', '2026-09-01', '2026-09-30', 'fp-1', 'a6000000-0000-4000-8000-000000000105', 100000, 18000)->>'decision',
  'cached', 'successful identical input never reaches the model again'
);
select is(
  public.claim_training_summary_generation('a6000000-0000-4000-8000-000000000010', '2026-09-01', '2026-09-30', 'fp-2', 'a6000000-0000-4000-8000-000000000106', 100000, 18000)->>'decision',
  'claimed', 'changed source data can use the remaining daily budget'
);

reset role;
insert into app_private.training_summary_generation_guards (
  client_id, period_start, period_end, input_fingerprint, status,
  owner_request_id, lease_until, model_calls_today
) values (
  'a6000000-0000-4000-8000-000000000011', '2026-07-01', '2026-09-30',
  'stale-fp', 'pending', 'a6000000-0000-4000-8000-000000000108',
  now() - interval '1 second', 0
);
set local role service_role;

select is(
  public.claim_training_summary_generation('a6000000-0000-4000-8000-000000000011', '2026-07-01', '2026-09-30', 'fp-3', 'a6000000-0000-4000-8000-000000000106', 100000, 18000)->>'decision',
  'claimed', 'an expired pending lease does not block a new analysis'
);
select is(
  public.claim_training_summary_generation('a6000000-0000-4000-8000-000000000010', '2026-04-01', '2026-09-30', 'fp-4', 'a6000000-0000-4000-8000-000000000107', 100000, 18000)->>'decision',
  'daily_limit', 'fourth paid analysis for the client is blocked for the UTC day'
);

reset role;
select * from finish();
rollback;
