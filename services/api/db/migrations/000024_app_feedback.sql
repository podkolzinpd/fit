-- Up Migration

create table public.app_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  account_role text not null
    check (account_role in ('trainer', 'client')),
  kind text not null
    check (kind in ('suggestion', 'problem')),
  message text not null
    check (char_length(message) between 3 and 2000),
  screen_path text not null
    check (char_length(screen_path) between 1 and 500),
  app_version text not null
    check (char_length(app_version) between 1 and 64),
  display_mode text not null
    check (display_mode in ('browser', 'standalone')),
  user_agent text not null
    check (char_length(user_agent) between 1 and 512),
  created_at timestamptz not null default now()
);

create index app_feedback_created_at_idx
  on public.app_feedback (created_at desc);
create index app_feedback_kind_created_at_idx
  on public.app_feedback (kind, created_at desc);

alter table public.app_feedback enable row level security;

revoke all on public.app_feedback from public, fit_api;

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
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_role text;
  normalized_kind text := lower(btrim(p_kind));
  normalized_message text := btrim(p_message);
  normalized_display_mode text := lower(btrim(p_display_mode));
  feedback_id uuid;
begin
  select profile.account_role
  into actor_role
  from public.profiles profile
  where profile.id = actor_id;

  if actor_id is null
    or actor_role is null
    or actor_role not in ('trainer', 'client')
  then
    raise exception 'app_feedback_forbidden' using errcode = 'PT403';
  end if;
  if normalized_kind is null
    or normalized_kind not in ('suggestion', 'problem')
    or normalized_message is null
    or char_length(normalized_message) not between 3 and 2000
    or normalized_display_mode is null
    or normalized_display_mode not in ('browser', 'standalone')
  then
    raise exception 'app_feedback_invalid' using errcode = 'PT422';
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
    normalized_kind,
    normalized_message,
    left(coalesce(nullif(btrim(p_screen_path), ''), '/'), 500),
    left(coalesce(nullif(btrim(p_app_version), ''), 'unknown'), 64),
    normalized_display_mode,
    left(coalesce(nullif(btrim(p_user_agent), ''), 'unknown'), 512)
  )
  returning id into feedback_id;

  return feedback_id;
exception
  when check_violation then
    raise exception 'app_feedback_invalid' using errcode = 'PT422';
end;
$$;

revoke all on function public.submit_app_feedback(
  text, text, text, text, text, text
) from public;
grant execute on function public.submit_app_feedback(
  text, text, text, text, text, text
) to fit_api;

create view ops_readonly.app_feedback
with (security_barrier = true, security_invoker = false)
as
select
  feedback.id,
  feedback.created_at,
  feedback.user_id as profile_id,
  feedback.account_role,
  feedback.kind,
  feedback.message,
  feedback.screen_path,
  feedback.app_version,
  feedback.display_mode
from public.app_feedback feedback;

revoke all on ops_readonly.app_feedback from public;

-- Down Migration

drop view ops_readonly.app_feedback;
revoke execute on function public.submit_app_feedback(
  text, text, text, text, text, text
) from fit_api;
drop function public.submit_app_feedback(text, text, text, text, text, text);
drop table public.app_feedback;
