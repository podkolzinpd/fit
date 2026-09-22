# Происхождение тренировки (origin) + название избранного на карточке

Согласовано с пользователем в сессии 2026-09-19, реализация была отложена до
снятия техобслуживания (`VITE_MAINTENANCE_MODE`); снято, реализация начата
2026-09-22. Два независимых, но связанных пункта одной задачи — ведутся как
два PR по естественной границе (SQL-ядро с статусом сначала, визуальный
снэпшот избранного вторым), но acceptance проверяется по этому единому
чек-листу.

## 1. Поле `origin` и третий статус «кем создана»

**Модель.** Новая колонка `workouts.origin text not null default 'manual'
check (origin in ('manual', 'ai'))`. Пишется **один раз** при создании
тренировки и никогда не обновляется — никакого отслеживания «ИИ, но
отредактировано человеком»: удержали щедрую атрибуцию сознательно (см. ниже
Why). Тренерская ветка (`created_by` резолвится в тренера) **не участвует**
в `origin` вообще — `clientWorkoutAuthorLabel` для неё не меняется.

**Где `origin='ai'` действительно ставится:** только когда тренировку
СОЗДАЛ ассистент как часть сгенерированной программы — `assistant_actions.tool
in ('create_program_draft', 'schedule_program')`. **НЕ** ставится для
`record_workout` (голосовое/текстовое логирование уже выполненной тренировки
через ассистента) — это не ИИ-контент, а быстрый ввод СВОЕЙ тренировки,
концептуально то же самое, что и текстовый quick-entry без ассистента; тот
же принцип, что и для избранного ниже («не наследует происхождение»).

**Единая точка вставки на каждом бэкенде** (проверено по живой БД
`pg_get_functiondef`, не по истории миграций):
- Supabase: `private.legacy_save_workout(p_workout, p_expected_version,
  p_actor_id)` — единственный `insert into public.workouts` (ветка `root_id is
  null`), общий для `save_workout`/`save_completed_workout` через
  `legacy_save_workout_request`/`legacy_save_completed_workout`. Добавить
  колонку `origin` в insert:
  `case when p_workout->>'origin' = 'ai' then 'ai' else 'manual' end`.
- Yandex: `app_private.save_planned_workout_without_cross_partition_snapshots`
  — единственный `insert into public.workouts` (ветка `requested_workout_id is
  null`), общий для `save_planned_workout`/`save_completed_workout` (последний
  вызывает первый). Тот же `case`-выражение.
- `apply_assistant_action` на обоих бэкендах: в ветке
  `create_program_draft`/`schedule_program`, перед вызовом
  `save_workout`/`save_planned_workout`, подмешать
  `workout_item || jsonb_build_object('origin', 'ai')` (SQL-to-SQL вызов,
  TS-валидация запроса не участвует — `origin` никогда не приходит от
  фронтенда).
- Обратная совместимость: существующие строки на `default 'manual'` — для
  уже применённых `create_program_draft`/`schedule_program` (данные пилота)
  сделать data backfill в той же миграции через
  `assistant_actions.result->'workoutIds'` (`status='applied'`, нужный `tool`).

**Статус-модель (упрощённая, финальная версия после обсуждения):**
`clientWorkoutAuthorLabel` (`src/features/clients/workout-author.ts`)
получает новый параметр `origin` и третью ветку:
- `createdBy` отсутствует или равен `clientUserId`, `origin === 'ai'` →
  **«Создано ИИ»**.
- `createdBy` отсутствует или равен `clientUserId`, иначе → **«Создано
  вами»** (без изменений).
- `createdBy` — тренер → **«Назначил {имя}» / «Назначена тренером»** (без
  изменений, `origin` не влияет).

**Домен и чтение.** `Workout.origin: 'manual' | 'ai'` в `src/shared/domain.ts`.
Прокинуть колонку через `rootColumns`/`mapWorkout` (Supabase,
`workouts.queries.ts` + `workouts.repository.ts`) и через
`list_workouts`/`list_workout_summaries`/`getRoot`-эквиваленты на Yandex.

