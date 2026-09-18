begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

insert into auth.users(id, instance_id, aud, role, email) values
  ('50000000-0000-4000-8000-000000000118','00000000-0000-0000-8000-000000000000','authenticated','authenticated','client-program-job@example.test'),
  ('50000000-0000-4000-8000-000000000119','00000000-0000-0000-8000-000000000000','authenticated','authenticated','other-client-program-job@example.test'),
  ('50000000-0000-4000-8000-00000000011a','00000000-0000-0000-8000-000000000000','authenticated','authenticated','trainer-program-job@example.test');
insert into public.profiles(id, account_role) values
  ('50000000-0000-4000-8000-000000000118','client'),
  ('50000000-0000-4000-8000-000000000119','client'),
  ('50000000-0000-4000-8000-00000000011a','trainer');
insert into public.trainers(profile_id) values
  ('50000000-0000-4000-8000-00000000011a');
insert into public.clients(id, trainer_id, auth_user_id, full_name, gender, age_years, height_cm) values
  ('c0000000-0000-4000-8000-000000000118','50000000-0000-4000-8000-00000000011a','50000000-0000-4000-8000-000000000118','Client Program Job','female',30,170),
  ('c0000000-0000-4000-8000-000000000119','50000000-0000-4000-8000-00000000011a','50000000-0000-4000-8000-000000000119','Other Client Program Job','male',31,180);

select is(
  public.assistant_program_generation_job(
    'a0000000-0000-4000-8000-000000000118',
    '50000000-0000-4000-8000-000000000118',
    'c0000000-0000-4000-8000-000000000118',
    'b0000000-0000-4000-8000-000000000118'
  )->>'status',
  'claimed',
  'client claims generation job for own active card'
);
select is(
  public.assistant_program_generation_job(
    'a0000000-0000-4000-8000-000000000118',
    '50000000-0000-4000-8000-000000000118',
    'c0000000-0000-4000-8000-000000000118',
    'b0000000-0000-4000-8000-000000000118',
    '{"ok":true}'
  )->>'status',
  'complete',
  'client-owned generation job stores the result'
);
select throws_ok(
  $$select public.assistant_program_generation_job(
    'a0000000-0000-4000-8000-000000000119',
    '50000000-0000-4000-8000-000000000118',
    'c0000000-0000-4000-8000-000000000119',
    'b0000000-0000-4000-8000-000000000119'
  )$$,
  'PT403', 'assistant_program_owner_required',
  'client cannot claim a generation job for another client card'
);
update public.clients
set archived_at = now()
where id = 'c0000000-0000-4000-8000-000000000118';
select throws_ok(
  $$select public.assistant_program_generation_job(
    'a0000000-0000-4000-8000-00000000011a',
    '50000000-0000-4000-8000-000000000118',
    'c0000000-0000-4000-8000-000000000118',
    'b0000000-0000-4000-8000-00000000011a'
  )$$,
  'PT403', 'assistant_program_owner_required',
  'client cannot claim a generation job for an archived card'
);
select is(
  public.assistant_program_generation_job(
    'a0000000-0000-4000-8000-00000000011b',
    '50000000-0000-4000-8000-00000000011a',
    'c0000000-0000-4000-8000-000000000119',
    'b0000000-0000-4000-8000-00000000011b'
  )->>'status',
  'claimed',
  'trainer generation jobs remain supported'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.assistant_program_generation_job(uuid,uuid,uuid,uuid,jsonb)',
    'execute'
  ),
  'browser cannot claim program generation jobs'
);

select * from finish();
rollback;
