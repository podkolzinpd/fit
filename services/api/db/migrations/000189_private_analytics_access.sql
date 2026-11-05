-- Up Migration

-- Operator-managed identities: bind the first provider-verified subject and
-- do not transfer access if a login is subsequently assigned to another user.
create table app_private.private_analytics_logins (
  login_sha256 text primary key check (login_sha256 ~ '^[0-9a-f]{64}$'),
  subject_sha256 text unique check (subject_sha256 ~ '^[0-9a-f]{64}$'),
  enabled boolean not null default false,
  bound_at timestamptz,
  created_at timestamptz not null default now()
);
alter table app_private.private_analytics_logins enable row level security;
revoke all on app_private.private_analytics_logins from public, fit_api;

create function app_private.bind_private_analytics_login(p_subject text, p_login text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_subject is null or p_login is null or p_subject !~ '^[0-9a-f]{64}$' or p_login !~ '^[0-9a-f]{64}$' then
    return false;
  end if;
  update app_private.private_analytics_logins
     set subject_sha256 = p_subject, bound_at = coalesce(bound_at, now())
   where login_sha256 = p_login and enabled
     and (subject_sha256 is null or subject_sha256 = p_subject);
  return found;
exception when unique_violation then
  return false;
end $$;
revoke all on function app_private.bind_private_analytics_login(text, text) from public;
grant execute on function app_private.bind_private_analytics_login(text, text) to fit_api;

create function app_private.is_private_analytics_allowed()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from app_private.private_analytics_logins allowed
    join app_private.auth_identities identity on identity.provider = 'yandex'
      and identity.provider_subject_sha256 = allowed.subject_sha256
    where allowed.enabled and identity.profile_id = auth.uid()
  )
$$;
revoke all on function app_private.is_private_analytics_allowed() from public;
grant execute on function app_private.is_private_analytics_allowed() to fit_api;

create function app_private.private_analytics_bundle()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not app_private.is_private_analytics_allowed() then
    raise exception using errcode = 'PT403', message = 'analytics_forbidden';
  end if;
  return jsonb_build_object(
    'trainersTotal', (select trainers_total from analytics.trainers_metrics),
    'trainers', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from (
      select trainer_status, trainer_id, registered_at, last_active_at, last_sign_in_at, days_since_last_activity,
        clients_added_30d, clients_added_7d, clients_total, clients_app_linked, clients_archived, last_workout_at,
        workouts_done_7d_by_client, workouts_done_7d_by_trainer, workouts_total, workouts_planned, workouts_in_progress,
        workouts_done, workouts_cancelled_total, assistant_messages_total, last_assistant_message_at, clients_with_notes_total,
        last_client_notes_at, custom_exercises_total, last_custom_exercise_at, exercises_unique_used, goals_created_total,
        last_goal_activity_at, progress_entries_total, last_progress_entry_at, summaries_published_total,
        last_summary_published_at, is_test_account from analytics.trainer_overview where is_test_account = false
    ) t),
    'clients', (select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) from (
      select registered_at, last_sign_in_at, client_id, client_status, last_client_activity_at, days_since_last_activity,
        is_self_registered, is_test_account, workouts_total, workouts_done, workouts_in_progress, workouts_planned,
        questions_asked_total, last_question_asked_at, goals_created_total, last_goal_activity_at, custom_exercises_total,
        last_custom_exercise_at, connection_changes_total, last_connection_change_at from analytics.client_overview
      where is_test_account = false
    ) c),
    'feedback', (select coalesce(jsonb_agg(to_jsonb(f) order by f.created_at desc), '[]'::jsonb)
      from (select id, message, account_role, created_at, display_mode, email, kind, screen_path
            from analytics.app_feedback) f),
    'computedAt', now()
  );
end $$;
revoke all on function app_private.private_analytics_bundle() from public;
grant execute on function app_private.private_analytics_bundle() to fit_api;

-- Down Migration
drop function app_private.private_analytics_bundle();
drop function app_private.is_private_analytics_allowed();
drop function app_private.bind_private_analytics_login(text, text);
drop table app_private.private_analytics_logins;
