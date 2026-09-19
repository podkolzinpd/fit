# Fit — playbook перехода на Yandex Cloud и Yandex ID

## Цель и срок жизни документа

Fit переводит production data plane и аутентификацию на Yandex Cloud и Yandex
ID. Frontend остаётся на Vercel. Supabase сохраняется только как временный
рабочий backend и rollback-источник до завершения согласованного окна
стабилизации.

Этот playbook обязателен для задач, которые до окончания cutover затрагивают
auth, БД, repositories/queries, media, Assistant, SpeechKit, push, backend
routing или переносимые продуктовые данные. Текущая фаза и блокеры находятся в
`docs/CURRENT_STATE.md`; реализованный продукт — в `docs/PRODUCT_WIKI.md`;
полный V1-инвентарь — в `FEATURE_PARITY.md`.

После Yandex-only cutover и окончания rollback-периода временные требования к
двум backend удаляются вместе с этим документом. Постоянные архитектурные
инварианты остаются в `AGENTS.md` и `ARCHITECTURE.md`.

## Результат перехода

- новые и существующие пользователи входят только через Yandex ID;
- все production-чтения и записи продуктовых данных идут через Yandex API в
  Managed PostgreSQL и Yandex Object Storage;
- frontend продолжает выпускаться через Vercel;
- production frontend не требует `VITE_SUPABASE_*` и не создаёт Supabase
  session;
- Supabase Auth, Data API, Storage, Edge Functions и фоновые producer отключены
  только после подтверждённого окна стабилизации и сохранения rollback backup;
- пользовательский контракт клиента и тренера не ухудшается при переключении.

## Общая методика продуктовой разработки

UI, hooks и feature-код не знают, какой provider обслуживает запрос. Новая
возможность сначала получает общий доменный контракт, затем реализации для всех
активных backend:

```text
route/feature -> domain repository contract -> DataBackend routing
                                      |-> Supabase adapter
                                      `-> Yandex adapter
```

До cutover действуют правила:

1. DTO, validation, бизнес-правила и пользовательская семантика общие.
2. Provider-specific transport, SQL и преобразование ошибок остаются в
   queries/repositories или серверном adapter.
3. Feature-код не проверяет `backend === 'supabase'` или `'yandex'`.
4. Один пользовательский запрос читает и пишет только выбранный backend.
   Dual-write и автоматический fallback после ошибки запрещены.
5. Общие contract tests прогоняются против обеих реализаций; provider-specific
   тесты дополняют, но не заменяют их.
6. Изменение поддерживаемой таблицы требует эквивалентных Supabase и numbered
   Yandex migrations, проверки итоговых схем и обновления tenant catalog, если
   таблица переносится.
7. Новая функция сливается default-off, если её backend parity, migration
   rehearsal или production rollout ещё не завершены.
8. Функция, которая гарантированно будет выпущена только после Yandex-only
   cutover, может получить только Yandex-реализацию после отдельного решения.
   До cutover её входы остаются скрытыми.

## Параллельные потоки

Каждая задача выбирает ровно один основной поток:

| Поток | Scope |
| --- | --- |
| `identity-runtime` | Yandex ID, app-session, runtime composition, routing, legal и отказ от email/Supabase auth |
| `data-media` | схемы, migrations, tenant catalog, import/export/validation, Object Storage и media adapters |
| `assistant-ops` | Assistant, parser/summary, push, infrastructure, rehearsal, observability и runbooks |
| `product` | пользовательские функции поверх общего backend-контракта |

Один интеграционный владелец на текущий этап определяет порядок merge и
единолично ведёт rehearsal/cutover checklist. Это не даёт ему права включать
production: remote apply, изменение Vercel environment и переключение routing
выполняются только в явно согласованной cutover-задаче.

До начала реализации автор задачи фиксирует:

```text
Поток:
Пользовательский результат:
Базовый main commit:
Зависит от PR:
Затрагиваемые таблицы/API и общие файлы:
Общий repository-контракт:
Supabase implementation:
Yandex implementation:
Feature flag и default-off поведение:
Проверки обоих backend:
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
- За 48 часов до cutover не сливаются новые изменения auth, переносимой схемы,
  media или backend routing, кроме исправлений подтверждённых блокеров.
- Продуктовый код можно доставить заранее default-off. Его включение выполняется
  после основного cutover smoke отдельным флагом и не входит в переключение
  инфраструктуры автоматически.

## Обязательная матрица проверки

| Изменение | Минимальная проверка |
| --- | --- |
| Общий repository/API-контракт | одинаковые contract cases для Supabase и Yandex |
| Схема или переносимые данные | обе clean migration chain, schema parity, catalog и local rehearsal |
| Mutation | ownership, cross-tenant, atomicity, expected-row count, retry/idempotency |
| Auth/routing | flag-off, linked, native registration, expired/mismatch, logout и прямой маршрут |
| Media | upload/sign/read/delete, несколько bucket types, повтор и отсутствующий object |
| Assistant/push | actor/role parity, idempotency, safe failure и отсутствие PII в логах |
| UI | loading, empty, error/retry, success, pending, mobile WebKit и обе роли |

Локальные проверки используют только Podman и локальные базы. Успешный тест
одного adapter не является доказательством parity. Preview не применяет Yandex
или Supabase migration из PR к удалённой базе.

## Гейты перехода

### 1. Parity ready

- все пользовательские сценарии из cutover scope работают через Yandex adapter;
- legal, account deletion, Assistant programs и media не имеют скрытого
  Supabase-only пути;
- production bundle может запускаться без Supabase runtime configuration;
- все новые schema/data изменения представлены в обеих активных реализациях.

### 2. Rehearsal ready

- свежий full-cohort audit/dry-run/apply/validate проходит с повторной атомарной
  пересборкой и тем же полным checksum snapshot-а;
- media validation проходит без `allow-missing`, проверены все используемые
  bucket types;
- backup восстановлен во временный private cluster, схема и агрегированные
  counts проверены без PII;
- пройдены Yandex ID, обе роли, mutation, Assistant, upload и push smoke.

### 3. Cutover

1. Остановить записи на согласованное окно.
2. Дождаться или безопасно остановить незавершённые producer/outbox операции.
3. Создать и применить свежий snapshot и media delta; выполнить validate.
4. Включить server-side assignments, Yandex app-session/routing и native
   registration в согласованном порядке.
5. Выполнить smoke клиента и тренера, затем открыть записи.
6. Зафиксировать commit, deployment, aggregate evidence и начало окна
   стабилизации в `docs/CURRENT_STATE.md`.

После первой production-записи в Yandex простое выключение frontend-флага не
синхронизирует данные обратно в Supabase. Rollback требует maintenance window и
отдельно проверенную reverse migration либо восстановление согласованного
checkpoint.

### 4. Стабилизация и удаление Supabase

В течение согласованного окна контролируются auth failures, API 5xx, latency,
PostgreSQL connections, migration drift, media 404, Assistant и push. После
успешного окна отключаются Supabase Auth/Data API/Storage/Edge Functions и
старые фоновые задачи, удаляются production secrets и fallback-код. До этого
момента новые функции продолжают соблюдать двух-backend контракт.

## Handoff агента

```text
main/commit; ветка/PR; поток; YAFIT;
контракт и обе реализации;
migrations/catalog/flags;
что проверено для Supabase и Yandex;
что default-off или не проверено;
зависимый следующий PR;
состояние дерева; production не менялся/точное согласованное изменение.
```
