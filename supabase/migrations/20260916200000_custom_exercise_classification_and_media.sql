-- Форма создания своего упражнения размечала только группу мышц — упражнение
-- не находилось через фильтры "мышца"/"оборудование" в каталоге (только
-- через "группа"). Добавляем те же два поля, что использует сам фильтр
-- (ExercisePicker.tsx: musclesForGroup()/equipmentForSelection() читают
-- ровно эти колонки у системных упражнений), плюс описание и фото на
-- обложку.
--
-- primary_muscle_detail/equipment — опциональные text, без CHECK на
-- конкретный список значений: как и у системного каталога, это открытый,
-- заполняемый по факту словарь, а не фиксированный enum (см. обсуждение в
-- YAFIT-521 — в отличие от muscle_group, который остаётся закрытым enum).
--
-- Фото — переносим движок chat-media (20260911100000_chat_photo_attachments):
-- тот же bucket-профиль (private, 1 JPEG, 2MB, 4096px), тот же паттерн
-- all-or-nothing CHECK на image_*. Видео сознательно не добавляем в эту
-- итерацию — в приложении нет вообще никакой инфраструктуры для видео
-- (ни клиентского сжатия, ни bucket'а), это отдельная задача.
--
-- Путь хранения ключуется по auth.uid() загрузившего
-- (`{auth.uid()}/{exerciseId}.jpg`), а не по id упражнения — в отличие от
-- chat-media, где conversation уже существует до отправки сообщения, здесь
-- строка custom_exercises ещё не создана в момент загрузки фото (клиент
-- сначала грузит фото, потом одним insert создаёт упражнение целиком,
-- включая image_path). READ-политика уже смотрит на существующую строку по
-- image_path = name, а не по фолдеру — так что дальнейшая видимость фото
-- совпадает с видимостью самого упражнения (custom_exercises_read_accessible).

alter table public.custom_exercises
  add column primary_muscle_detail text,
  add column equipment text,
  add column description text,
  add column image_path text,
  add column image_mime_type text,
  add column image_width integer,
  add column image_height integer,
  add column image_size_bytes integer;

alter table public.custom_exercises add constraint custom_exercises_description_length
  check (description is null or char_length(description) <= 2000);

-- Явные `is not null` на каждом поле, а не только на image_path: без них
-- `image_mime_type = 'image/jpeg'` с NULL слева даёт NULL, а не false, и
-- CHECK трактует NULL как "не нарушено" — частичный набор (путь есть,
-- остальное пусто) тихо проходил бы constraint. Нашли этот случай тестом,
-- сама формула (без явных is not null) — тот же паттерн, что уже в
-- chat_messages_content_valid (20260911100000), но там непроверено.
alter table public.custom_exercises add constraint custom_exercises_image_valid check (
  (image_path is null and image_mime_type is null and image_width is null and image_height is null and image_size_bytes is null)
  or
  (image_path is not null and image_mime_type is not null and image_width is not null and image_height is not null and image_size_bytes is not null
    and image_mime_type = 'image/jpeg'
    and image_width between 1 and 4096 and image_height between 1 and 4096
    and image_size_bytes between 1 and 2097152)
);

revoke update on public.custom_exercises from authenticated;
grant update (
  name, muscle_group, input_kind, primary_muscle_detail, equipment, description,
  image_path, image_mime_type, image_width, image_height, image_size_bytes,
  archived_at, version
) on public.custom_exercises to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('custom-exercise-media', 'custom-exercise-media', false, 2097152, array['image/jpeg'])
on conflict (id) do update
set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Кто угодно, кому виден сам custom_exercises-ряд (та же логика, что
-- custom_exercises_read_accessible), может прочитать его фото.
create policy "Custom exercise viewers can read cover photo"
on storage.objects for select to authenticated
using (
  bucket_id = 'custom-exercise-media'
  and exists (
    select 1 from public.custom_exercises exercise
    where exercise.image_path = storage.objects.name
      and (
        exercise.created_by = (select auth.uid())
        or exercise.trainer_id = (select auth.uid())
        or exists (
          select 1
          from public.clients client
          where client.auth_user_id = exercise.created_by
            and client.trainer_id = exercise.trainer_id
            and public.can_access_client(client.id)
        )
        or (
          exercise.created_by = exercise.trainer_id
          and exists (
            select 1
            from public.clients client
            where client.auth_user_id = (select auth.uid())
              and client.trainer_id = exercise.trainer_id
              and client.archived_at is null
          )
        )
      )
  )
);

-- Загрузка разрешена только в собственную папку — на момент загрузки
-- строка custom_exercises ещё не существует, поэтому единственная
-- проверяемая вещь — что первый сегмент пути равен auth.uid() самого
-- загружающего.
create policy "Authenticated users can upload their own cover photo"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'custom-exercise-media'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);
