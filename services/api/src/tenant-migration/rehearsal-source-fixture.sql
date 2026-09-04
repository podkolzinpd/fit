begin;

-- This fixture enriches only the committed local Supabase demo cohort. All
-- identifiers and values are synthetic, deterministic and safe to reapply.
insert into public.client_trainers (client_id, trainer_id)
values (
  '11111111-1111-4111-8111-111111111111',
  '90000000-0000-4000-8000-000000000009'
)
on conflict do nothing;

insert into public.clients (
  id,
  trainer_id,
  full_name,
  gender,
  age_years,
  age_updated_at,
  height_cm,
  goal,
  archived_at,
  merged_into_client_id,
  created_at,
  updated_at
)
values (
  '11111111-1111-4111-8111-111111111112',
  '90000000-0000-4000-8000-000000000009',
  'Архивный тестовый профиль',
  'female',
  31,
  date '2026-07-01',
  168,
  'Проверка переноса истории объединения',
  timestamptz '2026-08-01 09:00:00+00',
  '11111111-1111-4111-8111-111111111111',
  timestamptz '2026-07-01 09:00:00+00',
  timestamptz '2026-08-01 09:00:00+00'
)
on conflict do nothing;

insert into public.client_trainers (client_id, trainer_id, joined_at)
values (
  '11111111-1111-4111-8111-111111111112',
  '90000000-0000-4000-8000-000000000009',
  timestamptz '2026-07-01 09:00:00+00'
)
on conflict do nothing;

insert into public.client_invitations (
  id,
  client_id,
  created_by,
  target_role,
  code_hash,
  expires_at,
  claimed_by,
  claimed_at,
  created_at
)
values (
  '96000000-0000-4000-8000-000000000061',
  '11111111-1111-4111-8111-111111111111',
  '90000000-0000-4000-8000-000000000009',
  'client',
  '8a4e871d845e1b335562b576f3c668c16f4e5325faf760a359c9136bf5b2c90d',
  timestamptz '2027-01-01 00:00:00+00',
  '92000000-0000-4000-8000-000000000029',
  timestamptz '2026-08-01 09:10:00+00',
  timestamptz '2026-08-01 09:00:00+00'
)
on conflict (id) do update
set code_hash = excluded.code_hash;

insert into public.client_trainer_relationships (
  id,
  client_id,
  trainer_id,
  status,
  connected_at,
  connected_by,
  source_invitation_id,
  created_at,
  updated_at
)
values (
  '96000000-0000-4000-8000-000000000062',
  '11111111-1111-4111-8111-111111111111',
  '90000000-0000-4000-8000-000000000009',
  'active',
  timestamptz '2026-08-01 09:10:00+00',
  '90000000-0000-4000-8000-000000000009',
  '96000000-0000-4000-8000-000000000061',
  timestamptz '2026-08-01 09:10:00+00',
  timestamptz '2026-08-01 09:10:00+00'
)
on conflict do nothing;

insert into public.client_merge_operations (
  id,
  source_client_id,
  target_client_id,
  invitation_id,
  actor_id,
  status,
  dependency_counts_before,
  dependency_counts_after,
  completed_at,
  created_at
)
values (
  '96000000-0000-4000-8000-000000000063',
  '11111111-1111-4111-8111-111111111112',
  '11111111-1111-4111-8111-111111111111',
  '96000000-0000-4000-8000-000000000061',
  '90000000-0000-4000-8000-000000000009',
  'completed',
  '{"workouts":0,"progress":0}'::jsonb,
  '{"workouts":0,"progress":0}'::jsonb,
  timestamptz '2026-08-01 09:20:00+00',
  timestamptz '2026-08-01 09:15:00+00'
)
on conflict do nothing;

insert into public.custom_exercises (
  id,
  trainer_id,
  name,
  muscle_group,
  input_kind,
  created_by,
  created_at,
  updated_at
)
values (
  '96000000-0000-4000-8000-000000000064',
  '90000000-0000-4000-8000-000000000009',
  'Локальная тяга с паузой',
  'back',
  'strength',
  '90000000-0000-4000-8000-000000000009',
  timestamptz '2026-08-02 08:00:00+00',
  timestamptz '2026-08-02 08:00:00+00'
)
on conflict do nothing;

insert into public.client_custom_metrics (
  id,
  trainer_id,
  client_id,
  name,
  unit,
  created_at,
  updated_at
)
values (
  '96000000-0000-4000-8000-000000000065',
  '90000000-0000-4000-8000-000000000009',
  '11111111-1111-4111-8111-111111111111',
  'Пульс восстановления',
  'уд/мин',
  timestamptz '2026-08-02 08:10:00+00',
  timestamptz '2026-08-02 08:10:00+00'
)
on conflict do nothing;

insert into public.client_progress_custom (
  id,
  trainer_id,
  client_id,
  progress_id,
  metric_id,
  value,
  created_at,
  updated_at
)
values (
  '96000000-0000-4000-8000-000000000066',
  '90000000-0000-4000-8000-000000000009',
  '11111111-1111-4111-8111-111111111111',
  '94000000-0000-4000-8000-000000000042',
  '96000000-0000-4000-8000-000000000065',
  118,
  timestamptz '2026-08-02 08:20:00+00',
  timestamptz '2026-08-02 08:20:00+00'
)
on conflict do nothing;

