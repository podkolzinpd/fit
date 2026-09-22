begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password) values
  ('50000000-0000-4000-8000-000000000054', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'athlete54@example.test', ''),
  ('50000000-0000-4000-8000-000000000055', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'trainer54@example.test', ''),
  ('50000000-0000-4000-8000-000000000056', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'recovery54@example.test', '');
insert into public.profiles (id, account_role) values
  ('50000000-0000-4000-8000-000000000054', 'client'),
  ('50000000-0000-4000-8000-000000000055', 'trainer'),
  ('50000000-0000-4000-8000-000000000056', 'client');
insert into public.trainers (profile_id) values ('50000000-0000-4000-8000-000000000055');

set local role authenticated;
select set_config('request.jwt.claim.sub', '50000000-0000-4000-8000-000000000054', true);

create temp table quick_own_client as
select public.create_quick_own_client('  Антон Первый старт  ') as id;

select is((select full_name from public.clients where id = (select id from quick_own_client)), 'Антон Первый старт', 'сохраняет очищенное имя');
select ok((select gender is null and age_years is null and height_cm is null from public.clients where id = (select id from quick_own_client)), 'не подставляет фиктивные данные профиля');
select ok((select trainer_id = auth_user_id from public.clients where id = (select id from quick_own_client)), 'спортсмен владеет своей карточкой');
select ok(exists(select 1 from public.client_private_details where client_id = (select id from quick_own_client)), 'создаёт приватные детали');
select is(public.create_quick_own_client('Другое имя'), (select id from quick_own_client), 'повторный вызов идемпотентен');
select throws_ok($$select public.create_quick_own_client('А')$$, '22023', 'client_name_too_short', 'не создаёт карточку с коротким именем');

select set_config('request.jwt.claim.sub', '50000000-0000-4000-8000-000000000055', true);
select throws_ok($$select public.create_quick_own_client('Тренер')$$, 'PT403', 'client_account_required', 'тренер не создаёт самостоятельную карточку');

reset role;
insert into public.clients (id, trainer_id, full_name) values
  ('50000000-0000-4000-8000-000000000057', '50000000-0000-4000-8000-000000000055', 'Каноническая карточка');
insert into public.clients (
  id, trainer_id, auth_user_id, full_name, archived_at, merged_into_client_id
) values (
  '50000000-0000-4000-8000-000000000058',
  '50000000-0000-4000-8000-000000000056',
  '50000000-0000-4000-8000-000000000056',
  'Устаревшая связь',
  now(),
  '50000000-0000-4000-8000-000000000057'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '50000000-0000-4000-8000-000000000056', true);
select is(
  public.create_quick_own_client('Восстановление'),
  '50000000-0000-4000-8000-000000000057'::uuid,
  'возвращает каноническую карточку вместо конфликта'
);
select ok(
  (select auth_user_id is null from public.clients where id = '50000000-0000-4000-8000-000000000058'),
  'убирает устаревшую связь с объединённой карточки'
);
select is(
  (select auth_user_id from public.clients where id = '50000000-0000-4000-8000-000000000057'),
  '50000000-0000-4000-8000-000000000056'::uuid,
  'переносит аккаунт на каноническую карточку'
);
select is(
  (select count(*) from public.clients where id in (
    '50000000-0000-4000-8000-000000000057',
    '50000000-0000-4000-8000-000000000058'
  )),
  2::bigint,
  'восстановление не создаёт третью карточку'
);

reset role;
update public.clients
set archived_at = now()
where id = '50000000-0000-4000-8000-000000000057';
set local role authenticated;
select set_config('request.jwt.claim.sub', '50000000-0000-4000-8000-000000000056', true);
create temp table restored_own_client as
select public.create_quick_own_client('Повтор') as id;
select is(
  (select id from restored_own_client),
  '50000000-0000-4000-8000-000000000057'::uuid,
  'повторное действие возвращает архивную собственную карточку'
);
select ok(
  (select archived_at is null from public.clients where id = '50000000-0000-4000-8000-000000000057'),
  'повторное действие восстанавливает архивную собственную карточку'
);

reset role;
select * from finish();
rollback;
