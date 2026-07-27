alter table public.client_training_summaries
  add column trainer_summary jsonb,
  add column client_summary jsonb,
  add column display_metrics jsonb not null default '{}'::jsonb,
  add column version bigint not null default 1;

update public.client_training_summaries
set
  trainer_summary = jsonb_build_object(
    'headline', summary,
    'progress', '[]'::jsonb,
    'consistency', '',
    'attention', '[]'::jsonb
  ),
  client_summary = jsonb_build_object(
    'headline', summary,
    'achievements', '[]'::jsonb,
    'consistency', '',
    'encouragement', ''
  )
where trainer_summary is null or client_summary is null;

alter table public.client_training_summaries
  alter column trainer_summary set not null,
  alter column client_summary set not null,
  add constraint training_summaries_trainer_shape check (
    jsonb_typeof(trainer_summary) = 'object'
    and jsonb_typeof(trainer_summary->'headline') = 'string'
    and jsonb_typeof(trainer_summary->'progress') = 'array'
    and jsonb_typeof(trainer_summary->'consistency') = 'string'
    and jsonb_typeof(trainer_summary->'attention') = 'array'
  ),
  add constraint training_summaries_client_shape check (
    jsonb_typeof(client_summary) = 'object'
    and jsonb_typeof(client_summary->'headline') = 'string'
    and jsonb_typeof(client_summary->'achievements') = 'array'
    and jsonb_typeof(client_summary->'consistency') = 'string'
    and jsonb_typeof(client_summary->'encouragement') = 'string'
  ),
  add constraint training_summaries_metrics_object check (
    jsonb_typeof(display_metrics) = 'object'
  );

drop policy "training_summaries_read_accessible"
  on public.client_training_summaries;

create policy "training_summaries_read_own" on public.client_training_summaries
  for select to authenticated
  using (trainer_id = (select auth.uid()));

create table public.client_published_training_summaries (
  id uuid primary key default gen_random_uuid(),
  source_summary_id uuid not null unique
    references public.client_training_summaries (id) on delete cascade,
  trainer_id uuid not null,
  client_id uuid not null,
  period_start date not null,
  period_end date not null,
  summary jsonb not null,
  display_metrics jsonb not null default '{}'::jsonb,
  generated_at timestamptz not null,
  published_at timestamptz not null default now(),
  published_by uuid not null references public.trainers (profile_id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint published_training_summaries_client_fk
    foreign key (client_id, trainer_id)
    references public.clients (id, trainer_id) on delete cascade,
  constraint published_training_summaries_period_order
    check (period_end >= period_start),
  constraint published_training_summaries_summary_shape check (
    jsonb_typeof(summary) = 'object'
    and jsonb_typeof(summary->'headline') = 'string'
    and jsonb_typeof(summary->'achievements') = 'array'
    and jsonb_typeof(summary->'consistency') = 'string'
    and jsonb_typeof(summary->'encouragement') = 'string'
  ),
  constraint published_training_summaries_metrics_object
    check (jsonb_typeof(display_metrics) = 'object'),
  constraint published_training_summaries_period_unique
    unique (client_id, period_start, period_end)
);

create index client_published_training_summaries_client_period_idx
  on public.client_published_training_summaries
  (client_id, period_end desc, period_start desc);

create trigger set_updated_at
  before update on public.client_published_training_summaries
  for each row execute function public.set_updated_at();

alter table public.client_published_training_summaries enable row level security;

create policy "published_training_summaries_read_accessible"
  on public.client_published_training_summaries
  for select to authenticated
  using (
    trainer_id = (select auth.uid())
    or exists (
      select 1
      from public.clients c
      where c.id = client_published_training_summaries.client_id
        and c.trainer_id = client_published_training_summaries.trainer_id
        and c.auth_user_id = (select auth.uid())
    )
  );

revoke all on public.client_published_training_summaries from anon, authenticated;
grant select on public.client_published_training_summaries to authenticated;

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
    generated_at = excluded.generated_at,
    published_at = excluded.published_at,
    published_by = excluded.published_by
  returning id into published_id_value;

  return query select published_id_value, next_version_value;
end;
$$;

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

revoke all on function public.publish_training_summary(uuid, jsonb, bigint)
  from public, anon;
grant execute on function public.publish_training_summary(uuid, jsonb, bigint)
  to authenticated;

revoke all on function public.unpublish_training_summary(uuid, bigint)
  from public, anon;
grant execute on function public.unpublish_training_summary(uuid, bigint)
  to authenticated;
