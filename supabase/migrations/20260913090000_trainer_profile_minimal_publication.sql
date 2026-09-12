create or replace function public.publish_trainer_profile()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result public.trainer_professional_profiles;
begin
  select * into result from public.trainer_professional_profiles where trainer_id = auth.uid() for update;
  if result is null then raise exception 'trainer_profile_not_found' using errcode = 'PT404'; end if;
  if length(btrim(coalesce(result.draft_data->>'displayName', ''))) < 2 then
    raise exception 'trainer_profile_incomplete' using errcode = 'PT422';
  end if;
  update public.trainer_professional_profiles
    set listed_in_catalog = case when published_data is null then true else listed_in_catalog end,
        published_data = draft_data,
        published_at = now(),
        version = version + 1
    where trainer_id = auth.uid() returning * into result;
  return public.trainer_profile_response(result);
end;
$$;

revoke all on function public.publish_trainer_profile() from public;
grant execute on function public.publish_trainer_profile() to authenticated;
