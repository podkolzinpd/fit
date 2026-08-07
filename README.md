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

## iOS build (Capacitor)

Веб-приложение оборачивается в нативный iOS-шелл через [Capacitor](https://capacitorjs.com) — без форка кода, тот же React-код работает внутри WKWebView. Нативный проект лежит в `ios/` (закоммичен, кроме build output/Pods — см. `ios/.gitignore`). Используется SPM-интеграция Capacitor (без CocoaPods/Podfile).

1. Установите Xcode.
2. `npm install`
3. Убедитесь, что release-переменные Supabase доступны сборке через локальный
   игнорируемый env-файл или защищённое окружение. Не добавляйте их в Git и не
   печатайте в логах.
4. `npm run ios:open` — соберёт release-parity bundle, засинкает его в `ios/` и
   откроет Xcode-проект. Запуск на симулятор/устройство — оттуда.
5. После любых изменений в `src/` перезапустите `npm run ios:sync` (или `ios:open`) — Xcode не пересобирает веб-бандл сам.

Для изолированной проверки интерфейса с локальной БД сначала запустите Supabase
через `npm run db:start`, затем используйте `npm run ios:open:local`. Этот режим
намеренно не подменяет обычную нативную сборку: без отдельно переданных
настроек Yandex Cloud локальная Edge Function не выполняет живой LLM-разбор.

Светлая тема используется по умолчанию во всех сборках. Для временного отката
на тёмную соберите приложение с `VITE_APP_THEME=dark`.

**Известное ограничение:** вход через Google не работает в iOS-сборке. Google блокирует OAuth внутри встроенных WebView (`disallowed_useragent`), `signInWithOAuth` нужно будет перенаправлять через системный браузер (`@capacitor/browser`) с custom URL scheme редиректом обратно в приложение — пока не реализовано. Вход по email/паролю работает штатно.

## Обязательные документы

- [docs/PRODUCT_WIKI.md](./docs/PRODUCT_WIKI.md) — актуальная продуктовая wiki с описанием реализованного функционала.
- [AGENTS.md](./AGENTS.md) — правила для людей и ИИ-агентов.
- [docs/FIT_WORKFLOW.md](./docs/FIT_WORKFLOW.md) — компактный процесс выполнения задач с загрузкой контекста по необходимости.
- [docs/CURRENT_STATE.md](./docs/CURRENT_STATE.md) — короткая автоматически обновляемая точка продолжения между сессиями.
- [ARCHITECTURE.md](./ARCHITECTURE.md) — границы слоёв и работа с БД.
- [FEATURE_PARITY.md](./FEATURE_PARITY.md) — контракт переноса V1.
- [AI_AGENT_PROMPT.md](./AI_AGENT_PROMPT.md) — промпт, который добавляется к каждой задаче агента.
- [docs/AI_AGENT_ONBOARDING.md](./docs/AI_AGENT_ONBOARDING.md) — выдача доступа к GitHub и полная локальная настройка ИИ-агента.
- [OPERATIONS.md](./OPERATIONS.md) — secrets, Google OAuth, автодеплой БД и release gates.

Текущий foundation переносит базовые CRUD и основной trainer flow. Полный статус переноса и ещё не закрытые UX-сценарии перечислены в `FEATURE_PARITY.md`; до их закрытия V1 не архивируется.
