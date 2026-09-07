insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'fit-exercise-media',
  'fit-exercise-media',
  false,
  1048576,
  array['video/mp4', 'image/jpeg']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Authenticated users can read Vital exercise media" on storage.objects;
create policy "Authenticated users can read Vital exercise media"
on storage.objects
for select
to authenticated
using (bucket_id = 'fit-exercise-media');
