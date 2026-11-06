# Fit — post-cutover playbook Yandex Cloud и вывода Supabase

## Цель и срок жизни документа

Production Fit использует внешний Yandex ID; app-session/API/PostgreSQL и media
работают в Cloud.ru, frontend `fit-training.ru` публикуется через Cloud.ru Nginx.
Названия Yandex API/migrations ниже обозначают сохранённые кодовые контракты.
Старый Yandex-контур сохранён, обратной синхронизации записей Cloud.ru нет.
[Аудит16.10](design/CLOUD_RETURN_AUDIT_20261016.md) фиксирует текущие доказательства;
[проект возврата](design/CLOUD_RETURN_RUNBOOK_20261016.md) требует reconciliation
историй, запрета всех writers и отдельной полной репетиции≤120мин. Эти документы
не разрешают production switch. Старые cutover-команды ниже не являются reverse
migration Cloud.ru → Yandex Cloud.
Vercel сохранён только для редиректа со старого адреса; PR Preview отключён.
Supabase остаётся временным legacy-источником для неперенесённых
media, явных архивных репетиций и rollback — не вторым production backend новых функций.

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
- актуальная web-сборка направляет продуктовые запросы через `fit-training.ru/api`
  (новые native bundles — через `api.fit-training.ru`)
  и Cloud.ru PostgreSQL/S3; старые cached/native writers ещё требуют проверки
  и контролируемого закрытия: наличие старого API не означает dual-write;
- frontend выпускается на `fit-training.ru` только проверенным
  `.github/workflows/prepare-cloudru-frontend.yml` после зелёного CI на `main`;
- production frontend больше не маршрутизирует продуктовые запросы в Supabase,
  web/Android/iOS production build больше не требует `VITE_SUPABASE_*` и
  не инициализирует Supabase SDK/Auth. Server-side legacy media и rollback tooling пока сохраняются;
- Supabase Auth, Data API, Storage, Edge Functions и фоновые producer отключены
  только после подтверждённого окна стабилизации и сохранения rollback backup;
- пользовательский контракт клиента и тренера не ухудшается при переключении.

## Завершение password recovery — 14.10.2026

По прямому решению владельца старый recovery через email/пароль удалён из UI,
client transport и API. Непривязанный Yandex ID открывает текущую форму нового
аккаунта; уже связанные identity продолжают обычный вход. Перенесённые профили
не удаляются, но больше не привязываются через проверку Supabase credentials.
Старый `/v1/auth/yandex/recover` возвращает 404. Исторические SQL migrations
сохраняются без переписывания; они не являются доступным recovery API.
Server-side Supabase SDK и legacy media adapters остаются
для следующих отдельных задач; это ещё не полный decommission.

## Отказ от переноса Supabase media — 03.11.2026

По прямому решению владельца старые файлы Supabase не переносятся.
Требование полноты их копирования больше не блокирует удаление legacy media
runtime. Удалены Supabase chat store/authorizer/bridge, три маршрута
`/v1/legacy/chat-media/{upload,sign,remove}`, media fallback и source-copy CLI/workflow.
Нужные native chat/Vital/profile media и S3-контракты сохраняются. Старые файлы,
которые существуют только в Supabase, могут стать недоступными; удалённые
объекты/ресурсы этим решением не удаляются. Это уточняет прежний P1 media gate,
но не отменяет проверки остальных data/ops consumers перед отключением проекта.

## Stage credentials после удаления bridge — 03.11.2026

Stage plan/deploy не используют Supabase CLI или credential mirror. Bridge
Lockbox inputs/mounts/IAM resource удалены из Terraform. Последующий reviewed
apply может отозвать только прежний payload-viewer grant у planned API service
account: secret/versions, native DB/S3/AI/push и другие grants не удаляются.
Физические GitHub secrets/Lockbox пока сохраняются для отдельной проверки
оставшихся ops readers. Эта правка не запускает stage/production apply.

