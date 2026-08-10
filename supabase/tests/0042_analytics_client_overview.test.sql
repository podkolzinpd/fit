begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

select ok(
  exists(select 1 from pg_matviews where schemaname = 'analytics' and matviewname = 'client_overview'),
  'analytics.client_overview matview exists'
);
select ok(
  has_table_privilege('datalens_reader', 'analytics.client_overview', 'SELECT'),
  'datalens_reader has select on analytics.client_overview'
);

-- Тренер 1 (реальный) — заводит клиента A (не привязан) и клиента B
-- (привязал свой отдельный аккаунт, но не self-registered — владелец
-- партиции остался тренер). Клиент C — self-registered (сам себе владелец).
-- Тренер D — тестовый аккаунт (test@test.com), его клиент помечается
-- is_test_account. Клиент E — self-registered с собственным тестовым
-- email в смешанном регистре (case-insensitive проверка).
insert into auth.users (id, instance_id, aud, role, email, encrypted_password)
values
  ('70000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'overview-trainer-1@example.test', ''),
  ('70000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'overview-linked-client-b@example.test', ''),
  ('70000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'overview-self-client-c@example.test', ''),
  ('70000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test@test.com', ''),
  ('70000000-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'Knyaz187@mail.ru', '');
insert into public.profiles (id) values
  ('70000000-0000-4000-8000-000000000001'),
  ('70000000-0000-4000-8000-000000000002'),
  ('70000000-0000-4000-8000-000000000003'),
  ('70000000-0000-4000-8000-000000000004'),
  ('70000000-0000-4000-8000-000000000005');
insert into public.trainers (profile_id, created_at) values
  ('70000000-0000-4000-8000-000000000001', '2026-07-01'),
  ('70000000-0000-4000-8000-000000000004', '2026-07-02');

insert into public.clients (id, trainer_id, auth_user_id, full_name, created_at) values
  -- Клиент A: заведён тренером 1, не привязан
  ('71000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001', null, 'Overview Client A', '2026-08-01'),
  -- Клиент B: заведён тренером 1, привязал СВОЙ отдельный аккаунт (app-linked, но не self-registered)
  ('71000000-0000-4000-8000-000000000002', '70000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000002', 'Overview Client B', '2026-08-02'),
  -- Клиент C: self-registered — владелец партиции = он сам
  ('71000000-0000-4000-8000-000000000003', '70000000-0000-4000-8000-000000000003', '70000000-0000-4000-8000-000000000003', 'Overview Client C', '2026-08-03'),
  -- Клиент D: заведён тестовым тренером (test@test.com)
  ('71000000-0000-4000-8000-000000000004', '70000000-0000-4000-8000-000000000004', null, 'Overview Client D', '2026-08-04'),
  -- Клиент E: self-registered со своим тестовым email (смешанный регистр)
  ('71000000-0000-4000-8000-000000000005', '70000000-0000-4000-8000-000000000005', '70000000-0000-4000-8000-000000000005', 'Overview Client E', '2026-08-05');

refresh materialized view analytics.client_overview;

select is(
  (select count(*)::bigint from analytics.client_overview),
  (select count(*)::bigint from public.clients),
  'row count matches live count(*) from public.clients'
);

select is(
  (select registered_at from analytics.client_overview where client_id = '71000000-0000-4000-8000-000000000001'),
  (select created_at from public.clients where id = '71000000-0000-4000-8000-000000000001'),
  'registered_at matches clients.created_at'
);

select is(
  (select is_self_registered from analytics.client_overview where client_id = '71000000-0000-4000-8000-000000000001'),
  false, 'client added by trainer, not app-linked at all: is_self_registered = false'
);
select is(
  (select is_self_registered from analytics.client_overview where client_id = '71000000-0000-4000-8000-000000000002'),
  false, 'app-linked client (different auth_user_id than partition owner) is NOT self-registered'
);
select is(
  (select is_self_registered from analytics.client_overview where client_id = '71000000-0000-4000-8000-000000000003'),
  true, 'client is own partition owner (trainer_id = auth_user_id): is_self_registered = true'
);

select is(
  (select is_test_account from analytics.client_overview where client_id = '71000000-0000-4000-8000-000000000001'),
  false, 'regular trainer-owned client is not flagged as test account'
);
select is(
  (select is_test_account from analytics.client_overview where client_id = '71000000-0000-4000-8000-000000000004'),
  true, 'client owned by test@test.com trainer is flagged as test account'
);
select is(
  (select is_test_account from analytics.client_overview where client_id = '71000000-0000-4000-8000-000000000005'),
  true, 'self-registered client with own email Knyaz187@mail.ru is flagged as test account (case-insensitive)'
);

select * from finish();
rollback;
