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
- Auth provider: `SessionActor` с неизменяемой ролью `trainer | client` и lifecycle сессии.

## База данных

- Миграции — полная воспроизводимая история схемы и security objects.
- Обычный CRUD одной таблицы — Data API через query module.
- Workout/progress aggregates — explicit RPC, одна транзакция.
- RLS — финальная граница tenant access; UUID не является механизмом авторизации.
- `version` обеспечивает optimistic concurrency для mutable aggregate roots.

## Решения

- UUIDv4 для PK/FK бизнес-сущностей.
- Один тренер на клиента остаётся текущим data-контрактом; `auth_user_id` связывает карточку с клиентским аккаунтом. Переход к нескольким тренерам выполняется отдельной membership-миграцией.
- Роль аккаунта выбирается при регистрации и после инициализации не меняется. Клиентский аккаунт не создаёт tenant-запись тренера.
- Возраст — число лет; дата рождения не хранится.
- Вес — только временной ряд progress; карточка показывает последний замер.
- System exercises — versioned application catalog; workout хранит snapshot.
- Все существующие заметки считаются тренерскими.
- Calendar dates обрабатываются без UTC-конверсии.
