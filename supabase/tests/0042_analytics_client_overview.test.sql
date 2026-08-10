begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

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

-- Активность самого клиента: только записи, созданные им самим
-- (created_by = clients.auth_user_id). У клиента A нет auth_user_id —
-- собственной активности быть не может, даже если тренер что-то заводит.
-- У клиента B — своя тренировка (created_by = он сам) плюс отдельная
-- тренировка, заведённая тренером с более поздним updated_at — проверяет,
-- что тренерская запись НЕ попадает в подсчёт. У клиента C — своя
-- тренировка и свой замер, greatest() берёт более позднюю из двух дат.
insert into public.workouts (id, trainer_id, client_id, created_by, workout_date, status, updated_at) values
  ('72000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001', '2026-08-06', 'planned', '2026-08-06 09:00:00+00'),
  ('72000000-0000-4000-8000-000000000002', '70000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000002', '70000000-0000-4000-8000-000000000002', '2026-08-07', 'planned', '2026-08-07 10:00:00+00'),
  ('72000000-0000-4000-8000-000000000003', '70000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000002', '70000000-0000-4000-8000-000000000001', '2026-08-08', 'planned', '2026-08-08 12:00:00+00'),
  ('72000000-0000-4000-8000-000000000004', '70000000-0000-4000-8000-000000000003', '71000000-0000-4000-8000-000000000003', '70000000-0000-4000-8000-000000000003', '2026-08-05', 'planned', '2026-08-05 09:00:00+00');

insert into public.client_progress (id, trainer_id, client_id, created_by, recorded_on, updated_at) values
  ('73000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000003', '71000000-0000-4000-8000-000000000003', '70000000-0000-4000-8000-000000000003', '2026-08-09', '2026-08-09 09:00:00+00');

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

select is(
  (select last_client_activity_at from analytics.client_overview where client_id = '71000000-0000-4000-8000-000000000001'),
  null, 'client without auth_user_id has no self-authored records: last_client_activity_at is null even though a trainer-authored workout exists'
);
select is(
  (select last_client_activity_at from analytics.client_overview where client_id = '71000000-0000-4000-8000-000000000002'),
  '2026-08-07 10:00:00+00'::timestamptz,
  'last_client_activity_at reflects only the client-authored workout, ignoring the later trainer-authored one for the same client'
);
select is(
  (select last_client_activity_at from analytics.client_overview where client_id = '71000000-0000-4000-8000-000000000003'),
  '2026-08-09 09:00:00+00'::timestamptz,
  'last_client_activity_at is greatest() of self-authored workout and progress entry'
);

select * from finish();
rollback;
