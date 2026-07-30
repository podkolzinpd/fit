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
3. В `.env.local` (не коммитится) укажите production Supabase значения из Vercel — iOS-сборка использует их на этапе билда, приложение откроется с пустым экраном без ошибки, если их нет:
   ```
   VITE_SUPABASE_URL=https://xwfuzfkuhblswpdludbc.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=<publishable key>
   ```
4. `npm run ios:open` — соберёт веб-приложение, засинкает его в `ios/` и откроет Xcode-проект. Запуск на симулятор/устройство — оттуда.
5. После любых изменений в `src/` перезапустите `npm run ios:sync` (или `ios:open`) — Xcode не пересобирает веб-бандл сам.

Светлая тема используется по умолчанию во всех сборках. Для временного отката
на тёмную соберите приложение с `VITE_APP_THEME=dark`.

**Известное ограничение:** вход через Google не работает в iOS-сборке. Google блокирует OAuth внутри встроенных WebView (`disallowed_useragent`), `signInWithOAuth` нужно будет перенаправлять через системный браузер (`@capacitor/browser`) с custom URL scheme редиректом обратно в приложение — пока не реализовано. Вход по email/паролю работает штатно.

## Обязательные документы

- [AGENTS.md](./AGENTS.md) — правила для людей и ИИ-агентов.
- [ARCHITECTURE.md](./ARCHITECTURE.md) — границы слоёв и работа с БД.
- [FEATURE_PARITY.md](./FEATURE_PARITY.md) — контракт переноса V1.
- [AI_AGENT_PROMPT.md](./AI_AGENT_PROMPT.md) — промпт, который добавляется к каждой задаче агента.
- [OPERATIONS.md](./OPERATIONS.md) — secrets, Google OAuth, автодеплой БД и release gates.

Текущий foundation переносит базовые CRUD и основной trainer flow. Полный статус переноса и ещё не закрытые UX-сценарии перечислены в `FEATURE_PARITY.md`; до их закрытия V1 не архивируется.
