-- Up Migration

alter function public.save_client_progress(jsonb, bigint)
  rename to save_client_progress_v1;
revoke execute on function public.save_client_progress_v1(jsonb, bigint) from fit_api;

alter function public.get_client_progress_bundle(uuid)
  rename to get_client_progress_bundle_v3;
revoke execute on function public.get_client_progress_bundle_v3(uuid) from fit_api;

alter table public.client_progress
  add column inbody_data jsonb,
  add constraint client_progress_inbody_object check (
    inbody_data is null
    or (
      jsonb_typeof(inbody_data) = 'object'
      and inbody_data->>'schemaVersion' = '1'
      and pg_column_size(inbody_data) <= 65536
    )
  );

create function public.save_client_progress(
  p_progress jsonb,
  p_expected_version bigint default null
)
returns table (progress_id uuid, version bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_id uuid;
  saved_version bigint;
  inbody_value jsonb;
begin
  select saved.progress_id, saved.version
    into saved_id, saved_version
  from public.save_client_progress_v1(p_progress, p_expected_version) saved;

  if p_progress ? 'inBody' then
    inbody_value := p_progress->'inBody';
    if inbody_value = 'null'::jsonb then inbody_value := null; end if;
    update public.client_progress progress
      set inbody_data = inbody_value
      where progress.id = saved_id;
  end if;

  return query select saved_id, saved_version;
exception
  when check_violation then
    raise exception 'progress_invalid' using errcode = 'PT422';
end;
$$;

revoke all on function public.save_client_progress(jsonb, bigint) from public;
grant execute on function public.save_client_progress(jsonb, bigint) to fit_api;

create function public.get_client_progress_bundle(p_client_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  bundle jsonb;
begin
  bundle := public.get_client_progress_bundle_v3(p_client_id);
  bundle := jsonb_set(
    bundle,
    '{entries}',
    coalesce((
      select jsonb_agg(
        case when progress.inbody_data is null then item.entry
          else item.entry || jsonb_build_object('inBody', progress.inbody_data)
        end
        order by item.ordinality
      )
      from jsonb_array_elements(coalesce(bundle->'entries', '[]'::jsonb))
        with ordinality item(entry, ordinality)
      join public.client_progress progress
        on progress.id = (item.entry->>'id')::uuid
    ), '[]'::jsonb),
    true
  );
  return bundle;
end;
$$;

revoke all on function public.get_client_progress_bundle(uuid) from public;
grant execute on function public.get_client_progress_bundle(uuid) to fit_api;

-- Down Migration

drop function public.get_client_progress_bundle(uuid);
alter function public.get_client_progress_bundle_v3(uuid)
  rename to get_client_progress_bundle;
grant execute on function public.get_client_progress_bundle(uuid) to fit_api;

drop function public.save_client_progress(jsonb, bigint);
alter function public.save_client_progress_v1(jsonb, bigint)
  rename to save_client_progress;
grant execute on function public.save_client_progress(jsonb, bigint) to fit_api;

alter table public.client_progress
  drop constraint client_progress_inbody_object,
  drop column inbody_data;
