# Fit — post-cutover playbook Yandex Cloud и вывода Supabase

## Цель и срок жизни документа

Production Fit уже использует Yandex ID, Yandex API и Managed PostgreSQL;
frontend `fit-training.ru` публикуется через Yandex API Gateway/Object Storage.
Vercel сохранён только для редиректа со старого адреса; PR Preview отключён.
Supabase остаётся временным legacy-источником для recovery, неперенесённых
media, локальных тестов и rollback — не вторым production backend новых функций.

Этот playbook обязателен для задач, которые до вывода Supabase затрагивают
auth, БД, repositories/queries, media, Assistant, SpeechKit, push, backend
routing или переносимые продуктовые данные. Текущая фаза и блокеры находятся в
`docs/CURRENT_STATE.md`; реализованный продукт — в `docs/PRODUCT_WIKI.md`;
полный V1-инвентарь — в `FEATURE_PARITY.md`.

После закрытия rollback-периода временные legacy-правила удаляются вместе с
этим документом. Постоянные архитектурные инварианты остаются в `AGENTS.md` и
`ARCHITECTURE.md`.

## Текущее production-состояние и цель вывода legacy

- новые и существующие пользователи входят только через Yandex ID;
- все production-чтения и записи продуктовых данных идут через Yandex API в
  Managed PostgreSQL и Yandex Object Storage;
- frontend выпускается на `fit-training.ru` только проверенным
  `.github/workflows/deploy-yandex-frontend.yml` после зелёного CI на `main`;
- production frontend больше не маршрутизирует продуктовые запросы в Supabase,
  но startup/recovery/media legacy-зависимости и `VITE_SUPABASE_*` пока могут
  оставаться; их удаление — отдельная проверяемая задача;
- Supabase Auth, Data API, Storage, Edge Functions и фоновые producer отключены
  только после подтверждённого окна стабилизации и сохранения rollback backup;
- пользовательский контракт клиента и тренера не ухудшается при переключении.

## Общая методика продуктовой разработки

UI, hooks и feature-код не знают, какой provider обслуживает запрос. Новая
возможность получает общий доменный контракт и Yandex implementation:

```text
route/feature -> domain repository contract -> Yandex API/PostgreSQL
                                      `-> legacy Supabase adapter (только старые пути)
