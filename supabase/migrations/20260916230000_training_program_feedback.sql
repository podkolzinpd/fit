alter table public.app_feedback
  add column model_input_json jsonb,
  add column model_output_json jsonb,
  drop constraint app_feedback_kind_check,
  add constraint app_feedback_kind_check check (kind in ('suggestion', 'problem', 'training program')),
  add constraint app_feedback_training_program_payloads
    check ((kind = 'training program') = (model_input_json is not null and model_output_json is not null));

create function public.submit_app_feedback(
  p_kind text, p_message text, p_screen_path text, p_app_version text,
  p_display_mode text, p_user_agent text, p_model_input_json jsonb, p_model_output_json jsonb
)
returns uuid language plpgsql security definer set search_path = pg_catalog, public as $$
declare actor_id uuid := auth.uid(); actor_role text; feedback_id uuid; normalized_kind text := lower(btrim(p_kind));
begin
  if actor_id is null then raise exception 'authentication_required' using errcode = 'PT401'; end if;
  select profile.account_role into actor_role from public.profiles profile where profile.id = actor_id;
  if actor_role not in ('trainer', 'client') then raise exception 'profile_not_found' using errcode = 'PT403'; end if;
  if normalized_kind not in ('suggestion', 'problem', 'training program')
    or (normalized_kind = 'training program' and (p_model_input_json is null or p_model_output_json is null))
    or (normalized_kind <> 'training program' and (p_model_input_json is not null or p_model_output_json is not null)) then
    raise exception 'app_feedback_invalid' using errcode = 'PT422';
  end if;
  insert into public.app_feedback (user_id, account_role, kind, message, screen_path, app_version, display_mode, user_agent, model_input_json, model_output_json)
  values (actor_id, actor_role, normalized_kind, btrim(p_message), left(coalesce(nullif(btrim(p_screen_path), ''), '/'), 500), left(coalesce(nullif(btrim(p_app_version), ''), 'unknown'), 64), lower(btrim(p_display_mode)), left(coalesce(nullif(btrim(p_user_agent), ''), 'unknown'), 512), p_model_input_json, p_model_output_json)
  returning id into feedback_id;
  return feedback_id;
end;
$$;

revoke all on function public.submit_app_feedback(text, text, text, text, text, text, jsonb, jsonb) from public, anon;
grant execute on function public.submit_app_feedback(text, text, text, text, text, text, jsonb, jsonb) to authenticated;
