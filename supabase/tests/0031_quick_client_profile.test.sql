begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password) values
  ('50000000-0000-4000-8000-000000000031', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'quick31@example.test', '');
insert into public.profiles (id) values ('50000000-0000-4000-8000-000000000031');
insert into public.trainers (profile_id) values ('50000000-0000-4000-8000-000000000031');

set local role authenticated;
select set_config('request.jwt.claim.sub', '50000000-0000-4000-8000-000000000031', true);

create temp table quick_client as
select public.create_quick_client('  Анна Быстрый старт  ') as id;

select is((select full_name from public.clients where id = (select id from quick_client)), 'Анна Быстрый старт', 'сохраняет очищенное имя');
select ok((select gender is null and age_years is null and height_cm is null from public.clients where id = (select id from quick_client)), 'не подставляет фиктивные данные профиля');
select ok(exists(select 1 from public.client_trainers where client_id = (select id from quick_client) and trainer_id = '50000000-0000-4000-8000-000000000031'), 'создаёт связь тренера с клиентом');
select throws_ok($$select public.create_quick_client('А')$$, '22023', 'client_name_too_short', 'не создаёт карточку с коротким именем');

reset role;
select * from finish();
rollback;