insert into public.client_goals (
  id,
  client_id,
  trainer_id,
  created_by,
  title,
  target_date,
  status,
  created_at,
  updated_at
)
values (
  '96000000-0000-4000-8000-000000000067',
  '11111111-1111-4111-8111-111111111111',
  '90000000-0000-4000-8000-000000000009',
  '90000000-0000-4000-8000-000000000009',
  'Снизить вес без потери силы',
  date '2026-12-01',
  'active',
  timestamptz '2026-08-03 08:00:00+00',
  timestamptz '2026-08-03 08:00:00+00'
)
on conflict do nothing;

insert into public.goal_stages (
  id,
  goal_id,
  trainer_id,
  client_id,
  title,
  starts_on,
  ends_on,
  position,
  created_at,
  updated_at
)
values (
  '96000000-0000-4000-8000-000000000068',
  '96000000-0000-4000-8000-000000000067',
  '90000000-0000-4000-8000-000000000009',
  '11111111-1111-4111-8111-111111111111',
  'Стабильный режим',
  date '2026-08-03',
  date '2026-09-30',
  0,
  timestamptz '2026-08-03 08:10:00+00',
  timestamptz '2026-08-03 08:10:00+00'
)
on conflict do nothing;

insert into public.goal_criteria (
  id,
  goal_id,
  trainer_id,
  client_id,
  created_by,
  metric,
  operation,
  target_value,
  unit,
  confirmation_status,
  confirmed_by,
  confirmed_at,
  position,
  baseline_value,
  baseline_recorded_on,
  baseline_progress_id,
  created_at,
  updated_at
)
values (
  '96000000-0000-4000-8000-000000000069',
  '96000000-0000-4000-8000-000000000067',
  '90000000-0000-4000-8000-000000000009',
  '11111111-1111-4111-8111-111111111111',
  '90000000-0000-4000-8000-000000000009',
  'weight',
  'decrease_to',
  64,
  'кг',
  'confirmed',
  '90000000-0000-4000-8000-000000000009',
  timestamptz '2026-08-03 08:20:00+00',
  0,
  65.8,
  date '2026-07-27',
  '94000000-0000-4000-8000-000000000042',
  timestamptz '2026-08-03 08:15:00+00',
  timestamptz '2026-08-03 08:20:00+00'
)
on conflict do nothing;

insert into public.workouts (
  id,
  trainer_id,
  client_id,
  workout_date,
  start_time,
  end_time,
  status,
  notes,
  started_at,
  completed_at,
  version,
  created_at,
  updated_at,
  created_by,
  stage_id,
  trainer_review,
  client_comment,
  session_rpe,
  wellbeing,
  discomfort,
  trainer_reaction,
  trainer_review_author_id,
  trainer_reviewed_at,
  updated_by,
  client_question,
  client_question_asked_at,
  client_question_resolved_at,
  feedback_submitted_at
)
values (
  '97000000-0000-4000-8000-000000000071',
  '90000000-0000-4000-8000-000000000009',
  '11111111-1111-4111-8111-111111111111',
  date '2026-08-04',
  time '10:00',
  time '11:00',
  'done',
  'Репетиция полного workout lifecycle',
  timestamptz '2026-08-04 07:00:00+00',
  timestamptz '2026-08-04 08:00:00+00',
  5,
  timestamptz '2026-08-03 09:00:00+00',
  timestamptz '2026-08-04 08:30:00+00',
  '90000000-0000-4000-8000-000000000009',
  '96000000-0000-4000-8000-000000000068',
  'Техника стабильная, продолжать по плану.',
  'Небольшой дискомфорт в конце подхода.',
  8,
  'normal',
  true,
  'fire',
  '90000000-0000-4000-8000-000000000009',
  timestamptz '2026-08-04 08:30:00+00',
  '92000000-0000-4000-8000-000000000029',
  'Стоит ли снизить вес в следующей тренировке?',
  timestamptz '2026-08-04 08:10:00+00',
  timestamptz '2026-08-04 08:30:00+00',
  timestamptz '2026-08-04 08:05:00+00'
)
on conflict do nothing;

insert into public.workout_exercises (
  id,
  workout_id,
  trainer_id,
  client_id,
  position,
  exercise_source,
  exercise_ref,
  custom_exercise_id,
  exercise_name,
  muscle_group,
  input_kind,
  created_at,
  updated_at,
  block_id,
  block_type,
  block_rounds,
  trainer_comment,
  block_preset,
  rest_between_exercises_sec,
  rest_between_rounds_sec,
  rest_between_sets_sec,
  updated_by
)
values (
  '97000000-0000-4000-8000-000000000072',
  '97000000-0000-4000-8000-000000000071',
  '90000000-0000-4000-8000-000000000009',
  '11111111-1111-4111-8111-111111111111',
  0,
  'custom',
  'local-rehearsal-custom-pull',
  '96000000-0000-4000-8000-000000000064',
  'Локальная тяга с паузой',
  'back',
  'strength',
  timestamptz '2026-08-03 09:10:00+00',
  timestamptz '2026-08-04 08:00:00+00',
  '97000000-0000-4000-8000-000000000073',
  'single',
  1,
  'Контролировать паузу в верхней точке.',
  'set',
  0,
  90,
  120,
  '90000000-0000-4000-8000-000000000009'
)
on conflict do nothing;

