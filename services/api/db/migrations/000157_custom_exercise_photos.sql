-- Up Migration

-- Migration62 already carries legacy image metadata. Preserve it losslessly.
alter table public.custom_exercises add column image_sha256 text;
alter table public.custom_exercises add constraint custom_exercise_photo_hash_valid check (
  image_sha256 is null or (
    image_sha256 ~ '^[a-f0-9]{64}$' and image_path is not null
    and image_width between 1 and 1600 and image_height between 1 and 1600
    and image_path = created_by::text || '/' || id::text || '/' || image_sha256 || '.jpg'
  )
);

create function public.create_custom_exercise_with_photo(p_id uuid, p_exercise jsonb, p_photo jsonb)
returns setof public.custom_exercises
language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  actor_role text;
  partition_owner_id uuid;
  existing public.custom_exercises%rowtype;
begin
  select profile.account_role into actor_role from public.profiles profile where profile.id = actor_id;
  if actor_role = 'trainer' then partition_owner_id := actor_id;
  elsif actor_role = 'client' then
    select client.trainer_id into partition_owner_id from public.clients client
    where client.auth_user_id = actor_id and client.archived_at is null and client.merged_into_client_id is null;
  end if;
  if partition_owner_id is null then raise exception 'custom_exercise_forbidden' using errcode = 'PT403'; end if;
  if p_id is null or jsonb_typeof(p_exercise) is distinct from 'object'
    or jsonb_typeof(p_photo) is distinct from 'object'
    or p_photo->>'sha256' is null or (p_photo->>'sha256') !~ '^[a-f0-9]{64}$'
    or (p_photo->>'path') is distinct from actor_id::text || '/' || p_id::text || '/' || (p_photo->>'sha256') || '.jpg' then
    raise exception 'custom_exercise_invalid' using errcode = 'PT422';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_id::text, 157));
  select exercise.* into existing from public.custom_exercises exercise where exercise.id = p_id for update;
  if found then
    if existing.created_by <> actor_id then raise exception 'custom_exercise_forbidden' using errcode = 'PT403'; end if;
    if existing.archived_at is not null
      or existing.name is distinct from btrim(p_exercise->>'name')
      or existing.muscle_group is distinct from p_exercise->>'muscleGroup'
      or existing.input_kind is distinct from p_exercise->>'inputKind'
      or existing.primary_muscle_detail is distinct from nullif(btrim(p_exercise->>'primaryMuscleDetail'), '')
      or existing.equipment is distinct from nullif(btrim(p_exercise->>'equipment'), '')
      or existing.description is distinct from nullif(btrim(p_exercise->>'description'), '')
      or existing.image_path is distinct from p_photo->>'path'
      or existing.image_mime_type is distinct from p_photo->>'mimeType'
      or existing.image_width is distinct from (p_photo->>'width')::integer
      or existing.image_height is distinct from (p_photo->>'height')::integer
      or existing.image_size_bytes is distinct from (p_photo->>'sizeBytes')::integer
      or existing.image_sha256 is distinct from p_photo->>'sha256' then
      raise exception 'custom_exercise_conflict' using errcode = 'PT409';
    end if;
    return next existing;
    return;
  end if;
  return query insert into public.custom_exercises (
    id, trainer_id, created_by, name, muscle_group, input_kind,
    primary_muscle_detail, equipment, description,
    image_path, image_mime_type, image_width, image_height, image_size_bytes, image_sha256
  ) values (
    p_id, partition_owner_id, actor_id, btrim(p_exercise->>'name'), p_exercise->>'muscleGroup', p_exercise->>'inputKind',
    nullif(btrim(p_exercise->>'primaryMuscleDetail'), ''), nullif(btrim(p_exercise->>'equipment'), ''), nullif(btrim(p_exercise->>'description'), ''),
    p_photo->>'path', p_photo->>'mimeType', (p_photo->>'width')::integer, (p_photo->>'height')::integer,
    (p_photo->>'sizeBytes')::integer, p_photo->>'sha256'
  ) returning *;
exception
  when unique_violation then raise exception 'custom_exercise_conflict' using errcode = 'PT409';
  when check_violation or foreign_key_violation or not_null_violation or invalid_text_representation or numeric_value_out_of_range then
    raise exception 'custom_exercise_invalid' using errcode = 'PT422';
end;
$$;
revoke all on function public.create_custom_exercise_with_photo(uuid, jsonb, jsonb) from public;
grant execute on function public.create_custom_exercise_with_photo(uuid, jsonb, jsonb) to fit_api;

-- Down Migration

drop function public.create_custom_exercise_with_photo(uuid, jsonb, jsonb);
alter table public.custom_exercises drop constraint custom_exercise_photo_hash_valid, drop column image_sha256;
