begin;
create extension if not exists pgtap with schema extensions;
select plan(2);

insert into public.workouts (id, trainer_id, client_id, workout_date)
values
  ('a5000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000009', '11111111-1111-4111-8111-111111111111', '2026-08-04');

set local role authenticated;
select set_config('request.jwt.claim.sub', '90000000-0000-4000-8000-000000000009', true);

reset role;

update public.clients
set archived_at = now()
where id = '11111111-1111-4111-8111-111111111111';
set local role authenticated;
select set_config('request.jwt.claim.sub', '90000000-0000-4000-8000-000000000009', true);
select throws_ok(
  $$select public.start_workout('a5000000-0000-4000-8000-000000000001', 1)$$,
  'PT404', 'client_not_found', 'archived client cannot start a workout'
);
reset role;

select ok(
  exists (select 1 from pg_proc where proname = 'legacy_start_workout' and pronamespace = 'private'::regnamespace),
  'archived-client guard is installed in legacy start function'
);

select * from finish();
rollback;
