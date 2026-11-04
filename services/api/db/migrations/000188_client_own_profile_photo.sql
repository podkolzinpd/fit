-- Up Migration
-- The athlete may replace the photo of their own canonical client card.

create or replace function public.save_client_profile_photo(p_id uuid, p_photo jsonb, p_version bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare current_photo jsonb; next_photo jsonb;
begin
  if not (exists(select 1 from public.profiles where id=auth.uid() and account_role='trainer')
      and public.is_active_client_trainer_connection(p_id,auth.uid()))
    and not exists(select 1 from public.clients c join public.profiles p on p.id=auth.uid()
      where c.id=p_id and c.auth_user_id=auth.uid() and p.account_role='client') then
    raise exception 'client_forbidden' using errcode='PT403';
  end if;
  select profile_photo into current_photo from public.clients
    where id=p_id and archived_at is null and merged_into_client_id is null for update;
  if not found then raise exception 'client_forbidden' using errcode='PT403'; end if;
  if p_version is null or p_version < 0 or p_version >= 9007199254740991
    or p_photo is null or jsonb_typeof(p_photo) <> 'object'
    or coalesce(p_photo->>'sha256','') !~ '^[a-f0-9]{64}$'
    or coalesce(p_photo->>'path','') <> p_id::text || '/' || coalesce(p_photo->>'sha256','') || '.jpg'
    or coalesce(p_photo->>'sizeBytes','') !~ '^[0-9]{1,6}$' then
    raise exception 'client_invalid' using errcode='PT422';
  end if;
  if (p_photo->>'sizeBytes')::integer not between 1 and 160000 then
    raise exception 'client_invalid' using errcode='PT422';
  end if;
  -- Same content after a lost acknowledgement is the same successful upload.
  if current_photo->>'sha256'=p_photo->>'sha256' then return current_photo; end if;
  if coalesce((current_photo->>'version')::bigint,0) <> p_version then
    raise exception 'client_conflict' using errcode='PT409';
  end if;
  next_photo := jsonb_build_object('path',p_photo->>'path','sha256',p_photo->>'sha256',
    'sizeBytes',(p_photo->>'sizeBytes')::integer,'version',p_version+1);
  update public.clients set profile_photo=next_photo where id=p_id;
  return next_photo;
end $$;
revoke all on function public.save_client_profile_photo(uuid,jsonb,bigint) from public;
grant execute on function public.save_client_profile_photo(uuid,jsonb,bigint) to fit_api;

-- Down Migration
-- Forward-only: retain photographs and their concurrency versions.
