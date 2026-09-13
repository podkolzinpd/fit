begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password) values
  ('a3000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'catalog-one@example.test', ''),
  ('a3000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'catalog-two@example.test', ''),
  ('a3000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'catalog-three@example.test', '');
insert into public.profiles (id, account_role) values
  ('a3000000-0000-4000-8000-000000000001', 'trainer'),
  ('a3000000-0000-4000-8000-000000000002', 'trainer'),
  ('a3000000-0000-4000-8000-000000000003', 'trainer');
insert into public.trainers (profile_id) values
  ('a3000000-0000-4000-8000-000000000001'),
  ('a3000000-0000-4000-8000-000000000002'),
  ('a3000000-0000-4000-8000-000000000003');

select has_column('public', 'trainer_professional_profiles', 'listed_in_catalog', 'catalog choice is stored');
select has_function('public', 'set_trainer_profile_catalog_listing', array['boolean'], 'catalog choice RPC exists');
select has_function('public', 'list_public_trainer_profiles', array['text', 'text', 'text', 'text', 'boolean'], 'catalog list RPC exists');
select has_function('public', 'list_public_trainer_profiles_page', array['text', 'text', 'text', 'text', 'boolean', 'integer', 'integer'], 'paged catalog RPC exists');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a3000000-0000-4000-8000-000000000001', true);
select public.save_trainer_profile_draft(jsonb_build_object(
  'displayName', 'Анна Каталогова', 'bio', repeat('Описание ', 8),
  'specialties', jsonb_build_array('Тестовые силовые'), 'city', 'Тестоград',
  'trainingModes', jsonb_build_array('online'), 'experienceStartYear', 2020,
  'education', '', 'formats', '', 'price', '', 'acceptingClients', true,
  'avatarDataUrl', null, 'certificates', '[]'::jsonb
));
select public.publish_trainer_profile();
select is(public.get_own_trainer_profile()->>'listedInCatalog', 'true', 'first publication enters the catalog automatically');

reset role;
insert into public.trainer_professional_profiles (trainer_id, draft_data, published_data, published_at)
values (
  'a3000000-0000-4000-8000-000000000002',
  jsonb_build_object('displayName', 'Скрытый тренер'),
  jsonb_build_object('displayName', 'Скрытый тренер каталога', 'bio', repeat('Описание ', 8),
    'specialties', jsonb_build_array('Тестовый бег'), 'city', 'Скрытоград',
    'trainingModes', jsonb_build_array('in_person'), 'experienceStartYear', 2018,
    'education', '', 'formats', '', 'price', '', 'acceptingClients', true,
    'avatarDataUrl', null, 'certificates', '[]'::jsonb),
  now()
);
insert into public.trainer_professional_profiles (trainer_id, draft_data, published_data, listed_in_catalog, published_at)
values (
  'a3000000-0000-4000-8000-000000000003',
  jsonb_build_object('displayName', 'Борис Новиков'),
  jsonb_build_object('displayName', 'Борис Новиков', 'bio', '',
    'specialties', '[]'::jsonb, 'city', '', 'trainingModes', '[]'::jsonb,
    'experienceStartYear', null, 'education', '', 'formats', '', 'price', '',
    'acceptingClients', false, 'avatarDataUrl', null, 'certificates', '[]'::jsonb),
  true,
  now()
);

set local role anon;
select is((select count(*)::integer from public.list_public_trainer_profiles('Анна Каталогова')), 1, 'catalog returns the automatically listed profile');
select is(
  (select item->'published'->>'displayName' from public.list_public_trainer_profiles('Анна Каталогова') item),
  'Анна Каталогова', 'catalog returns the published snapshot'
);
select is((select count(*)::integer from public.list_public_trainer_profiles('Каталогова')), 1, 'catalog searches by name');
select is((select count(*)::integer from public.list_public_trainer_profiles(null, 'Тестовые силовые', 'Тестоград', 'online', true)), 1, 'catalog filters published fields');
select is((select count(*)::integer from public.list_public_trainer_profiles(null, 'Тестовый бег', null, 'in_person', null)), 0, 'catalog hides a profile with listing disabled');
select is((public.list_public_trainer_profiles_page(null, null, null, null, null, 0, 1)->'items'->0->'published'->>'displayName'), 'Анна Каталогова', 'catalog prioritizes trainers who accept new clients');
select is((public.list_public_trainer_profiles_page(null, null, null, null, null, 0, 1)->>'totalCount')::integer, 2, 'paged catalog returns the full matching count');
select is(jsonb_array_length(public.list_public_trainer_profiles_page(null, null, null, null, null, 0, 1)->'items'), 1, 'paged catalog respects the page size');
select is((public.list_public_trainer_profiles_page(null, null, null, null, null, 0, 1)->>'nextOffset')::integer, 1, 'paged catalog returns the next offset');
select isnt(
  public.list_public_trainer_profiles_page(null, null, null, null, null, 0, 1)->'items'->0->>'publicId',
  public.list_public_trainer_profiles_page(null, null, null, null, null, 1, 1)->'items'->0->>'publicId',
  'adjacent pages do not repeat a profile'
);

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
select is(public.set_trainer_profile_catalog_listing(false)->>'listedInCatalog', 'false', 'trainer can leave the catalog');
select is(public.publish_trainer_profile()->>'listedInCatalog', 'false', 'updating a publication preserves the trainer choice');
reset role;
set local role anon;
select is((select count(*)::integer from public.list_public_trainer_profiles('Черновое имя')), 0, 'hidden trainer stays out after updating the publication');

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
select is((select count(*)::integer from public.list_public_trainer_profiles('Черновое имя')), 0, 'unpublished profile disappears from catalog');

reset role;
select * from finish();
rollback;
