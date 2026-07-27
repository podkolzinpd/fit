# Архитектура Fit V2

## Направление зависимостей

```text
route/page → feature UI/hooks → repository → query → Supabase Data API/RPC
```

- `app` собирает router/providers и не содержит бизнес-правил.
- `features` владеют пользовательскими сценариями и экспортируют только публичный API.
- `repositories` возвращают доменные DTO и нормализованные ошибки.
- `queries` содержат явные select/insert/update/delete/RPC вызовы.
- `shared` не импортирует features или data repositories.

## Состояние

- URL: экран, UUID сущностей, выбранные дата/метрика.
- TanStack Query: server state и invalidation.
- React Hook Form: form drafts и validation.
- Local component state: sheet/modal/timer.
- Auth provider: discriminated `SessionActor` (`trainer` или `client`) и lifecycle сессии.

## База данных

- Миграции — полная воспроизводимая история схемы и security objects.
- Обычный CRUD одной таблицы — Data API через query module.
- Workout/progress aggregates — explicit RPC, одна транзакция.
- RLS — финальная граница tenant access; UUID не является механизмом авторизации.
- `version` обеспечивает optimistic concurrency для mutable aggregate roots.

## Решения

- UUIDv4 для PK/FK бизнес-сущностей.
- Один тренер на клиента; nullable client auth link зарезервирован.
- Возраст — число лет; дата рождения не хранится.
- Вес — только временной ряд progress; карточка показывает последний замер.
- System exercises — versioned application catalog; workout хранит snapshot.
- Все существующие заметки считаются тренерскими.
- Calendar dates обрабатываются без UTC-конверсии.

## Роли и клиентский контур

- Роль не берётся из `user_metadata`: сначала ищется клиентская связь
  `clients.auth_user_id = auth.uid()`, затем существующий `trainers.profile_id`.
  Только новый непривязанный аккаунт явно инициализируется как тренер.
- Тренерские и клиентские routes находятся под разными role guards. Попытка
  открыть чужой контур возвращает пользователя на домашний экран его роли.
- Приглашение клиента выполняет только `invite-client` Edge Function. Service
  role остаётся на сервере; браузер передаёт только JWT тренера, `client_id` и
  email.

## AI-суммаризация прогресса

```text
done workouts → deterministic aggregates → one YandexGPT request
                                           ├─ trainer_summary (internal)
                                           └─ client_summary (safe)

trainer request ───────────────┐
client request → self-service → client_published_training_summaries
                                → linked client read-only UI
```

- `client_training_summaries` доступна для чтения только тренеру и хранит обе
  сгенерированные версии, fingerprint, usage и точные display metrics.
- `client_published_training_summaries` физически не содержит внутренний текст.
  Это исключает утечку тренерских замечаний через прямой Data API.
- Publish/unpublish — атомарные RPC с ownership check и optimistic version;
  публикация тренером остаётся необязательным способом отредактировать текст.
- Клиент может сам вызвать `summarize-client-training`: функция проверяет связь
  `clients.auth_user_id`, генерирует обе версии, сохраняет внутреннюю на сервере
  и сразу кладёт только `client_summary` в безопасную таблицу.
