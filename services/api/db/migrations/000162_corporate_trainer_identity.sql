-- Up Migration

-- Published identity only; the existing admin capability remains mandatory.
create or replace function app_private.corporate_admin_bundle() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app_private.is_corporate_admin() then
    raise exception 'corporate_forbidden' using errcode='PT403';
  end if;
  return jsonb_build_object(
    'offices', coalesce((select jsonb_agg(jsonb_build_object(
      'id',o.id,'city',o.city,'name',o.name,'address',o.address,
      'archived',o.archived,'version',o.version) order by o.city,o.name,o.id)
      from public.corporate_offices o),'[]'::jsonb),
    'trainers', coalesce((select jsonb_agg(jsonb_build_object(
      'id',t.profile_id,'name',coalesce(nullif(btrim(concat_ws(' ',p.first_name,p.last_name)),''),'Имя не указано'),
      'publicId',case when pp.published_data is not null then pp.public_id else null end,
      'publishedName',nullif(btrim(pp.published_data->>'displayName'),''),
      'photoPath',pp.published_data->'photos'->0->>'thumbnailPath',
      'avatarDataUrl',pp.published_data->>'avatarDataUrl',
      'isYandex',coalesce(c.is_yandex,false),'version',coalesce(c.version,0),
      'officeIds',coalesce((select jsonb_agg(b.office_id order by b.office_id)
        from public.corporate_trainer_offices b where b.trainer_id=t.profile_id),'[]'::jsonb))
      order by p.first_name,p.last_name,t.profile_id)
      from public.trainers t join public.profiles p on p.id=t.profile_id
      left join public.trainer_professional_profiles pp on pp.trainer_id=t.profile_id
      left join public.corporate_trainers c on c.trainer_id=t.profile_id
      where p.account_role='trainer'),'[]'::jsonb));
end $$;

-- Down Migration

create or replace function app_private.corporate_admin_bundle() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app_private.is_corporate_admin() then
    raise exception 'corporate_forbidden' using errcode='PT403';
  end if;
  return jsonb_build_object(
    'offices', coalesce((select jsonb_agg(jsonb_build_object(
      'id',o.id,'city',o.city,'name',o.name,'address',o.address,
      'archived',o.archived,'version',o.version) order by o.city,o.name,o.id)
      from public.corporate_offices o),'[]'::jsonb),
    'trainers', coalesce((select jsonb_agg(jsonb_build_object(
      'id',t.profile_id,'name',coalesce(nullif(btrim(concat_ws(' ',p.first_name,p.last_name)),''),'Имя не указано'),
      'isYandex',coalesce(c.is_yandex,false),'version',coalesce(c.version,0),
      'officeIds',coalesce((select jsonb_agg(b.office_id order by b.office_id)
        from public.corporate_trainer_offices b where b.trainer_id=t.profile_id),'[]'::jsonb))
      order by p.first_name,p.last_name,t.profile_id)
      from public.trainers t join public.profiles p on p.id=t.profile_id
      left join public.corporate_trainers c on c.trainer_id=t.profile_id
      where p.account_role='trainer'),'[]'::jsonb));
end $$;

