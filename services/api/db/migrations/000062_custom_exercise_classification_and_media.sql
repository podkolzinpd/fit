-- Up Migration

-- Keep the Yandex tenant schema lossless with the Supabase source. Object
-- copying is a separate operation: image_path and its metadata are preserved
-- even when the referenced object is intentionally migrated later.
alter table public.custom_exercises
  add column primary_muscle_detail text,
  add column equipment text,
  add column description text,
  add column image_path text,
  add column image_mime_type text,
  add column image_width integer,
  add column image_height integer,
  add column image_size_bytes integer;

alter table public.custom_exercises
  add constraint custom_exercises_description_length
    check (description is null or char_length(description) <= 2000),
  add constraint custom_exercises_image_valid check (
    (
      image_path is null
      and image_mime_type is null
      and image_width is null
      and image_height is null
      and image_size_bytes is null
    )
    or
    (
      image_path is not null
      and image_mime_type is not null
      and image_width is not null
      and image_height is not null
      and image_size_bytes is not null
      and image_mime_type = 'image/jpeg'
      and image_width between 1 and 4096
      and image_height between 1 and 4096
      and image_size_bytes between 1 and 2097152
    )
  );

-- Down Migration

alter table public.custom_exercises
  drop constraint custom_exercises_image_valid,
  drop constraint custom_exercises_description_length,
  drop column image_size_bytes,
  drop column image_height,
  drop column image_width,
  drop column image_mime_type,
  drop column image_path,
  drop column description,
  drop column equipment,
  drop column primary_muscle_detail;
