-- Up Migration

create table public.account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'requested'
    check (status in ('requested', 'cancelled', 'completed')),
  requested_at timestamptz not null default now(),
  cancelled_at timestamptz,
  completed_at timestamptz,
  check ((status = 'cancelled') = (cancelled_at is not null)),
  check ((status = 'completed') = (completed_at is not null))
);

create unique index account_deletion_requests_one_active_idx
  on public.account_deletion_requests (user_id)
  where status = 'requested';

create index account_deletion_requests_user_created_idx
  on public.account_deletion_requests (user_id, requested_at desc);

alter table public.account_deletion_requests enable row level security;

revoke all on public.account_deletion_requests from public;

comment on table public.account_deletion_requests is
  'User-initiated account deletion requests. Rows do not delete accounts automatically.';

-- Down Migration

drop table public.account_deletion_requests;
