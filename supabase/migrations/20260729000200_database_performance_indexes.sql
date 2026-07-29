-- Уникальные ограничения уже создают индексы с теми же ключами.
-- Отдельные неуникальные копии только замедляют запись workout aggregate.
drop index if exists public.workout_exercises_workout_position_idx;
drop index if exists public.workout_sets_exercise_position_idx;

-- UNIQUE (auth_user_id) уже обслуживает lookup привязанной карточки.
drop index if exists public.clients_auth_user_idx;

-- list_workouts сначала ограничивает открытое пространство client_id,
-- исключает удалённые записи и сортирует страницу в стабильном порядке.
create index if not exists workouts_active_client_date_idx
  on public.workouts (
    client_id,
    workout_date,
    start_time,
    created_at,
    id
  )
  where deleted_at is null;

-- Тренерский доступ дополнительно ограничен автором назначения. Индекс также
-- обслуживает FK created_by и будущий actor-scoped план list_workouts.
create index if not exists workouts_active_author_client_date_idx
  on public.workouts (
    created_by,
    client_id,
    workout_date,
    start_time,
    created_at,
    id
  )
  where deleted_at is null;

-- История прогресса общая, но trainer mutations проверяют created_by.
-- Индекс одновременно ускоряет ownership check и обслуживание FK.
create index if not exists client_progress_created_by_client_idx
  on public.client_progress (created_by, client_id)
  where created_by is not null;

-- Активные приглашения читаются по клиенту в обратном порядке создания.
-- Исторические claimed/revoked строки не раздувают hot-path индекс.
create index if not exists client_invitations_active_client_created_idx
  on public.client_invitations (client_id, created_at desc)
  where claimed_at is null and revoked_at is null;