## Удаление старых административных workflows — 03.11.2026

По решению SB-ADMIN-WORKFLOWS-RETIRE-01 удалены ручной deploy Supabase БД,
Supabase Auth diagnostics и её CLI helper. Замороженный SQL-архив сохранён;
это не отключение удалённого проекта и не отзыв credentials. Оставшиеся
source consumers, включая восстановление карточек, пока работают отдельно.
Native migrations/releases и ручной Yandex parser deployment сохраняются.

## Удаление старого Schedule V2 pilot manager — 05.11.2026

SB-PILOT-MANAGER-RETIRE-01 удаляет ручной workflow, который находил профиль
через Supabase Auth и менял назначение в Supabase и старом Yandex-контуре.
Существующие назначения, текущая конфигурация Cloud.ru и backend-команды не
меняются; новые operator credentials/inputs не вводятся. Общие source secrets
и исторические SQL сохранены для остальных consumers. Это не запуск remote
изменений и не изменение текущего пользовательского допуска.

## Общая методика продуктовой разработки

### Точечное восстановление подтверждённой связи — YAFIT-701

`restore-client-history.yml` — ручной main-only оператор для согласованной пары,
не публичный способ переподключения. План и журнал: [YAFIT-701](https://st.yandex-team.ru/YAFIT-701).
`plan` только читает; подтверждённая пара native profile ID передаётся закрытым
`FIT_CLIENT_RESTORE_TARGETS` с точными ключами `trainerProfileId` и
`athleteProfileId`, без контактов/UUID в inputs. Старый формат с email-хешами
отклоняется; перед новым `plan` оператор обновляет только этот закрытый secret
на подтверждённые native ID. Supabase Auth/Management API и shared source
registry helper больше не используются. `plan` проверяет существование/роли
профилей и прежнюю связь в native БД; догадок по имени/email нет. Формат уже
созданного приватного плана и `apply/verify` не изменён. План и квитанции остаются
root-only в `/opt/fit/client-restores/<plan_run_id>`, без публичных артефактов.
`apply` требует неизменного плана не старше часа, отсутствия активного тренера,
свежей зашифрованной DB-копии и успешной проверки её восстановления. Ошибка
отдельного media-health не отменяет успешную проверку БД и не разрешает менять ACL.
Создаётся новый период от имени подтверждённого тренера по поручению владельца;
старый период и история не редактируются, app-session/согласие спортсмена не подделываются.
`verify` отдельно проверяет чтение канонической карточки через `fit_api`/RLS.
При конфликте, изменении данных или новом отключении повтор останавливается.
После проверки удалить только собственную временную настройку цели; приватные
квитанции сохранить. Не привязывать неизвестный Yandex-профиль по похожей почте.

### Разделение продуктовых слоёв

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
   API tests. `npm run local:verify` использует только Podman PostgreSQL17;
   frozen Supabase SQL/pgTAP не участвуют в dev/check/CI и сохранены в
   `supabase/README.md` с контрольными суммами для явной legacy-репетиции.
7. Tenant catalog/export/import меняются, только если требуется перенос
   **существующих** legacy-данных. Для новой Yandex-only таблицы не создавайте
   фиктивное Supabase mapping.
8. Legacy media или старый локальный тестовый путь не расширяются
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
Зависимость от существующих legacy media путей (если есть):
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

1. Закрыть оставшиеся legacy media зависимости и проверить данные без
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

## Завершение Supabase linking — 20.10.2026

Удалены UI, transport, server handlers и production provider привязки через
Supabase-сессию. GET/POST `/v1/auth/yandex/link` возвращают 404. Существующие
identity-записи и native Yandex login/registration не меняются. Старый pending
link callback завершает работу безопасной ошибкой с повторным обычным входом.
Исторические SQL migrations и их RLS/idempotency регрессии сохранены;
тестовый SQL fixture больше не является production adapter.
