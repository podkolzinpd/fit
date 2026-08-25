-- Up Migration

create table public.client_training_summaries (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null,
  client_id uuid not null,
  period_start date not null,
  period_end date not null,
  summary text not null,
  trainer_summary jsonb not null,
  client_summary jsonb not null,
  display_metrics jsonb not null default '{}'::jsonb,
  model_uri text not null,
  prompt_version text not null,
  input_fingerprint text not null,
  input_stats jsonb not null default '{}'::jsonb,
  token_usage jsonb,
  generated_at timestamptz not null default now(),
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint training_summaries_client_fk foreign key (client_id, trainer_id)
    references public.clients (id, trainer_id) on delete cascade,
  constraint training_summaries_period_order check (period_end >= period_start),
  constraint training_summaries_summary_not_blank check (btrim(summary) <> ''),
  constraint training_summaries_model_not_blank check (btrim(model_uri) <> ''),
  constraint training_summaries_prompt_not_blank check (btrim(prompt_version) <> ''),
  constraint training_summaries_fingerprint_not_blank check (btrim(input_fingerprint) <> ''),
  constraint training_summaries_trainer_shape check (
    jsonb_typeof(trainer_summary) = 'object'
    and jsonb_typeof(trainer_summary->'headline') = 'string'
    and jsonb_typeof(trainer_summary->'progress') = 'array'
    and jsonb_typeof(trainer_summary->'consistency') = 'string'
    and jsonb_typeof(trainer_summary->'attention') = 'array'
  ),
  constraint training_summaries_client_shape check (
    jsonb_typeof(client_summary) = 'object'
    and jsonb_typeof(client_summary->'headline') = 'string'
    and jsonb_typeof(client_summary->'achievements') = 'array'
    and jsonb_typeof(client_summary->'consistency') = 'string'
    and jsonb_typeof(client_summary->'encouragement') = 'string'
    and jsonb_typeof(client_summary->'goalAlignment') = 'string'
    and jsonb_typeof(client_summary->'nextSteps') = 'array'
  ),
  constraint training_summaries_metrics_object check (jsonb_typeof(display_metrics) = 'object'),
  constraint training_summaries_identity_unique unique (
    client_id, period_start, period_end, prompt_version
  )
);

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
  input_fingerprint text not null,
  generated_at timestamptz not null,
  published_at timestamptz not null default now(),
  published_by uuid references public.trainers (profile_id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint published_summaries_client_fk foreign key (client_id, trainer_id)
    references public.clients (id, trainer_id) on delete cascade,
  constraint published_summaries_period_order check (period_end >= period_start),
  constraint published_summaries_fingerprint_not_blank check (btrim(input_fingerprint) <> ''),
  constraint published_summaries_shape check (
    jsonb_typeof(summary) = 'object'
    and jsonb_typeof(summary->'headline') = 'string'
    and jsonb_typeof(summary->'achievements') = 'array'
    and jsonb_typeof(summary->'consistency') = 'string'
    and jsonb_typeof(summary->'encouragement') = 'string'
    and jsonb_typeof(summary->'goalAlignment') = 'string'
    and jsonb_typeof(summary->'nextSteps') = 'array'
  ),
  constraint published_summaries_metrics_object check (jsonb_typeof(display_metrics) = 'object'),
  constraint published_summaries_period_unique unique (client_id, period_start, period_end)
);

create index training_summaries_client_period_idx
  on public.client_training_summaries (client_id, period_end desc, generated_at desc);
create index published_summaries_client_period_idx
  on public.client_published_training_summaries (client_id, period_end desc, published_at desc);

create trigger set_updated_at before update on public.client_training_summaries
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.client_published_training_summaries
  for each row execute function public.set_updated_at();

alter table public.client_training_summaries enable row level security;
alter table public.client_published_training_summaries enable row level security;

create policy training_summaries_read_trainers on public.client_training_summaries
  for select to fit_api using (
    not exists (
      select 1 from public.clients client
      where client.id = client_training_summaries.client_id
        and client.auth_user_id = auth.uid()
    )
    and (
      trainer_id = auth.uid()
      or exists (
        select 1 from public.client_trainers membership
        where membership.client_id = client_training_summaries.client_id
          and membership.trainer_id = auth.uid()
      )
    )
  );
create policy published_summaries_read_accessible on public.client_published_training_summaries
  for select to fit_api using (public.can_access_client(client_id));

revoke all on public.client_training_summaries,
  public.client_published_training_summaries from public;
grant select on public.client_training_summaries,
  public.client_published_training_summaries to fit_api;

