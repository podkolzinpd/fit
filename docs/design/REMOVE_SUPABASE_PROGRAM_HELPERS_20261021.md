# Удаление Supabase program helpers

База mainc677fa56. Ветка codex/remove-supabase-program-helpers.
Поток assistant-ops. Открытых PR на старте нет; YAFIT не создавался.

## Подтверждённая постановка

Давай удалим supabaseProgramGenerationJobs и loadProgramContext, общий тип отвяжем от Supabase. Native-поведение и тесты сохраняем. Дождись зелёного CI.

## Сверка существующего

| Уже работает | Переиспользуем | Действительно меняем | Не проверено |
| --- | --- | --- | --- |
| Native PostgreSQL program context | loadDatabaseProgramContext/SQL/validation | Удаляем только старый loader/private helpers | Production/paid LLM |
| Native generation leases/cache | generateProgramOnce/key/JobStore | Удаляем только supabaseProgramGenerationJobs | Production leases |
| ProgramSourceSnapshot | ProgramHistoryContext/TrainingGoalContext | Отдельный нейтральный source-contract.ts | UI не меняется |
| Native tests | Все existing cases/assertions | Ничего | Реальный внешний backend |

Версия production не устанавливалась; UI/роли/темы/флаги/маршруты не меняются.
Browser baseline неприменим к удалению недостижимых helpers.

## Неизменяемая приёмка

1. supabaseProgramGenerationJobs и loadProgramContext удалены вместе с orphan
   private helpers и SupabaseClient imports; других runtime callers нет.
2. ProgramSourceSnapshot — явный neutral contract, не ReturnType Supabase
   loader. Публичный type export из turn.ts сохранён; native loader проверяет
   свой результат через этот же контракт.
3. Native поведение/SQL/fingerprint/model/prompts/lease/cache/retry прежние.
   Все existing tests сохранены без изменения assertions/cases.
4. Полный npm run check и весь CI зелёные до передачи PR.

## Доказательства

- Targeted16files/256tests и API typecheck passed. Existing program job tests
  проверяют concurrency/cache/release; actor-context DB test проверяет native
  source и actor-scoped leases. Новых cases/матриц нет, ничего не удалено.
- TypeScript virtual compile: old inferred loadProgramContext return и новый
  ProgramSourceSnapshot взаимно assignable; без расширения/сужения контракта.
- AST parity: все retained function bodies включая native SQL совпадают
  побайтно. Shared core, prompts, Cloud Functions, workflows и media прежние.
- Full VITEST_MAX_WORKERS=4 npm run check exit0: frontend2800/API1434+
  186conditionalDBskip/infra332/calendar12/hosting184/lint/typecheck/build/startup.
  Параллельность ограничена из-за прошлых local worker-startup timeouts;
  inventory/timeouts/retries не менялись.
- Native turn emitted JS идентичен. Actual Node imports job/source/turn/native
  runner4/4 passed при заблокированных SDK/HTTP bridge.
- Полный CI ожидается в PR.
- Production/resources/secrets/данные не меняются. Полных timings до/после нет.