**Why (мотивация щедрой атрибуции).** ИИ-тренировки — заявленная
отличительная фича продукта, поэтому метка «ИИ» сохраняется, даже если
человек затем сильно отредактировал тренировку. Явно зафиксированный риск:
если после запуска пойдут жалобы «почему тут ИИ, я всё переписал сам» — это
сигнал вернуться к более точной модели (например, добавить статус «на базе
ИИ»), а не проектная ошибка сейчас.

## 2. Снэпшот названия избранного на карточке

**Модель.** Новая колонка `workouts.favorite_title text` (nullable) —
снэпшот `favorite_workouts.title` **на момент планирования**, не живая
ссылка (избранное можно переименовать/удалить, старые тренировки не должны
от этого меняться). Пишется только при создании через тот же единственный
insert, что и `origin`, из `p_workout->>'favoriteTitle'`, — то есть тоже
«один раз, никогда не обновляется» просто по факту нахождения только в
INSERT-ветке.

**Тренировка, запланированная из избранного, НЕ наследует `origin='ai'`**,
даже если исходная избранная тренировка была создана ИИ — планирование из
избранного считается самостоятельным ручным действием (не тянем цепочку
провенанса произвольной длины).

**Путь данных:**
- `FavoriteWorkoutTemplate.title` уже есть в домене — прокинуть его через
  `favoriteTemplateToWorkoutDraft(exercises, clientId, workoutDate,
  favoriteTitle)` (новый 4-й параметр) в `WorkoutDraft.favoriteTitle`.
  Вызывающий код — `WorkoutsPages.tsx:532`, уже держит объект `favorite` с
  `.title`.
- Supabase: `toJson(draft)` уже сериализует весь `WorkoutDraft` — новое поле
  дойдёт до `save_workout` без правок `workouts.queries.ts`.
- Yandex: `PlannedWorkoutDraft`/`readSavePlannedWorkoutRequest`
  (`services/api/src/planned-workout-request.ts`) — явный whitelist полей,
  нужно добавить `favoriteTitle?: string | null`, валидация — переиспользовать
  уже существующий `readFavoriteWorkoutTitle` (max 120, тот же лимит, что и
  при сохранении в избранное).

**UI — вариант C3 (согласован, макет на рабочем столе пользователя,
`fit-workout-card-c3-truncated.html`):** звёздочка + название в той же
строке, что уже показывает автора («⭐ Название · Создано вами»), без
отдельных пилюль-бейджей (единственный существующий прецедент пилюли в
приложении — `👑 Бренд-тренер», решили не множить этот паттерн). Название
обрезается по символам через чистую функцию `truncateFavoriteTitle(title,
max)`, рекомендованный лимит — 24 символа; суффикс с автором не обрезается
никогда — обрезаем только сам заголовок. Затронутые карточки — актуальные
компоненты списка «Мои тренировки» на момент реализации (сверить с текущим
кодом `WorkoutsPages.tsx`, UI прошёл редизайн миниатюр с момента
согласования плана — 2026-09-19).

## Границы и что явно не входит

- Тренерская сторона (видимость `origin`/статуса на экранах тренера) —
  отдельная задача, не начинать в этом PR. `clientWorkoutAuthorLabel` уже
  рендерится только в клиентском режиме — расширять видимость не нужно.
- `record_workout` через ассистента НЕ получает `origin='ai'` (см. выше).
- Никакого intermediate-статуса «на базе ИИ» — сознательно отложено, см. Why.

## Проверка

1. `npm run db:reset && npm run db:test` (Supabase) — pgTAP на insert с
   `origin`, на data backfill существующих `assistant_actions`, на
   `favorite_title` snapshot vs. переименование/удаление избранного.
2. `npm run local:verify` (Yandex) — то же на PostgreSQL 17.
3. Unit: `clientWorkoutAuthorLabel` (3 ветки), `truncateFavoriteTitle`,
   `favoriteTemplateToWorkoutDraft` с `favoriteTitle`.
4. Component/e2e: карточка показывает «Создано ИИ» после применения
   сгенерированной программы; «Создано вами» для обычного ручного
   планирования и для тренировки из избранного (даже если исходная была
   ИИ); звёздочка + обрезанное название только у тренировок, запланированных
   из избранного.
5. Ручная проверка на 390 px, light/dark, длинное название (>24 символов).
