create or replace function public.publish_training_summary(
  p_summary_id uuid,
  p_client_summary jsonb,
  p_expected_version bigint
)
returns table (published_id uuid, next_version bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  source_row public.client_training_summaries;
  published_id_value uuid;
  next_version_value bigint;
begin
  if actor_id is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;

  select *
  into source_row
  from public.client_training_summaries
  where id = p_summary_id
    and trainer_id = actor_id
  for update;

  if not found then
    raise exception 'training_summary_not_found' using errcode = 'PT404';
  end if;
  if source_row.version <> p_expected_version then
    raise exception 'training_summary_conflict' using errcode = 'PT409';
  end if;

  update public.client_training_summaries
  set client_summary = p_client_summary,
      version = version + 1
  where id = p_summary_id
    and trainer_id = actor_id
    and version = p_expected_version
  returning version into next_version_value;

  insert into public.client_published_training_summaries (
    source_summary_id,
    trainer_id,
    client_id,
    period_start,
    period_end,
    summary,
    display_metrics,
    input_fingerprint,
    generated_at,
    published_at,
    published_by
  ) values (
    source_row.id,
    source_row.trainer_id,
    source_row.client_id,
    source_row.period_start,
    source_row.period_end,
    p_client_summary,
    source_row.display_metrics,
    source_row.input_fingerprint,
    source_row.generated_at,
    now(),
    actor_id
  )
  on conflict (client_id, period_start, period_end)
  do update set
    source_summary_id = excluded.source_summary_id,
    trainer_id = excluded.trainer_id,
    summary = excluded.summary,
    display_metrics = excluded.display_metrics,
    input_fingerprint = excluded.input_fingerprint,
    generated_at = excluded.generated_at,
    published_at = excluded.published_at,
    published_by = excluded.published_by
  returning id into published_id_value;

  return query select published_id_value, next_version_value;
end;
$$;

revoke all on function public.publish_training_summary(uuid, jsonb, bigint)
  from public;
grant execute on function public.publish_training_summary(uuid, jsonb, bigint)
  to fit_api;
