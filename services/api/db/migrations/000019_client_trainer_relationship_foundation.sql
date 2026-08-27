-- Up Migration

alter table public.clients
  add column merged_into_client_id uuid references public.clients (id) on delete restrict;

alter table public.clients
  add constraint clients_merge_redirect_not_self
  check (merged_into_client_id is null or merged_into_client_id <> id);

create index clients_merge_redirect_idx
  on public.clients (merged_into_client_id)
  where merged_into_client_id is not null;

create table public.client_trainer_relationships (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete restrict,
  trainer_id uuid not null references public.trainers (profile_id) on delete restrict,
  status text not null default 'active',
  connected_at timestamptz not null default now(),
  disconnected_at timestamptz,
  connected_by uuid not null references public.profiles (id) on delete restrict,
  disconnected_by uuid references public.profiles (id) on delete restrict,
  source_invitation_id uuid references public.client_invitations (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_trainer_relationships_status check (
    status in ('active', 'disconnected')
  ),
  constraint client_trainer_relationships_state check (
    (
      status = 'active'
      and disconnected_at is null
      and disconnected_by is null
    )
    or (
      status = 'disconnected'
      and disconnected_at is not null
      and disconnected_by is not null
      and disconnected_at >= connected_at
    )
  )
);

create unique index client_trainer_relationships_one_active_idx
  on public.client_trainer_relationships (client_id)
  where status = 'active';

create index client_trainer_relationships_trainer_history_idx
  on public.client_trainer_relationships (trainer_id, connected_at desc);

create index client_trainer_relationships_client_history_idx
  on public.client_trainer_relationships (client_id, connected_at desc);

create trigger set_updated_at before update on public.client_trainer_relationships
  for each row execute function public.set_updated_at();

create table public.client_merge_operations (
  id uuid primary key default gen_random_uuid(),
  source_client_id uuid not null references public.clients (id) on delete restrict,
  target_client_id uuid not null references public.clients (id) on delete restrict,
  invitation_id uuid references public.client_invitations (id) on delete set null,
  actor_id uuid not null references public.profiles (id) on delete restrict,
  status text not null default 'started',
  dependency_counts_before jsonb not null default '{}'::jsonb,
  dependency_counts_after jsonb not null default '{}'::jsonb,
  error_code text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint client_merge_operations_distinct_cards check (
    source_client_id <> target_client_id
  ),
  constraint client_merge_operations_status check (
    status in ('started', 'completed', 'failed')
  ),
  constraint client_merge_operations_counts_are_objects check (
    jsonb_typeof(dependency_counts_before) = 'object'
    and jsonb_typeof(dependency_counts_after) = 'object'
  ),
  constraint client_merge_operations_state check (
    (
      status = 'started'
      and completed_at is null
      and error_code is null
    )
    or (
      status = 'completed'
      and completed_at is not null
      and error_code is null
    )
    or (
      status = 'failed'
      and completed_at is not null
      and btrim(coalesce(error_code, '')) <> ''
    )
  )
);

create index client_merge_operations_source_idx
  on public.client_merge_operations (source_client_id, created_at desc);

create index client_merge_operations_target_idx
  on public.client_merge_operations (target_client_id, created_at desc);

insert into public.client_trainer_relationships (
  client_id,
  trainer_id,
  status,
  connected_at,
  connected_by
)
select
  client.id,
  client.trainer_id,
  'active',
  coalesce(membership.joined_at, client.created_at),
  client.trainer_id
from public.clients client
left join public.client_trainers membership
  on membership.client_id = client.id
 and membership.trainer_id = client.trainer_id
where client.auth_user_id is not null
  and client.trainer_id <> client.auth_user_id
  and client.archived_at is null;

alter table public.client_trainer_relationships enable row level security;
alter table public.client_merge_operations enable row level security;

create policy client_trainer_relationships_read_participants
  on public.client_trainer_relationships
  for select to fit_api
  using (
    trainer_id = auth.uid()
    or exists (
      select 1
      from public.clients client
      where client.id = client_trainer_relationships.client_id
        and client.auth_user_id = auth.uid()
    )
  );

revoke all on public.client_trainer_relationships,
  public.client_merge_operations from public;
grant select on public.client_trainer_relationships to fit_api;

-- Down Migration

revoke select on public.client_trainer_relationships from fit_api;
drop policy client_trainer_relationships_read_participants
  on public.client_trainer_relationships;
drop table public.client_merge_operations;
drop table public.client_trainer_relationships;
drop index public.clients_merge_redirect_idx;
alter table public.clients drop constraint clients_merge_redirect_not_self;
alter table public.clients drop column merged_into_client_id;
