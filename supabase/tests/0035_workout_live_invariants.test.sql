begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

insert into public.workouts (id, trainer_id, client_id, workout_date)
values
  ('a5000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000009', '11111111-1111-4111-8111-111111111111', '2026-08-04'),
  ('a5000000-0000-4000-8000-000000000002', '90000000-0000-4000-8000-000000000009', '11111111-1111-4111-8111-111111111111', '2026-08-04');

set local role authenticated;
select set_config('request.jwt.claim.sub', '90000000-0000-4000-8000-000000000009', true);

select is(
  public.start_workout('a5000000-0000-4000-8000-000000000001', 1),
  2::bigint,
  'trainer can start the first live workout'
);
select throws_ok(
  $$select public.start_workout('a5000000-0000-4000-8000-000000000002', 1)$$,
  'PT409', 'workout_conflict', 'trainer cannot start a second live workout'
);
reset role;

update public.clients
set archived_at = now()
where id = '11111111-1111-4111-8111-111111111111';
update public.workouts
set status = 'planned', started_at = null, version = version + 1
where id = 'a5000000-0000-4000-8000-000000000002';

set local role authenticated;
select set_config('request.jwt.claim.sub', '90000000-0000-4000-8000-000000000009', true);
select throws_ok(
  $$select public.start_workout('a5000000-0000-4000-8000-000000000002', 2)$$,
  'PT404', 'client_not_found', 'archived client cannot start a workout'
);
reset role;

select ok(
  exists (select 1 from pg_indexes where indexname = 'workouts_one_live_per_trainer_uidx'),
  'one-live-per-trainer unique index exists'
);

select * from finish();
rollback;
