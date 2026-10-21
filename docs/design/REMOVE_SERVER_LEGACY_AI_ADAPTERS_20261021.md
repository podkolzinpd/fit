# Удаление трёх серверных legacy AI adapters

База mainf18b2c1c, ветка codex/remove-legacy-ai-adapters, поток assistant-ops.
Открытых PR на старте нет. YAFIT не создавался. Production/resources вне scope.

## Подтверждённая постановка

Давай удалим эти три серверных AI adapters. Общие типы и native-тесты сохраняем, native AI, промпты, Cloud Functions и media не трогаем. Дождись зелёного CI.

Три adapters: services/api/src/legacy-workout-parser/index.ts,
services/api/src/legacy-summary/index.ts, services/api/src/assistant-orchestrator/index.ts.

## Сверка существующего

| Уже работает | Переиспользуем | Действительно меняем | Не проверено |
| --- | --- | --- | --- |
| Native parser/summary/Assistant | Core, prompts, validation, model runtime | Только type imports с adapter index на existing core | Production/paid LLM |
| Общие типы | AssistantAction/AssistantTurnResponse в core.ts | Путь импорта, без нового контракта | Ничего не включается |
| Core/native tests | Summary quality/model/dedup, Assistant router/matching | Импорты с reexports на core | Реальный внешний backend |
| Supabase adapter handlers | Уже отключены от основного сервера | Удаление3 orphan adapters и их wiring tests | Развёрнутые ресурсы |
| Cloud Functions/media | Entry points/shared modules/workflows | Ничего | Production-файлы |

UI/роли/темы/флаги/маршруты не меняются, версия production не устанавливалась.
Browser/UI baseline неприменим к удалению недостижимого серверного кода.

## Неизменяемая приёмка

1. Три adapters удалены; runtime imports к ним отсутствуют.
2. Общие типы/контракты сохранены в existing core; native runtime, prompts,
   validation, matching, persistence и модели не меняются.
3. Все core/native tests сохраняются, включая model budgets, качество,
   no-retry/dedup, приватность диагностики и routing. Удаляются только tests
   удаляемых Supabase handlers. Новые тестовые матрицы не добавляются.
4. Cloud Functions, workflows и media не меняются.
5. Полный npm run check и весь CI зелёные до передачи PR.

## Соответствие покрытия

- Assistant index.test.ts → core.test.ts: все pure/native assertions сохранены;
  удалён только1 test list_clients RPC adapter. Router.test.ts — import-only.
- Summary index.test.ts → core.test.ts: все model/quality/dedup assertions
  сохранены; удалены только2 tests Supabase handler method/request guards.
  Закрытые HTTP API сохраняют существующие app404 regression tests.
- Private diagnostic: сохранены3 tests access-window/no-logging/one-call/network
  contracts; удалены2 tests Supabase collector/handler, которого больше нет.
- Index-routing: удалены12 случаев (включая4 lifecycle variants), проверяющих
  wiring удаляемого Supabase orchestrator. Native pilot runner/database tests
  не меняются. Router switching/cancellation/history bounds остаются в existing
  router.test.ts; program client/context contracts — в program/turn.test.ts.
  Legacy-only Supabase RPC/persistence assertions больше не применимы.
- Сохранён SDK/HTTP-bridge native import guard; убраны mocks2 удалённых файлов.
- Targeted25files/462tests passed. Новых cases/осей матрицы нет. Полных timings
  before/after нет.
- Exact AST test-body parity:27 Assistant/24 summary/3 diagnostic cases.
  Три type-import changes дают идентичный emitted JS; shared core/prompts,
  native handlers/CF/media/server/frontend/workflows прежние.
- Actual compiled Node native imports4/4 passed с blocked SDK/HTTP bridge/
  removed adapters. Stale generated outputs3 удалены из ignored local dist.
- Первый fullcheck остановился на8 Vitest worker-startup timeouts, без failed
  assertions. Полный повтор VITEST_MAX_WORKERS=4 npm run check exit0:
  frontend2800/API1434+186conditionalDBskip/infra332/calendar12/hosting184/
  lint/typecheck/build/startup. Состав тестов/timeouts/retries не менялись.
- Полный CI ожидается в PR. Production и ресурсы не менялись.
