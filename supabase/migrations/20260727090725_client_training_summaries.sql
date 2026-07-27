create table public.client_training_summaries (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null,
  client_id uuid not null,
  period_start date not null,
  period_end date not null,
  summary text not null,
  model_uri text not null,
  prompt_version text not null,
  input_fingerprint text not null,
  input_stats jsonb not null default '{}'::jsonb,
  token_usage jsonb,
  generated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_training_summaries_client_fk foreign key (client_id, trainer_id)
    references public.clients (id, trainer_id) on delete cascade,
  constraint client_training_summaries_period_order check (period_end >= period_start),
  constraint client_training_summaries_summary_not_blank check (btrim(summary) <> ''),
  constraint client_training_summaries_model_not_blank check (btrim(model_uri) <> ''),
  constraint client_training_summaries_prompt_version_not_blank check (btrim(prompt_version) <> ''),
  constraint client_training_summaries_fingerprint_not_blank check (btrim(input_fingerprint) <> ''),
  constraint client_training_summaries_identity_unique unique (
    client_id,
    period_start,
    period_end,
    prompt_version
  )
);

create index client_training_summaries_client_period_idx
  on public.client_training_summaries (client_id, period_end desc, period_start desc);

create trigger set_updated_at
  before update on public.client_training_summaries
  for each row execute function public.set_updated_at();

alter table public.client_training_summaries enable row level security;

create policy "training_summaries_read_accessible" on public.client_training_summaries
  for select to authenticated using (
    trainer_id = (select auth.uid())
    or exists (
      select 1
      from public.clients c
      where c.id = public.client_training_summaries.client_id
        and c.trainer_id = public.client_training_summaries.trainer_id
        and c.auth_user_id = (select auth.uid())
    )
  );

create policy "training_summaries_insert_own" on public.client_training_summaries
  for insert to authenticated with check (
    trainer_id = (select auth.uid())
    and exists (
      select 1
      from public.clients c
      where c.id = public.client_training_summaries.client_id
        and c.trainer_id = (select auth.uid())
        and c.archived_at is null
    )
  );

create policy "training_summaries_update_own" on public.client_training_summaries
  for update to authenticated
  using (trainer_id = (select auth.uid()))
  with check (
    trainer_id = (select auth.uid())
    and exists (
      select 1
      from public.clients c
      where c.id = public.client_training_summaries.client_id
        and c.trainer_id = (select auth.uid())
        and c.archived_at is null
    )
  );

revoke all on public.client_training_summaries from anon, authenticated;
grant select, insert, update on public.client_training_summaries to authenticated;
