create table public.app_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  account_role text not null check (account_role in ('trainer', 'client')),
  kind text not null check (kind in ('suggestion', 'problem')),
  message text not null check (char_length(message) between 3 and 2000),
  screen_path text not null check (char_length(screen_path) between 1 and 500),
  app_version text not null check (char_length(app_version) between 1 and 64),
  display_mode text not null check (display_mode in ('browser', 'standalone')),
  user_agent text not null check (char_length(user_agent) between 1 and 512),
  created_at timestamptz not null default now()
);

create index app_feedback_created_at_idx on public.app_feedback (created_at desc);
create index app_feedback_kind_created_at_idx on public.app_feedback (kind, created_at desc);

alter table public.app_feedback enable row level security;

revoke all on public.app_feedback from public, anon, authenticated;

create or replace function public.submit_app_feedback(
  p_kind text,
  p_message text,
  p_screen_path text,
  p_app_version text,
  p_display_mode text,
  p_user_agent text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_id uuid := auth.uid();
  actor_role text;
  feedback_id uuid;
begin
  if actor_id is null then
    raise exception 'authentication_required' using errcode = 'PT401';
  end if;

  select profile.account_role
    into actor_role
    from public.profiles profile
    where profile.id = actor_id;

  if actor_role not in ('trainer', 'client') then
    raise exception 'profile_not_found' using errcode = 'PT403';
  end if;

  insert into public.app_feedback (
    user_id,
    account_role,
    kind,
    message,
    screen_path,
    app_version,
    display_mode,
    user_agent
  ) values (
    actor_id,
    actor_role,
    lower(btrim(p_kind)),
    btrim(p_message),
    left(coalesce(nullif(btrim(p_screen_path), ''), '/'), 500),
    left(coalesce(nullif(btrim(p_app_version), ''), 'unknown'), 64),
    lower(btrim(p_display_mode)),
    left(coalesce(nullif(btrim(p_user_agent), ''), 'unknown'), 512)
  )
  returning id into feedback_id;

  return feedback_id;
end;
$$;

revoke all on function public.submit_app_feedback(text, text, text, text, text, text) from public, anon;
grant execute on function public.submit_app_feedback(text, text, text, text, text, text) to authenticated;

