begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password) values
  ('a2000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'trainer-profile@example.test', ''),
  ('a2000000-0000-4000-8000-000000000002', '00000000-0000-0000-8000-000000000000', 'authenticated', 'authenticated', 'other-profile@example.test', '');
insert into public.profiles (id, account_role) values
  ('a2000000-0000-4000-8000-000000000001', 'trainer'),
  ('a2000000-0000-4000-8000-000000000002', 'trainer');
insert into public.trainers (profile_id) values
  ('a2000000-0000-4000-8000-000000000001'),
  ('a2000000-0000-4000-8000-000000000002');

select has_table('public', 'trainer_professional_profiles', 'trainer profiles table exists');
select has_function('public', 'get_own_trainer_profile', array[]::text[], 'own profile RPC exists');
select has_function('public', 'save_trainer_profile_draft', array['jsonb'], 'draft RPC exists');
select has_function('public', 'publish_trainer_profile', array[]::text[], 'publish RPC exists');
select has_function('public', 'unpublish_trainer_profile', array[]::text[], 'unpublish RPC exists');
select has_function('public', 'get_public_trainer_profile', array['uuid'], 'public profile RPC exists');
select is(has_table_privilege('anon', 'public.trainer_professional_profiles', 'SELECT'), false, 'anonymous users cannot read drafts');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a2000000-0000-4000-8000-000000000001', true);
create temp table saved_profile as select public.save_trainer_profile_draft(jsonb_build_object(
  'displayName', 'Анна Иванова', 'bio', '',
  'specialties', '[]'::jsonb, 'city', '',
  'trainingModes', '[]'::jsonb, 'experienceStartYear', null,
  'education', '', 'formats', '', 'price', '', 'acceptingClients', false,
  'avatarDataUrl', null, 'certificates', '[]'::jsonb
)) as value;
select is((select value->'draft'->>'displayName' from saved_profile), 'Анна Иванова', 'trainer saves own draft');
select is(public.publish_trainer_profile()->'published'->>'displayName', 'Анна Иванова', 'trainer publishes a snapshot');
select is(public.get_own_trainer_profile()->'published'->>'bio', '', 'minimal published profile keeps optional biography empty');
select public.save_trainer_profile_draft(jsonb_build_object(
  'displayName', 'Новое имя', 'bio', repeat('Новое описание ', 5),
  'specialties', jsonb_build_array('Бег'), 'city', '',
  'trainingModes', jsonb_build_array('in_person'), 'experienceStartYear', null,
  'education', '', 'formats', '', 'price', '', 'acceptingClients', false,
  'avatarDataUrl', null, 'certificates', '[]'::jsonb
));
select is((select published_data->>'displayName' from public.trainer_professional_profiles), 'Анна Иванова', 'draft edit keeps the published snapshot');

reset role;
create temp table public_profile_id as
  select public_id from public.trainer_professional_profiles
  where trainer_id = 'a2000000-0000-4000-8000-000000000001';
grant select on public_profile_id to anon;
set local role anon;
select is(
  public.get_public_trainer_profile((select public_id from public_profile_id))->'published'->>'displayName',
  'Анна Иванова', 'anonymous reader sees only the published snapshot'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a2000000-0000-4000-8000-000000000001', true);
select is(public.unpublish_trainer_profile()->>'published', null::text, 'unpublish keeps the draft and hides the snapshot');

reset role;
select * from finish();
rollback;
