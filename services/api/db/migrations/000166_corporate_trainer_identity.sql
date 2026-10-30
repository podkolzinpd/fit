-- Up Migration

-- Keep the original bundle unchanged for an API rollback. Only the new API
-- reads private photo paths here and signs them before returning HTTP JSON.
create function app_private.corporate_admin_bundle_with_identity() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_bundle jsonb;
begin
  if not app_private.is_corporate_admin() then
    raise exception 'corporate_forbidden' using errcode='PT403';
  end if;
  v_bundle := app_private.corporate_admin_bundle();
  return jsonb_set(v_bundle, '{trainers}', coalesce((
    select jsonb_agg(entry.value || jsonb_build_object(
      'publicId',case when pp.published_data is not null then pp.public_id else null end,
      'publishedName',nullif(btrim(pp.published_data->>'displayName'),''),
      'photoPath',pp.published_data->'photos'->0->>'thumbnailPath',
      'avatarDataUrl',pp.published_data->>'avatarDataUrl') order by entry.ordinality)
    from jsonb_array_elements(v_bundle->'trainers') with ordinality as entry(value,ordinality)
    left join public.trainer_professional_profiles pp on pp.trainer_id=(entry.value->>'id')::uuid
  ),'[]'::jsonb));
end $$;
revoke all on function app_private.corporate_admin_bundle_with_identity() from public;
grant execute on function app_private.corporate_admin_bundle_with_identity() to fit_api;

-- Down Migration

drop function app_private.corporate_admin_bundle_with_identity();