insert into public.workout_sets (
  id,
  workout_exercise_id,
  trainer_id,
  client_id,
  position,
  plan_weight_kg,
  plan_reps,
  fact_weight_kg,
  fact_reps,
  confirmed_at,
  version,
  created_at,
  updated_at,
  plan_rpe,
  fact_rpe,
  updated_by
)
values (
  '97000000-0000-4000-8000-000000000074',
  '97000000-0000-4000-8000-000000000072',
  '90000000-0000-4000-8000-000000000009',
  '11111111-1111-4111-8111-111111111111',
  0,
  50,
  8,
  50,
  8,
  timestamptz '2026-08-04 07:55:00+00',
  2,
  timestamptz '2026-08-03 09:15:00+00',
  timestamptz '2026-08-04 07:55:00+00',
  8.0,
  8.5,
  '92000000-0000-4000-8000-000000000029'
)
on conflict do nothing;

insert into public.assistant_conversations (
  id,
  owner_id,
  title,
  created_at
)
values (
  '97000000-0000-4000-8000-000000000075',
  '90000000-0000-4000-8000-000000000009',
  'Локальная проверка сводки',
  timestamptz '2026-08-05 09:00:00+00'
)
on conflict do nothing;

insert into public.assistant_messages (
  id,
  conversation_id,
  author,
  content,
  created_at,
  turn_id
)
values (
  '97000000-0000-4000-8000-000000000076',
  '97000000-0000-4000-8000-000000000075',
  'user',
  'Покажи краткую сводку прогресса клиента.',
  timestamptz '2026-08-05 09:01:00+00',
  '97000000-0000-4000-8000-000000000080'
)
on conflict do nothing;

insert into public.assistant_messages (
  id,
  conversation_id,
  author,
  content,
  action,
  created_at,
  turn_id
)
values (
  '97000000-0000-4000-8000-000000000077',
  '97000000-0000-4000-8000-000000000075',
  'assistant',
  'Сводка подготовлена и ожидает подтверждения.',
  '{"id":"97000000-0000-4000-8000-000000000078","status":"proposed","tool":"summarize_progress","title":"Сводка прогресса","description":"Проверить данные перед применением","payload":{}}'::jsonb,
  timestamptz '2026-08-05 09:01:05+00',
  '97000000-0000-4000-8000-000000000080'
)
on conflict do nothing;

insert into public.assistant_actions (
  id,
  owner_id,
  conversation_id,
  assistant_message_id,
  tool,
  status,
  payload,
  created_at,
  updated_at
)
values (
  '97000000-0000-4000-8000-000000000078',
  '90000000-0000-4000-8000-000000000009',
  '97000000-0000-4000-8000-000000000075',
  '97000000-0000-4000-8000-000000000077',
  'summarize_progress',
  'proposed',
  '{}'::jsonb,
  timestamptz '2026-08-05 09:01:05+00',
  timestamptz '2026-08-05 09:01:05+00'
)
on conflict do nothing;

insert into public.app_feedback (
  id,
  user_id,
  account_role,
  kind,
  message,
  screen_path,
  app_version,
  display_mode,
  user_agent,
  created_at
)
values (
  '97000000-0000-4000-8000-000000000079',
  '90000000-0000-4000-8000-000000000009',
  'trainer',
  'suggestion',
  'Синтетический отзыв для репетиции переноса.',
  '/trainer/clients',
  'local-rehearsal',
  'browser',
  'fit-local-rehearsal',
  timestamptz '2026-08-05 09:10:00+00'
)
on conflict do nothing;

insert into public.push_subscriptions (
  user_id,
  endpoint,
  p256dh,
  auth_key,
  created_at
)
values (
  '92000000-0000-4000-8000-000000000029',
  'https://push.invalid/local-rehearsal',
  'local-rehearsal-p256dh',
  'local-rehearsal-auth-key',
  timestamptz '2026-08-05 09:20:00+00'
)
on conflict do nothing;

insert into public.notification_preferences (
  user_id,
  kind,
  enabled,
  updated_at
)
values (
  '92000000-0000-4000-8000-000000000029',
  'workout_reminder',
  false,
  timestamptz '2026-08-05 09:20:00+00'
)
on conflict do nothing;

insert into private.workout_create_requests (
  owner_id,
  request_id,
  workout_id,
  created_at
)
values (
  '90000000-0000-4000-8000-000000000009',
  '98000000-0000-4000-8000-000000000081',
  '97000000-0000-4000-8000-000000000071',
  timestamptz '2026-08-03 09:00:00+00'
)
on conflict do nothing;

commit;
