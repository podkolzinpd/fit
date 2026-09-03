-- Up Migration

create or replace function public.unpublish_training_summary(
  p_summary_id uuid,
  p_expected_version bigint
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  next_version_value bigint;
begin
  if actor_id is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;

  update public.client_training_summaries
  set version = version + 1
  where id = p_summary_id
    and trainer_id = actor_id
    and version = p_expected_version
  returning version into next_version_value;

  if next_version_value is null then
    raise exception 'training_summary_conflict' using errcode = 'PT409';
  end if;

  delete from public.client_published_training_summaries
  where source_summary_id = p_summary_id
    and trainer_id = actor_id;

  return next_version_value;
end;
$$;

revoke all on function public.unpublish_training_summary(uuid, bigint)
  from public;
grant execute on function public.unpublish_training_summary(uuid, bigint)
  to fit_api;

-- Down Migration

revoke execute on function public.unpublish_training_summary(uuid, bigint)
  from fit_api;
drop function public.unpublish_training_summary(uuid, bigint);
