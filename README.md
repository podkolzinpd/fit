# Fit V2

Новая версия приложения для персональных тренеров. Проект переносит пользовательские сценарии из legacy `trainer-app`, но строит их на воспроизводимой схеме Supabase, типизированном data-слое и обязательных тестах.

## Быстрый старт

```bash
npm ci
npm run dev
```

`npm run dev` сначала запускает локальный Supabase, затем frontend. Для этого нужен Docker-совместимый runtime. Локальные значения уже зафиксированы в `.env.development`; production Supabase используется только в Vercel.

После `npm run db:reset` доступны локальные демонстрационные аккаунты:

- тренер: `trainer@fit.local` / `FitLocal123!`;
- клиент: `client@fit.local` / `FitLocal123!`.

Клиент связан с демо-профилем Анны Смирновой и может сам запросить или обновить
клиентскую версию AI-анализа. Эти учётные данные существуют только в локальной
seed-базе.

Для пересоздания и проверки локальной базы:

```bash
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
