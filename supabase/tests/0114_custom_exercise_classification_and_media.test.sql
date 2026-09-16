-- YAFIT-521: мышца/оборудование/описание/фото на своём упражнении.
--
-- Storage RLS (bucket custom-exercise-media) в этом файле НЕ симулируется
-- напрямую через storage.objects — как и у уже существующего chat-media
-- (20260911100000), в этом репозитории нет прецедента pgTAP-тестов на
-- storage.objects/pg_policies; здесь проверяется только конфигурация
-- bucket'а и полностью — поведение самой таблицы custom_exercises.
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

select is(
  (select row(public, file_size_limit, allowed_mime_types) from storage.buckets where id = 'custom-exercise-media'),
  row(false, 2097152::bigint, array['image/jpeg']),
  'custom-exercise-media bucket is private, 2MB, JPEG-only'
);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password) values
  ('b1000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'media-owner@example.test', ''),
  ('b4000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'media-trainer@example.test', '');
insert into public.profiles (id, account_role, first_name) values
  ('b1000000-0000-4000-8000-000000000001', 'client', 'Автор'),
  ('b4000000-0000-4000-8000-000000000004', 'trainer', 'Тренер');
insert into public.trainers (profile_id) values ('b4000000-0000-4000-8000-000000000004');
insert into public.clients (id, trainer_id, auth_user_id, full_name) values
  ('b1100000-0000-4000-8000-000000000011', 'b4000000-0000-4000-8000-000000000004', 'b1000000-0000-4000-8000-000000000001', 'Клиент-автор');

-- Полный набор новых полей заполняется тем же путём, что и раньше —
-- вставкой от имени тренера (владельца раздела).
insert into public.custom_exercises (
  id, trainer_id, created_by, name, muscle_group, input_kind,
  primary_muscle_detail, equipment, description,
  image_path, image_mime_type, image_width, image_height, image_size_bytes
) values (
  'b2000000-0000-4000-8000-000000000002', 'b4000000-0000-4000-8000-000000000004', 'b4000000-0000-4000-8000-000000000004',
  'Болгарский присед', 'legs', 'strength',
  'Квадрицепс', 'Гантели', 'Задняя нога на скамье, передняя стопа чуть впереди таза.',
  'b4000000-0000-4000-8000-000000000004/b2000000-0000-4000-8000-000000000002.jpg', 'image/jpeg', 1200, 1600, 400000
);
select is(
  (select row(primary_muscle_detail, equipment, description) from public.custom_exercises where id = 'b2000000-0000-4000-8000-000000000002'),
  row('Квадрицепс'::text, 'Гантели'::text, 'Задняя нога на скамье, передняя стопа чуть впереди таза.'::text),
  'classification and description fields persist as inserted'
);
select is(
  (select row(image_path, image_mime_type, image_width, image_height, image_size_bytes) from public.custom_exercises where id = 'b2000000-0000-4000-8000-000000000002'),
  row('b4000000-0000-4000-8000-000000000004/b2000000-0000-4000-8000-000000000002.jpg'::text, 'image/jpeg'::text, 1200, 1600, 400000),
  'cover photo metadata persists as inserted'
);

-- Все новые поля опциональны — старый путь (без разметки, без фото) всё ещё работает.
select lives_ok(
  $$insert into public.custom_exercises (id, trainer_id, created_by, name, muscle_group, input_kind)
    values ('b2100000-0000-4000-8000-000000000021', 'b4000000-0000-4000-8000-000000000004', 'b4000000-0000-4000-8000-000000000004', 'Без разметки', 'back', 'strength')$$,
  'legacy insert without any new field still succeeds'
);

select throws_ok(
  $$update public.custom_exercises set description = repeat('a', 2001) where id = 'b2000000-0000-4000-8000-000000000002'$$,
  '23514', null, 'description over 2000 characters is rejected'
);
select throws_ok(
  $$update public.custom_exercises set image_path = 'only-path-set.jpg' where id = 'b2100000-0000-4000-8000-000000000021'$$,
  '23514', null, 'a partially-set image_* combination (path without mime/dimensions/size) is rejected'
);
select throws_ok(
  $$update public.custom_exercises
    set image_path = 'x.jpg', image_mime_type = 'image/png', image_width = 100, image_height = 100, image_size_bytes = 100
    where id = 'b2100000-0000-4000-8000-000000000021'$$,
  '23514', null, 'a non-JPEG mime type is rejected'
);
select throws_ok(
  $$update public.custom_exercises
    set image_path = 'x.jpg', image_mime_type = 'image/jpeg', image_width = 5000, image_height = 100, image_size_bytes = 100
    where id = 'b2100000-0000-4000-8000-000000000021'$$,
  '23514', null, 'width over 4096px is rejected'
);
select throws_ok(
  $$update public.custom_exercises
    set image_path = 'x.jpg', image_mime_type = 'image/jpeg', image_width = 100, image_height = 100, image_size_bytes = 2097153
    where id = 'b2100000-0000-4000-8000-000000000021'$$,
  '23514', null, 'size over 2MB is rejected'
);
select lives_ok(
  $$update public.custom_exercises
    set image_path = 'valid.jpg', image_mime_type = 'image/jpeg', image_width = 100, image_height = 100, image_size_bytes = 100, version = version + 1
    where id = 'b2100000-0000-4000-8000-000000000021'$$,
  'a fully-populated, in-bounds image_* set is accepted'
);
select lives_ok(
  $$update public.custom_exercises
    set image_path = null, image_mime_type = null, image_width = null, image_height = null, image_size_bytes = null, version = version + 1
    where id = 'b2100000-0000-4000-8000-000000000021'$$,
  'clearing the cover photo back to all-null is accepted'
);

-- grant update покрывает новые колонки — клиент-автор может отредактировать
-- разметку и описание своего упражнения через обычный Data API.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'b1000000-0000-4000-8000-000000000001', true);
insert into public.custom_exercises (id, trainer_id, name, muscle_group, input_kind)
  values ('b1200000-0000-4000-8000-000000000012', 'b4000000-0000-4000-8000-000000000004', 'Клиентское упражнение', 'core', 'strength');
select lives_ok(
  $$update public.custom_exercises
    set primary_muscle_detail = 'Пресс', equipment = 'Без оборудования', description = 'Скручивания лёжа.', version = version + 1
    where id = 'b1200000-0000-4000-8000-000000000012'$$,
  'author can update classification and description via the granted column list'
);
select lives_ok(
  $$update public.custom_exercises
    set image_path = 'b1000000-0000-4000-8000-000000000001/b1200000-0000-4000-8000-000000000012.jpg',
        image_mime_type = 'image/jpeg', image_width = 800, image_height = 800, image_size_bytes = 150000,
        version = version + 1
    where id = 'b1200000-0000-4000-8000-000000000012'$$,
  'author can attach a cover photo via the granted column list'
);
reset role;

select is(
  (select description from public.custom_exercises where id = 'b1200000-0000-4000-8000-000000000012'),
  'Скручивания лёжа.',
  'client-authored update is visible after reset role'
);

select * from finish();
rollback;
