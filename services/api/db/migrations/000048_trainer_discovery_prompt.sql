-- Up Migration

create table public.trainer_discovery_prompt_preferences (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  remind_at timestamptz,
  dismissed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint trainer_discovery_prompt_single_state
    check (remind_at is null or dismissed_at is null)
);

create trigger set_updated_at
before update on public.trainer_discovery_prompt_preferences
for each row execute function public.set_updated_at();

alter table public.trainer_discovery_prompt_preferences enable row level security;
revoke all on table public.trainer_discovery_prompt_preferences from public;

create policy trainer_discovery_prompt_manage_own
on public.trainer_discovery_prompt_preferences
for all to fit_api
using (user_id = auth.uid())
with check (user_id = auth.uid());

create function public.get_trainer_discovery_prompt()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  preference public.trainer_discovery_prompt_preferences;
begin
  if actor_id is null then raise exception 'authentication_required' using errcode = '28000'; end if;
  if not exists (select 1 from public.profiles profile where profile.id = actor_id and profile.account_role = 'client') then
    raise exception 'client_role_required' using errcode = 'PT403';
  end if;
  select * into preference from public.trainer_discovery_prompt_preferences where user_id = actor_id;
  return jsonb_build_object(
    'state', case when preference.dismissed_at is not null then 'dismissed'
      when preference.remind_at > now() then 'snoozed' else 'visible' end,
    'remindAt', preference.remind_at,
    'updatedAt', preference.updated_at
  );
end;
$$;

create function public.set_trainer_discovery_prompt(p_action text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  normalized_action text := lower(btrim(coalesce(p_action, '')));
begin
  if actor_id is null then raise exception 'authentication_required' using errcode = '28000'; end if;
  if not exists (select 1 from public.profiles profile where profile.id = actor_id and profile.account_role = 'client') then
    raise exception 'client_role_required' using errcode = 'PT403';
  end if;
  if normalized_action not in ('snooze', 'dismiss') then
    raise exception 'invalid_trainer_discovery_prompt_action' using errcode = 'PT422';
  end if;
  if normalized_action = 'dismiss' then
    insert into public.trainer_discovery_prompt_preferences (user_id, remind_at, dismissed_at)
    values (actor_id, null, now())
    on conflict (user_id) do update set remind_at = null,
      dismissed_at = coalesce(public.trainer_discovery_prompt_preferences.dismissed_at, excluded.dismissed_at);
  else
    insert into public.trainer_discovery_prompt_preferences (user_id, remind_at)
    values (actor_id, now() + interval '30 days')
    on conflict (user_id) do update set remind_at = case
      when public.trainer_discovery_prompt_preferences.dismissed_at is null then excluded.remind_at
      else public.trainer_discovery_prompt_preferences.remind_at end;
  end if;
  return public.get_trainer_discovery_prompt();
end;
$$;

revoke all on function public.get_trainer_discovery_prompt() from public;
revoke all on function public.set_trainer_discovery_prompt(text) from public;
grant execute on function public.get_trainer_discovery_prompt() to fit_api;
grant execute on function public.set_trainer_discovery_prompt(text) to fit_api;

-- Down Migration

revoke execute on function public.set_trainer_discovery_prompt(text) from fit_api;
revoke execute on function public.get_trainer_discovery_prompt() from fit_api;
drop function public.set_trainer_discovery_prompt(text);
drop function public.get_trainer_discovery_prompt();
drop policy trainer_discovery_prompt_manage_own on public.trainer_discovery_prompt_preferences;
drop table public.trainer_discovery_prompt_preferences;