```

После production cutover действуют правила:

1. DTO, validation, бизнес-правила и пользовательская семантика общие.
2. Provider-specific transport, SQL и преобразование ошибок остаются в
   queries/repositories или серверном adapter.
3. Feature-код не проверяет `backend === 'supabase'` или `'yandex'`.
4. Продуктовые чтения и записи используют Yandex API/PostgreSQL. Dual-write и
   автоматический fallback в Supabase после ошибки запрещены.
5. Новые миграции создаются **только** в `services/api/db/migrations` как
   numbered Yandex PostgreSQL migrations. Не добавляйте парную migration в
   `supabase/migrations`; существующая цепочка заморожена, не удалена.
6. Изменение схемы проверяется на чистом локальном PostgreSQL 17, actor/RLS и
   API tests. `npm run local:verify` поднимает обе локальные базы ради
   совместимости текущего tooling; зелёный Supabase-тест не заменяет Yandex test.
7. Tenant catalog/export/import меняются, только если требуется перенос
   **существующих** legacy-данных. Для новой Yandex-only таблицы не создавайте
   фиктивное Supabase mapping.
8. Legacy recovery/media или старый локальный тестовый путь не расширяются
   автоматически под новые фичи. Если новое поведение пока не проверено через
   Yandex, вход остаётся default-off до целевого теста и безопасного rollout.

## Параллельные потоки

Каждая задача выбирает ровно один основной поток:

| Поток | Scope |
| --- | --- |
| `identity-runtime` | Yandex ID, app-session, runtime composition, routing, legal и отказ от email/Supabase auth |
| `data-media` | схемы, migrations, tenant catalog, import/export/validation, Object Storage и media adapters |
| `assistant-ops` | Assistant, parser/summary, push, infrastructure, rehearsal, observability и runbooks |
| `product` | пользовательские функции поверх общего backend-контракта |

Один интеграционный владелец на текущий этап определяет порядок merge и
единолично ведёт decommission/rollback checklist. Обычный merge в `main`
запускает отдельные Yandex stage/frontend workflow по их правилам; ручной
remote apply, изменение production build-time variables и обратное
переключение routing не входят в произвольную продуктовую задачу.

До начала реализации автор задачи фиксирует:

```text
Поток:
Пользовательский результат:
Базовый main commit:
Зависит от PR:
Затрагиваемые таблицы/API и общие файлы:
Общий repository-контракт:
Yandex implementation:
Зависимость от существующих legacy recovery/media путей (если есть):
Feature flag и default-off поведение:
Локальная Yandex PostgreSQL/API/RLS проверка:
Что запрещено включать или выкатывать из этой задачи:
```

Файлы с высокой вероятностью конфликта — migration numbering, tenant catalog,
`data-backend-context`, `auth-context`, feature flags, deployment workflows и
environment contract. Их изменение заранее отмечается в задаче. Два PR не
должны независимо вводить разные версии одного доменного контракта.

## Ветки, PR и интеграция

- Каждая задача начинается от свежего `origin/main` и имеет отдельную короткую
  ветку и PR.
- Сначала сливается PR, вводящий общий контракт и additive migration; зависимые
  PR обновляются от нового `main` и заново проходят обязательный CI.
- Созданный раньше активный PR имеет приоритет согласно `AGENTS.md`. Если его
  контракт блокирует следующий поток, интеграционный владелец явно фиксирует
  зависимость, а не пытается обойти её временным adapter.
- Новая функция может быть доставлена default-off. Её включение для
  production-пользователей — отдельное решение и не происходит автоматически
  только от наличия API-миграции.

## Обязательная матрица проверки

| Изменение | Минимальная проверка |
| --- | --- |
| Новый repository/API-контракт | целевые contract cases против локального Yandex API |
| Новая схема | clean Yandex PostgreSQL 17 chain, actor/RLS/grants и API integration |
| Перенос **существующих** legacy-данных | Yandex migration, catalog/export/import/validation и local rehearsal без потерь |
| Mutation | ownership, cross-tenant, atomicity, expected-row count, retry/idempotency |
| Auth/routing | flag-off, linked, native registration, expired/mismatch, logout и прямой маршрут |
| Media | upload/sign/read/delete, несколько bucket types, повтор и отсутствующий object |
| Assistant/push | actor/role ownership, idempotency, safe failure и отсутствие PII в логах |
| UI | loading, empty, error/retry, success, pending, mobile WebKit и обе роли |

Локальные проверки используют только Podman и локальные базы. Успешный тест
legacy Supabase adapter не является доказательством работы новой Yandex-функции.
Удалённой PR Preview-среды сейчас нет. Новые Yandex migrations из PR проверяются
локально на PostgreSQL 17 и Yandex API, а не применяются к production-БД.

## Гейты стабилизации и вывода Supabase

Yandex-only production cutover уже произошёл. Не повторяйте full-cohort apply
или не включайте Supabase routing ради новой функции. После первой
production-записи в Yandex выключение frontend-флага **не** синхронизирует
данные обратно: rollback требует maintenance window, проверенную reverse
migration либо восстановление согласованного checkpoint.

До отключения старого проекта необходимо:

1. Закрыть оставшиеся recovery/media зависимости и проверить данные без
   `allow-missing`; не удалять credentials, которые ещё используются мостом.
2. Проверить Yandex ID, роли, mutation, Assistant, upload и push на
   согласованных тестовых учётках; контролировать auth errors, API 5xx,
   PostgreSQL connections, schema drift и media 404.
3. Провести backup restore drill и завершить observation/rollback window.
4. Сохранить проверяемый source snapshot, затем отдельным решением отключить
   Supabase Auth/Data API/Storage/Edge Functions, старые producer и secrets.

До выполнения этих гейтов старый проект и его миграционная история остаются
нетронутыми. Это **не** обязывает добавлять новые Supabase migrations:
production изменения схемы теперь идут только в Yandex PostgreSQL.

## Handoff агента

```text
main/commit; ветка/PR; поток; YAFIT;
доменный контракт и Yandex implementation;
Yandex migrations/catalog/flags;
что проверено для локального Yandex API/PostgreSQL и что осталось legacy;
что default-off или не проверено;
зависимый следующий PR;
состояние дерева; production не менялся/точное согласованное изменение.
```
