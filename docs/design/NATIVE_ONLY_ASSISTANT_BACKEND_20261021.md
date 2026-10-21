# Native-only Assistant backend

Поток assistant-ops. База main83833e05 (#1760 merged), ветка
codex/native-only-assistant-backend; ранний активный PR1759 имеет merge priority.
Production bundle/version не устанавливался; remote/paid LLM calls не выполняются.

## Подтверждённая постановка (дословно)

Давай уберём legacy Assistant backend, общие типы отвяжем от Supabase, старые сценарии переведём на native fixtures. Существующие native-диалоги, промпты и поведение сохраняем. Дождись зелёного CI.

## Проверка существующего и scope

| Уже работает | Переиспользуем | Действительно меняем | Не проверено |
| --- | --- | --- | --- |
| Native repository / history / actions | Те же API/DTO/errors | Удаляем legacy repository/queries | Production data |
| Native Assistant UI | AssistantHistoryPage / StatePanel / current CSS/tokens | Required backend prop, remove local fallback | Physical device |
| Native fixtures | mockPilot / isolated native server | Старый skipped routing case → history error/retry fixture | Remote OAuth |
| Common DTO | Existing types | Neutral assistant/workout response contracts | Ничего нового в серверном контракте |

Маршрут /assistant, client390/430 light/dark и trainer390/430/1440.
Primary action — существующая отправка сообщения, без новых действий/текстов.
Проверяются loading/session mismatch, native error/retry, existing history,
reload, actions/program/summary и containment. Native JSX/CSS не меняются.
Первый baseline-запуск: отсутствовал harness flag, затем client Lime/program
flags; после правильной конфигурации existing4 WebKit cases прошли. Это
fixture setup, продукт по этим сбоям не менялся. Снимки диагностические,
не заявляются отдельным автоматическим visual regression.

## Неизменяемая приёмка

1. Legacy Assistant repository/history queries/local composition и выбор
   Supabase backend удалены; native API и существующие диалоги сохраняются.
2. Common DTO provider-neutral. Native repository/parser emitted JS прежний,
   AssistantHistoryPage body прежний; backend передаётся явно.
3. Старые сценарии переведены на native fixtures. Серверное ownership, whole-turn
   API, запрет browser message inserts, session guards и nav kill switch покрыты.
4. Prompts/server/Cloud Functions/media/SQL/user data не меняются. Полный check
   и CI зелёные до handoff.

## Проверки и соответствие покрытия

- Targeted104/104 (8 files), targeted ESLint/typecheck passed.
- DTO declarations exact9; native repository/parser emitted JS exact2/2;
  AssistantHistoryPage function body exact.
- Existing client WebKit4/4:390/430 × light/dark, error/retry, program editing,
  summary and chat fixture interactions. Protected spec/inventory/baselines прежние.
- Native history WebKit1/1: existing conversation, load error/retry, reload,
  no new conversation/no legacy HTTP, containment390/430/1440. Former routing
  case depended on real local legacy login and skipped without rollout env;
  missing/mismatched native session gates remain in component tests.
- Removed2 legacy query tests → native ownership/create and whole-turn/no direct
  message-write assertions; retired transport assistant case → native turn200/503.
  Parser/goal tests retained in exercises-ai.queries.test.ts.5 retired sticky-flag
  cases removed; mandatory native selection and nav kill switch retain coverage.
  Supabase program availability removed; native/disabled/unknown/legacy rejection retained.
- Native fixture server enables nav only for separate synthetic Assistant actor,
  preserving existing configured allowlist and other native AI fixtures.
- Fullcheck exit0 (workers4): frontend2791/API1434+186conditionalDBskip/infra329/calendar12/hosting184/lint/typecheck/build/startup. CI ожидается. Timings before/after heavy suite не сравнивались;
  browser matrix не расширена, старый skipped case выполняется с fixtures.
