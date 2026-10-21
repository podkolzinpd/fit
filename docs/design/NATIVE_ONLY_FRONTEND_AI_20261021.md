# Native-only frontend AI transport

Исходная база main96a3f902; перед PR rebase на main3f4950cd (#1757), ветка codex/native-only-frontend-ai, поток assistant-ops.
Открытых PR на старте нет. YAFIT не создавался. Production/resources вне scope.

## Подтверждённая постановка

Давай уберём Supabase AI transport во frontend, оставим native API. Промпты и native-поведение сохраняем, старые локальные AI-сценарии переводим на native fixtures. Дождись зелёного CI.

## Проверка существующего

| Уже работает | Переиспользуем | Действительно меняем | Не проверено |
| --- | --- | --- | --- |
| Native parser/goals/summary/Assistant | URL/header/body/errors/diagnostics | Удаление Supabase/Cloud Function fallback веток | Production/paid LLM |
| Native browser fixture | mockPilot/app-session/product mocks | AI scenarios вместо email/Edge setup | Старый Podman выключен |
| Review/save/goal UI | Existing components/tokens/actions | Runtime UI не меняется | Старые macOS review baselines |
| Media/data queries | Existing Supabase adapters для последующих задач | Ничего | Старые production файлы |

Роли client/trainer; локальный source96a3f902 + task diff, production build не
устанавливался. Review/save проверяются на390/430/1440 в обеих темах. Primary
действия остаются разбор/подтверждение/сохранение, новые UI actions не добавляются.

## Неизменяемая приёмка

1. Parser/goal suggestions/summary/Assistant frontend используют native API.
   Без native app-session authentication_required и ноль HTTP; Supabase token,
   refresh, Edge invoke, direct Cloud Function URL и AI override не используются.
2. Native branches/prompts/server behavior прежние. Media/data transport и
   Cloud Functions/deploy/config/resources не меняются.
3. Локальные AI browser scenarios используют native app-session/API fixtures.
   Product assertions, доступы, клавиатура, сохранение и error/no-retry сохраняются.
4. Полный check и весь CI зелёные до передачи PR.

## Покрытие и проверки

- AST parity4 native branches: тела совпадают побайтно. Exercise data/media
  remainder прежний. Server/prompts/Cloud Functions/workflows не изменены.
- Orphan verified-supabase-session и5 его tests удалены: refresh старой AI
  авторизации больше не вызывается.3 obsolete URL resolver tests заменены
  native request/response и no-session/no-network tests; summary native200/503
  сохранены, direct CF case заменён no-session closure.
- Targeted transport + native Assistant repository:3files/11tests passed.
- Native Chromium9/9: dictation, value extraction, error/no retry, RPE, goal
  confirmation, superset and persisted review. Имена/число browser cases прежние;
  только auth/data/AI setup переведён с email/Edge на native fixtures.
- WebKit3/4 normal passed (running review + keyboard390/430). Client full flow
  все assertions passed в diagnostic --ignore-snapshots; normal snapshot ожидает
  Linux95px, local macOS96px. Эталон/допуск/CI gate не менялись.
- Visual matrix12 cases (client390/430/trainer1440 × review/save × light/dark):
  8passed/4local failures. Старые macOS review PNG из19bd405f/#1105 не содержат
  уже существующих в main prep/timer controls;390 также сообщает21px select.
  Actual screenshots просмотрены; UI/CSS не меняются. Это не зелёная локальная
  visual приёмка; Linux CI остаётся обязательным. Baselines не обновлялись.
- Visual helper ждёт завершения native media signing retries перед существующим unavailable-media baseline; media runtime/эталоны/допуски прежние.
- Изменение common native fixture добавляет fallback к scenario-specific AI
  routes. Отдельный Playwright dev server на testPort+1000 получает synthetic native
  auth config; AI fixtures открываются на нём. Прежний server/auth fixtures и
  production config/only-auth switch не меняются. Новых cases/projects нет. Legacy non-AI tests сохранены.
- Финальный npm run check exit0: frontend2796/API1434+186conditionalDBskip, infra332/calendar12/hosting184/lint/typecheck/build/startup. CI ожидается; timings before/after не замерены.

CI initial attempt выявил случайную замену signIn в соседнем body-map test. Восстановлена исходная строка; assertions/эталоны неизменны, весь CI повторяется на исправленном head.