create or replace function public.save_generated_training_summary(
  p_client_id uuid,
  p_period_start date,
  p_period_end date,
  p_summary text,
  p_trainer_summary jsonb,
  p_client_summary jsonb,
  p_display_metrics jsonb,
  p_model_uri text,
  p_prompt_version text,
  p_input_fingerprint text,
  p_input_stats jsonb,
  p_token_usage jsonb,
  p_generated_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  client_row public.clients%rowtype;
  saved public.client_training_summaries%rowtype;
  visible public.client_published_training_summaries%rowtype;
begin
  select client.* into client_row from public.clients client
  where client.id = p_client_id and client.archived_at is null;
  if client_row.id is null or not public.can_access_client(p_client_id) then
    raise exception 'training_summary_forbidden' using errcode = 'PT403';
  end if;
  if p_period_end < p_period_start or p_generated_at is null then
    raise exception 'training_summary_invalid' using errcode = 'PT422';
  end if;

  insert into public.client_training_summaries (
    trainer_id, client_id, period_start, period_end, summary,
    trainer_summary, client_summary, display_metrics, model_uri,
    prompt_version, input_fingerprint, input_stats, token_usage, generated_at
  ) values (
    client_row.trainer_id, client_row.id, p_period_start, p_period_end, p_summary,
    p_trainer_summary, p_client_summary, p_display_metrics, p_model_uri,
    p_prompt_version, p_input_fingerprint, p_input_stats, p_token_usage, p_generated_at
  ) on conflict (client_id, period_start, period_end, prompt_version)
  do update set
    summary = excluded.summary,
    trainer_summary = excluded.trainer_summary,
    client_summary = excluded.client_summary,
    display_metrics = excluded.display_metrics,
    model_uri = excluded.model_uri,
    input_fingerprint = excluded.input_fingerprint,
    input_stats = excluded.input_stats,
    token_usage = excluded.token_usage,
    generated_at = excluded.generated_at,
    version = public.client_training_summaries.version + 1
  returning * into saved;

  if actor_id = client_row.auth_user_id then
    insert into public.client_published_training_summaries (
      source_summary_id, trainer_id, client_id, period_start, period_end,
      summary, display_metrics, input_fingerprint, generated_at,
      published_at, published_by
    ) values (
      saved.id, saved.trainer_id, saved.client_id, saved.period_start, saved.period_end,
      saved.client_summary, saved.display_metrics, saved.input_fingerprint,
      saved.generated_at, now(), null
    ) on conflict (client_id, period_start, period_end)
    do update set
      source_summary_id = excluded.source_summary_id,
      trainer_id = excluded.trainer_id,
      summary = excluded.summary,
      display_metrics = excluded.display_metrics,
      input_fingerprint = excluded.input_fingerprint,
      generated_at = excluded.generated_at,
      published_at = excluded.published_at,
      published_by = null
    returning * into visible;

    return jsonb_build_object(
      'id', visible.id, 'source_summary_id', visible.source_summary_id,
      'client_id', visible.client_id, 'period_start', visible.period_start,
      'period_end', visible.period_end, 'summary', visible.summary,
      'display_metrics', visible.display_metrics, 'generated_at', visible.generated_at,
      'published_at', visible.published_at
    );
  end if;

  return jsonb_build_object(
    'id', saved.id, 'client_id', saved.client_id,
    'period_start', saved.period_start, 'period_end', saved.period_end,
    'trainer_summary', saved.trainer_summary, 'client_summary', saved.client_summary,
    'display_metrics', saved.display_metrics, 'generated_at', saved.generated_at,
    'version', saved.version
  );
end;
$$;

revoke all on function public.save_generated_training_summary(
  uuid, date, date, text, jsonb, jsonb, jsonb, text, text, text,
  jsonb, jsonb, timestamptz
) from public;
grant execute on function public.save_generated_training_summary(
  uuid, date, date, text, jsonb, jsonb, jsonb, text, text, text,
  jsonb, jsonb, timestamptz
) to fit_api;

-- Down Migration

revoke execute on function public.save_generated_training_summary(
  uuid, date, date, text, jsonb, jsonb, jsonb, text, text, text,
  jsonb, jsonb, timestamptz
) from fit_api;
drop function public.save_generated_training_summary(
  uuid, date, date, text, jsonb, jsonb, jsonb, text, text, text,
  jsonb, jsonb, timestamptz
);
revoke select on public.client_training_summaries,
  public.client_published_training_summaries from fit_api;
drop policy published_summaries_read_accessible on public.client_published_training_summaries;
drop policy training_summaries_read_trainers on public.client_training_summaries;
drop table public.client_published_training_summaries;
drop table public.client_training_summaries;
