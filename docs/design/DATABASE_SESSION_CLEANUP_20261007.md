# Фоновая очистка FIT-сессий — 2026-10-07

Поток: identity-runtime. База: main `6e38470e`.
Результат: вход не обслуживает общую историю сессий; физическая очистка
выполняется существующим приватным минутным dispatcher без новых ресурсов.

## Acceptance checklist

1. Убрать общую очистку app-сессий из обычного входа и atomic legacy recovery.
   Сохранить validation, linking, rollout, выдачу токена и rollback-семантику.
2. Добавить numbered Yandex migration: очистка максимум 100 строк за вызов,
   по 50 expired/unrevoked и revoked, indexed candidates, FOR UPDATE SKIP LOCKED.
   Активные сессии сохраняются; время определяет БД, не входящий HTTP payload.
3. Запускать очистку через существующий приватный dispatcher, в том числе
   без feedback-интеграций. Ошибка очистки видима в безопасных диагностических
   логах, не отменяет push/feedback; следующий timer повторяет обслуживание.
4. Проверить clean PostgreSQL17 chain/actor-RLS, batch/repeat/locked rows,
   expired/revoked/active sessions, сохранение входа/recovery, grants и rollback.
   Выполнить целевые тесты, local:verify и npm run check перед PR.

## Границы

UI, срок действия токенов, права на профили, Supabase migrations, pilot-сессии
и OAuth handoff retention не меняются. Временный legacy recovery сохраняется.
Нет нового таймера, IAM, scaling или ручного production SQL/apply.
Это устранение лишней работы, не доказательство причины прежних 502.
Исторические migrations не переписываются. Down восстанавливает прежние
определения функций, но не возвращает уже удалённые недействительные токены.

## Проверки

1. Выполнен локально: stored definitions входа/recovery совпадают с прежними
   за исключением общего DELETE; actual login сохраняет чужие недействительные
   строки. Полная actor-серия покрывает recovery, выдачу сессий и rollback.
2. Выполнен локально: 65+65 строк удаляются порциями 100→30→0; активная
   сохраняется. Проверены inclusive expiry boundary, locked-row skip,
   overlapping invocations, partial-index paths, PUBLIC/reader/runtime grants
   и down/up roundtrip. Clean PostgreSQL17 chain до131 воспроизведена.
3. Выполнен локально: unit28/28 (cleanup/dispatcher/error/private route),
   optional feedback, failure isolation, next-invocation retry, ожидание
   завершения cleanup при отказе push и отсутствие private error text в логах.
4. Actor/RLS106/106 passed на отдельном локальном Podman PostgreSQL17:55439.
   `local:verify` выполнен и блокирован прежней недостающей legacy Supabase
   migration20260919145000; общая база не сбрасывалась, историческая цепочка
   не исправлялась. Full check: frontend2479/API1201 (+106 DB skipped здесь,
   отдельно выполнены выше), policy/hosting/build — passed. `npm run check`
   завершился с exit0; lint/typecheck и startup-build verification зелёные.

Tracker connector недоступен; чужие credentials не используются. UI/маршруты
не меняются, отдельная visual/native сборка не является приёмкой этой DB-задачи.
CI/merge/production пока не подтверждены. В очереди раньше открыт активный
PR#1487; перед merge нужен его выпуск, обновление от main и повторный CI.
