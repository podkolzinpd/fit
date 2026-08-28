create table public.user_feature_flags (
  user_id uuid primary key references auth.users(id) on delete cascade,
  monochrome_preview boolean not null default false
);

alter table public.user_feature_flags enable row level security;

create policy "user_feature_flags_read_own" on public.user_feature_flags
  for select to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.user_feature_flags from anon, authenticated;
grant select on public.user_feature_flags to authenticated;

comment on table public.user_feature_flags is
  'Server-managed rollout flags. Authenticated users can read only their own row; writes require an administrative role.';
comment on column public.user_feature_flags.monochrome_preview is
  'Default-off access to the route-scoped Foundation UI Identity v1 preview.';

-- One-time production initialization. Email is used only here to resolve the
-- existing Auth UUIDs; runtime checks and frontend code read only user_id.
insert into public.user_feature_flags (user_id, monochrome_preview)
select id, true
from auth.users
where lower(email) in ('test@test.com', 'test@client-testgmail.com')
on conflict (user_id) do update
set monochrome_preview = excluded.monochrome_preview;
