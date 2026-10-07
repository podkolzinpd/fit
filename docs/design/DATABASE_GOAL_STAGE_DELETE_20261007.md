# Удаление выбранного этапа цели

Baseline: main `f89e0e79`; scope — существующее удаление этапа, без новой схемы,
API, Supabase migration, экранов, CSS и прав.

## Результат и приёмка

1. Общий контракт принимает ID и версию выбранного этапа. Yandex выполняет один
   DELETE с `expectedVersion`, не читает список клиентов или их прогресс.
2. Версия фиксируется при выборе действия, до подтверждения. Конкурентное
   изменение не подменяется свежей версией; конфликт сохраняет этап и показывает
   существующую ошибку. Отмена не отправляет запрос, pending блокирует повтор.
3. Серверная проверка `can_access_client` и версии остаётся в транзакции.
   Ошибка прав, отсутствующая запись или устаревшая версия не означают успех.
   Замороженный legacy adapter сохраняет ID-only RPC без расширения схемы.
4. Проверки: repository regression, legacy совместимость, API validation/error,
   clean PostgreSQL17 actor/RLS и локальный WebKit. После стабилизации — полный
   `npm run check`, CI и передача одного PR.

## UI preflight

Переиспользуются GoalPage/MyGoalPage, Page, AsyncView, useConfirm и stage-row с
существующими surface/border/danger tokens. Разметка и тексты неизменны; основное
действие диалога — «Удалить». Проверяются существующие loading/empty/error,
отмена, pending, конфликт, повтор после обновления и успех; размеры 390/430/1440.
Реальный локальный маршрут с синтетическим Yandex API fixture проверяется до
изменения UI callsite; production и чужие пользовательские данные не используются.

## Проверки

1. Repository55/55 passed: выбранная version7, один DELETE, отсутствие чтений
   клиентов/прогресса, ошибки409/403/404; штатный health preflight сохранён.
2. Component1/1 passed: пока открыт confirm, query заменяет stage7 на stage8;
   mutation всё равно получает stage7. WebKit2/2 passed: cancel/pending/409,
   сохранённый этап и повтор после reload с version8 до empty-state.
3. Clean Podman PostgreSQL17 chain136/actor129/129 passed: удаляется только
   выбранная owned version, stale/cross-tenant/missing дают PT409; соседняя
   запись и обновлённый этап сохранены. API5/5 и legacy adapter2/2 passed.
4. WebKit GoalPage/MyGoalPage390/430 и trainer1440/light/dark просмотрены;
   ноль Supabase и unrelated progress reads. Полный `npm run check` passed:
   frontend2521/API1210, lint/typecheck/coverage/policy/hosting/build/startup.
   CI ещё гейт; перед merge — очередь более ранних активных PR и свежий main.

Схема БД и API не менялись: новая migration/local:verify не требуются.
Изолированная тестовая БД удалена; общая legacy БД не сбрасывалась.
Production, реальный OAuth и физические mobile устройства не проверены.
Tracker connector в текущем сеансе отсутствует; чеклист и результаты в этом PR.
