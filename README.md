# Fit V2

Новая версия приложения для персональных тренеров. Проект переносит пользовательские сценарии из legacy `trainer-app`, но строит их на воспроизводимой схеме Supabase, типизированном data-слое и обязательных тестах.

## Быстрый старт

```bash
npm ci
cp .env.example .env.local
npm run dev
```

Для локальной базы нужен Docker-совместимый runtime:

```bash
npm run db:start
npm run db:reset
npm run db:test
```

Полная проверка перед PR:

```bash
npm run check
```

## Обязательные документы

- [AGENTS.md](./AGENTS.md) — правила для людей и ИИ-агентов.
- [ARCHITECTURE.md](./ARCHITECTURE.md) — границы слоёв и работа с БД.
- [FEATURE_PARITY.md](./FEATURE_PARITY.md) — контракт переноса V1.
- [AI_AGENT_PROMPT.md](./AI_AGENT_PROMPT.md) — промпт, который добавляется к каждой задаче агента.
- [OPERATIONS.md](./OPERATIONS.md) — secrets, Google OAuth, автодеплой БД и release gates.

Текущий foundation переносит базовые CRUD и основной trainer flow. Полный статус переноса и ещё не закрытые UX-сценарии перечислены в `FEATURE_PARITY.md`; до их закрытия V1 не архивируется.
