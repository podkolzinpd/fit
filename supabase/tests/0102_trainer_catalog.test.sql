begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password) values
  ('a3000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'catalog-one@example.test', ''),
  ('a3000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'catalog-two@example.test', '');
insert into public.profiles (id, account_role) values
  ('a3000000-0000-4000-8000-000000000001', 'trainer'),
  ('a3000000-0000-4000-8000-000000000002', 'trainer');
insert into public.trainers (profile_id) values
  ('a3000000-0000-4000-8000-000000000001'),
  ('a3000000-0000-4000-8000-000000000002');

select has_column('public', 'trainer_professional_profiles', 'listed_in_catalog', 'catalog choice is stored');
select has_function('public', 'set_trainer_profile_catalog_listing', array['boolean'], 'catalog choice RPC exists');
select has_function('public', 'list_public_trainer_profiles', array['text', 'text', 'text', 'text', 'boolean'], 'catalog list RPC exists');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a3000000-0000-4000-8000-000000000001', true);
select public.save_trainer_profile_draft(jsonb_build_object(
  'displayName', 'Анна Иванова', 'bio', repeat('Описание ', 8),
  'specialties', jsonb_build_array('Силовые'), 'city', 'Москва',
  'trainingModes', jsonb_build_array('online'), 'experienceStartYear', 2020,
  'education', '', 'formats', '', 'price', '', 'acceptingClients', true,
  'avatarDataUrl', null, 'certificates', '[]'::jsonb
));
select public.publish_trainer_profile();
select is(public.set_trainer_profile_catalog_listing(true)->>'listedInCatalog', 'true', 'published trainer opts into catalog');

reset role;
insert into public.trainer_professional_profiles (trainer_id, draft_data, published_data, published_at)
values (
  'a3000000-0000-4000-8000-000000000002',
  jsonb_build_object('displayName', 'Скрытый тренер'),
  jsonb_build_object('displayName', 'Скрытый тренер', 'bio', repeat('Описание ', 8),
    'specialties', jsonb_build_array('Бег'), 'city', 'Казань',
    'trainingModes', jsonb_build_array('in_person'), 'experienceStartYear', 2018,
    'education', '', 'formats', '', 'price', '', 'acceptingClients', true,
    'avatarDataUrl', null, 'certificates', '[]'::jsonb),
  now()
);

set local role anon;
select is((select count(*)::integer from public.list_public_trainer_profiles()), 1, 'catalog returns only opted-in profiles');
select is(
  (select item->'published'->>'displayName' from public.list_public_trainer_profiles() item),
  'Анна Иванова', 'catalog returns the published snapshot'
);
select is((select count(*)::integer from public.list_public_trainer_profiles('анна')), 1, 'catalog searches by name');
select is((select count(*)::integer from public.list_public_trainer_profiles(null, 'сил', 'моск', 'online', true)), 1, 'catalog filters published fields');
select is((select count(*)::integer from public.list_public_trainer_profiles(null, null, null, 'in_person', null)), 0, 'catalog hides non-matching modes');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a3000000-0000-4000-8000-000000000001', true);
select public.save_trainer_profile_draft(jsonb_build_object(
  'displayName', 'Черновое имя', 'bio', repeat('Новое описание ', 5),
  'specialties', jsonb_build_array('Бег'), 'city', 'Казань',
  'trainingModes', jsonb_build_array('in_person'), 'experienceStartYear', null,
  'education', '', 'formats', '', 'price', '', 'acceptingClients', false,
  'avatarDataUrl', null, 'certificates', '[]'::jsonb
));
reset role;
set local role anon;
select is((select count(*)::integer from public.list_public_trainer_profiles('Черновое')), 0, 'draft changes do not leak into catalog');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a3000000-0000-4000-8000-000000000001', true);
select is(public.unpublish_trainer_profile()->>'listedInCatalog', 'false', 'unpublish removes catalog listing');
select throws_like(
  $$select public.set_trainer_profile_catalog_listing(true)$$,
  '%published_trainer_profile_required%',
  'an unpublished profile cannot enter the catalog'
);
reset role;
set local role anon;
select is((select count(*)::integer from public.list_public_trainer_profiles()), 0, 'unpublished profile disappears from catalog');

reset role;
select * from finish();
rollback;
