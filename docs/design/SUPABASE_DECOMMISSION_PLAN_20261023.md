# Конечный план полного отключения Supabase — 23.10.2026

Статус: **предложенный план, реализация не начата**. Baseline: `831fde5465f459a3f47a69e3db975b58ef4fd1cd`. Связанный [полный инвентарь](SUPABASE_REMAINING_INVENTORY_20261023.md) фиксирует все tracked paths и S01–S11. Нынешний PR меняет только документацию; ничего не отключает и не разрешает удаление данных.

## Запрос владельца

> Давай сделаем полный инвентарь всего, что осталось от Supabase, и конечный план удаления: этапы, блокеры, проверки и оценка сроков. Чтобы после выполнения можно было полностью отключить Supabase.

## Конечный результат и границы

Fit продолжает работать, разрабатываться, тестироваться, собираться и выпускаться при полностью недоступном Supabase. Старые нужные файлы и история доступны из native контура либо независимо восстановимого архива. Supabase не является источником авторизации, данных, media, адресатов, фоновых задач, fixtures или rollback. После проверки этого состояния проект можно остановить и затем удалить.

Сохраняются существующие native AI/prompts/matching/fallback, app-session/Yandex ID и существующие привязки, PostgreSQL/actor/RLS, медиа и текущие продуктовые сценарии. Изменение внешнего облачного имени не является самоцелью: runtime сейчас Cloud.ru, существующие `Yandex*` кодовые контракты остаются. Не создаём новые Yandex ресурсы и не направляем туда production traffic ради cleanup.

Удалить все строки `supabase` из Git — **не критерий**: разрешён узкий инертный архив, исторические native SQL-комментарии и negative guards. Нельзя переписать native migration history или удалить локальную `auth.uid()` совместимость: это часть native RLS, не подключение к Supabase. Нужен ноль **активных** зависимостей, а не косметический ноль совпадений.

## Preflight

| Категория | Факт и доказательство | Ограничение |
|---|---|---|
| Уже работает | Vite production import boundary; native API/PG/S3; native Yandex-auth/Fit Lime browser jobs | Это проверка исходников, production-сессия в текущем аудите не открывалась |
| Переиспользуем | Native repositories/DTO, fixtures, clean migration/actor tests, native media и AI core | Не переписываем рабочие контракты под новую миграцию |
| Действительно меняем сейчас | Два Markdown документа и индекс CURRENT_STATE | Без runtime/DB/infra/secret изменений |
| Не проверено | Остатки remote objects/users, deployed resources/secrets, old-client traffic, текущая restore пригодность | P0 — обязательный блокер физического отключения |

## Нерешённые блокеры

| ID | Что неизвестно / риск | Чем закрывается | Зависимые этапы |
|---|---|---|---|
| B01 | Сколько реально Supabase проектов/ресурсов/readers/старых revisions; удалённые из Git functions могут оставаться deployed | Read-only remote registry + именованный владелец каждого reader/resource + доступ к безопасному исполнению | P0 → P4/P6 |
| B02 | Остатки chat/custom media; текущий migrator вообще не перечисляет custom bucket | Aggregate source/target/reference census и защищённый manifest; custom zero доказан либо перенос/архивное решение | P0 → P1 |
| B03 | Supabase Auth нужен служебным email/audit operations; активное расследование account history нельзя оборвать | Перечень нужных операций и решение владельца: завершить/retire или отдельный neutral источник без расширения хранения PII | P0 → P4 |
| B04 | Legacy UI/E2E/fixtures и generated types держат local stack/CI | Assertion mapping, neutral DTO/helpers, native fixtures; подтверждённое сохранение уникального покрытия | P2 → P3 |
| B05 | Старые web/mobile bundles могут продолжать читать/писать legacy | Минимальная поддерживаемая версия и sunset/upgrade policy; writer fence и traffic evidence. Ноль запросов неделю сам по себе не доказывает отсутствие старого APK | P0/P5 → P6 |
| B06 | Исторический backup/restore не доказывает свежий DB/Auth/Storage snapshot; старый Supabase не содержит новых Cloud.ru writes | Финальный защищённый архив, restore drill отдельно от проекта; актуальный Cloud.ru rollback, retention/delete решение владельца | P5 → P6 |

Ответственные роли: исполнитель decommission закрывает технические registry/tests/migration gates; владелец продукта принимает судьбу старых данных, служебных операций и старых клиентов; владелец инфраструктуры подтверждает доступы, backup/retention и cloud deletion. Если это один человек, решения всё равно фиксируются отдельно. Пока конкретные исполнители этапов не назначены.

Ни один блокер не закрыт фразой «раньше перенесли» или только зелёным unit-тестом. Нынешний аудит не выполнял remote SQL, exports, mail/push sends, SSH или paid AI calls.

## Порядок и оценка работ

Оценка одного инженера/агента, рабочий день ≈ 6 часов сосредоточенной работы. Диапазоны — планирование по текущему коду, не измеренные SLA. Доступ к инфраструктуре и решения по B03/B05/B06 должны быть доступны; ожидание пользователя/провайдера отдельно.

| Этап | Конечный пакет | Зависит от | Трудозатраты |
|---|---|---|---:|
| P0 | Remote/data registry, counts, решения по blockers и baseline evidence | Этот план | 1–2 дня |
| P1 | Закрыть media и удалить runtime bridge/fallback | P0/B02 | 2–3 дня |
| P2 | Native-only local composition, neutral types, убрать legacy auth/data adapters | P0; не удалять media до P1 | 3–5 дней |
| P3 | Перенести уникальное legacy test покрытие; одна local БД; CI без Supabase | P2, media fixtures из P1 | 4–6 дней |
| P4 | Ops/source tooling, deploy/IaC/secrets, packages и operative docs | P1–P3, B03 | 2–3 дня |
| P5 | Полная offline rehearsal, restore/rollback, production observation | P4, B05/B06 | 1–2 дня работы + окно наблюдения |
| P6 | Остановка source, проверка, затем удаление проекта/оставшихся ресурсов | Все gates, явное разрешение исполнения | 0.5–1 день работы + период остановки |
| **Всего** | Все S01–S11 закрыты доказательствами | | **13.5–22 дня работы** |

Рабочий ориентир — **3–5 недель разработки** и ещё **7 календарных дней наблюдения + 24–48 часов обратимой остановки**. В сумме разумно планировать **4–7 календарных недель** при последовательном выполнении. Это не обещание даты: доступы, активное recovery investigation и старые клиенты могут удлинить календарь.

Условный резерв **+2–4 рабочих дня**, если custom bucket/records не пусты и нужен native adapter/специальный перенос. Крупный объём storage, egress/rate limits и ожидание внешних решений оцениваются после P0; до actual counts длительность копирования неизвестна. CI очередь/повторная интеграция main также не включены в рабочие дни как фиксированное число. Текущие 626 файлов не означают 626 задач: 443 — SQL/tests/docs; основной объём — fixtures/coverage и безопасное media завершение.

P1 и независимые части P2 допускают параллельное выполнение после P0, но оценки выше консервативно последовательные. Создание параллельных агентов этой задачей не предусмотрено. Не дробить работу на случайные orphan files: каждый PR закрывает именованный пакет и его gates. Внутри P2/P3 допустимы несколько reviewable PR, все привязаны к одному acceptance registry.

## P0. Зафиксировать фактический остаток

1. Составить закрытый remote resource registry для B01: каждый проект, DB/Auth/Storage/Functions/cron/Vault/hooks/integrations, reader/service/workflow/revision, кто отвечает, keep/migrate/retire и этап. В публичный Git только имена компонентов и агрегаты, без contacts/IDs/secret values/payload.
2. Проверить source writes/queues и native feature coverage. Никакой повторный full-cohort import на nonempty Cloud.ru target: он не содержит актуальные native writes. Unresolved account history recovery — отдельный blocker, не разрешение новой миграции.
3. Для трёх media buckets сопоставить objects с references legacy/current БД, проверить orphan/missing/duplicate/version/bytes, старые URL и права обеих ролей. Объект без ссылки не удалять автоматически; определить retention. Zero-use custom проверить отдельно по records, references и objects.
4. Проверить только metadata секретов GitHub/Cloud.ru/Lockbox и потребителей: candidate2/repository3 уже найдены. У старого AI Lockbox active native keys; отсутствие Supabase mounts в трёх AI workflows не даёт права удалить весь secret.
5. Зафиксировать минимальную поддерживаемую web/mobile версию, порядок обновления/запрета старых клиентов и понятный fallback до sunset; проверить отдельные APK/OTA/iOS installs, не только latest web.
6. Согласовать B03 operations и B06 retention, финальное окно: предлагается 7 полных суток после последнего runtime удаления, затем 24–48h pause. Это предложенные сроки, не уже согласованная политика.

**Выход:** все B01–B06 имеют конкретный owner/доказательство или запланированную зависимость; source/target counts известны; оценка P1 уточнена. Если ресурс не доступен для проверки, он остаётся OPEN — отключение запрещено, независимый код можно продолжать.

## P1. Закрыть media и server runtime

1. Перенести оставшиеся нужные chat objects и доказать Vital полноту. Нельзя `allow-missing`. Размер и checksum сверять с реально прочитанным source и target, не только доверять записанному metadata hash. Manifest/checkpoint обеспечивает повторяемость и идемпотентность; в Git не класть пользовательские object keys.
2. Custom при нуле: снять неиспользуемый legacy путь без создания новой функции. При ненуле: согласованное сохранение с native ownership/signer/namespace либо архивным контрактом; не потерять файлы из-за текущего пробела migrator.
3. Когда legacy references не требуют source, удалить Supabase stores/signers/bridge и fallback из server, три legacy routes, header/CORS/proxy/frontend bridge transport. Native storage config fail-fast/явная ошибка, без подключения к source после сбоя.
4. Сохранить существующие native upload/read/sign/remove contracts, access control, chat attachments, Vital изображения/видео и profile galleries. Не менять AI/prompts/Cloud Functions ради этого этапа.

**Проверки:** media migration verification/idempotency; native upload/sign/read/delete/error/ownership/cross-tenant API tests; старое вложение открывается при source network deny; Vital video/range/image и expiry/permissions, custom условный контракт. Full `npm run check`, relevant native browser Chromium/WebKit и exact-head green CI. DB tests, если менялась схема. Artifact manifests и агрегатные результаты закрывают S01/S02.

## P2. Убрать local Supabase auth/data и generated types

1. Перевести `#fit/local-auth`/`#fit/local-data`, local dev и tests на существующий native composition/API. Удалить GoTrue helpers, obsolete email/password/recovery UI, Supabase sessions/storage/realtime transport и legacy-only adapters. Существующий вход/связи Yandex ID сохранить.
2. Для 21 backend слота определить native implementation либо существующий unsupported контракт; не объявлять пользовательские упражнения используемыми только ради переноса adapter. Не добавлять параллельный data path.
3. Из смешанных query/repository модулей вынести neutral DTO/mappers и сохранить native части: AI parse/suggest, public profiles, workouts/summary/progress, errors/nullability. Затем удалить generated `database.types.ts` и SDK type references.
4. Вынести `fingerprintTenant`/необходимую canonicalization из migration subtree в узкий neutral модуль с тем же результатом; сохранить native identity unlink/rollout и migration-server native maintenance.

**Проверки:** существующие mapping/contract/unit и native import/build guards; auth/session/обе роли/invitations/realtime где реально используется; native API fixture tests. До UI-изменений выполнить обязательный UI preflight; browser/WebKit покрывают пользовательские состояния, не редизайн. Full check и exact-head CI. Сверить emitted/native AI contracts и неизменность prompts, без живых paid AI calls.

## P3. Сохранить покрытие и выключить legacy local/CI

1. Составить таблицу на уровне assertions: `старый spec/case/assertion → native spec/case/assertion → уникальный риск → статус`. Сначала найти существующее native покрытие; не копировать тесты, если тот же контракт уже доказан. Отдельно явно отметить obsolete Supabase email auth assertions, которые удаляются по прекращению самого контракта.
2. Перенести оставшиеся product fixtures с `/rest/v1`, GoTrue и Supabase RPC mocks на native fixtures/API PostgreSQL. 22 protocol-matching E2E файла — стартовый набор, а не 22 нуждающихся в переписывании spec: там есть helpers и no-Supabase guard.
3. Проверить число запущенных случаев и CI union; сохранить уникальные права/состояния/Chromium/WebKit/mobile viewports, не обновлять Fit Lime protected inventory SHA и не сокращать gates. Если protected spec затронут, требуется отдельный повторный аудит по текущим правилам.
4. Local `dev/local:prepare/local:verify` используют только Podman PostgreSQL17 + API/native fixtures. CLI `db:*` переопределить явно или удалить obsolete команды, обновить все callers; не оставлять command, молча требующий старую БД.
5. Убрать setup/start/reset/wait-for-local-auth Supabase из database и 11 browser jobs после mapping. Сохранить native clean-chain/actor/RLS, negative network/import guards и frontend acceptance. Legacy SQL/tests/config/seed и digest checks архивировать с проверяемым checksum вне активных checks; не удалять уникальные native migration guards вместе со старым check.

**Проверки:** на чистом окружении `npm ci`, native local startup/verify/seed и полный `npm run check`; clean PostgreSQL chain + actor/RLS/grants; полный native browser CI, including обе роли и движки. Отдельный прогон с остановленным Supabase и запрещёнными его endpoints/management/pooler. Сравнить tests before/after и тайминги; сейчас timed comparison **НЕ ВЫПОЛНЕНО**, configured instance count не выдавать за CI union.

## P4. Закрыть ops, deploy, secrets и packages

1. Закончить/заменить согласованные B03 email/contact/audit operations. Retire Supabase auth logs, old pilot RPC, legacy deploy/rehearsal/write-gate source workflows только после использования их final evidence. Native push и Cloud.ru inspection/recovery оставить. Никаких рассылок в рамках cleanup без отдельного прямого запроса.
2. Удалить оба stage mirror блока/helper и Terraform bridge mounts/IAM/vars. Убедиться, что никакие current/rollback revisions не требуют source credentials; закрепить native-only rollback образ/конфиг.
3. Архивировать legacy tenant exporter/importer/source fixture после extraction neutral helpers; сохранить native migrations/Cloud.ru backup/transfer/Vital deployment и обслуживание API. Source tooling не является единственным способом читать зашифрованный архив после закрытия проекта.
4. Удалить SDK/CLI из root/API package и lockfiles, unused env keys/aliases/scripts/tool tests. Проверить clean install/build и отсутствие транзитивного Supabase SDK в runtime dependency graph; сохранить pg/S3/Yandex ID/AI/web-push.
5. Удалить 5 GitHub secret instances после снятия readers; аналогично remote bridge keys/mounts/old revisions. Revoke токены только в надлежащем scope: account-wide access token может использоваться другими проектами. Shared AI Lockbox не удалять; удалить legacy payload entries/versions только после проверки readers и retention, имя можно оставить.
6. Актуализировать AGENTS/workflow/operations/product wiki/parity/local setup по фактическому native-only состоянию. Инертный legacy archive оформить с checksum, назначением и retention; автоматический guard запрещает active imports/network/env readers вне этого allowlist.

**Проверки:** targeted workflow/helper policy tests + Terraform plan: не уничтожаются native DB/S3/AI; package tree/lockfiles/static import/build boundary; clean install/build/dev/check и green full CI. Secret-name registry до/после и remote revision evidence без values. Все S03–S10 имеют закрывающую запись, archive исключения точны.

## P5. Доказать автономность и восстановление

1. С чистого checkout/без Supabase credentials собрать и запустить frontend/API/jobs/local PG17. Block outbound source project, Auth/REST/Storage/Functions/Management и DB/pooler; публичный домен источника может быть кастомным — использовать P0 registry. Нельзя ограничиться поиском строки `.supabase.co`.
2. Пройти native auth/Yandex ID/app-session, обе роли, истории/редактор/тренировки/прогресс, старые и новые media, native AI/Assistant contracts, speech и push contracts. Mock paid/external sends; реальный authenticated production smoke только согласованными тестовыми identities и без мутаций реальных данных/рассылок.
3. Защитить финальные source DB/Auth metadata/Storage bytes/manifests и restore инструкции независимо от живого Supabase; restore drill в изоляции. Пароли/контакты/токены не в Git/logs. Cloud.ru backup/restore отдельно доказывает сохранность новых writes. Supabase snapshot не является обратной миграцией.
4. Установить writer fence для старого контура, остановить producers и безопасно дренировать/архивировать очереди без повторной отправки. Точный порядок fence/final delta/snapshot зависит от source census P0; не потерять последнюю разрешённую запись между копированием и остановкой.
5. После последнего runtime deployment и минимальной поддерживаемой версии выдержать предложенные 7 суток: ноль зависимых запросов/записей/ошибок, штатные native jobs и продуктовые метрики. Собирать только агрегаты без payload/PII; новый reader возвращает соответствующий S-ID в OPEN, сбрасывает окно после исправления.

**Выход:** архив восстановлен, rollback Cloud.ru доказан; нет оставшихся operational source readers/writers; все проверки и observation evidence относятся к опубликованной native-only версии. Зелёный PR CI сам по себе не закрывает этот этап.

## P6. Фактически отключить Supabase

1. Перед исполнением владелец явно разрешает остановку конкретного проекта и retention/delete policy. Этот план такого разрешения не выдаёт; сначала предъявляются закрытые gates и reviewable runbook.
2. В поддерживаемом провайдером порядке остановить задачи/integrations и изолировать доступ; pause проекта, если тариф/провайдер это допускает. Если pause недоступен, нужен согласованный обратимый способ изоляции до irreversible delete — не считать удаление пробной остановкой.
3. Проверить production native smoke, media и scheduled pipelines при source недоступности, выдержать предложенные 24–48h. При регрессии восстановить доступ только как аварийное действие по runbook, не включать dual-write и не перетирать Cloud.ru данными старого snapshot.
4. После приёмки остановки удалить проект/оставшиеся functions/storage/DB/integrations и ненужные source credentials/оплату. Независимый архив сохраняется по утверждённой retention, затем удаляется отдельным контролируемым действием. Проверить отсутствие оставшихся billed resources и secret readers.
5. Сохранить итоговую квитанцию: версия релиза, даты fence/snapshot/pause/delete, агрегатные результаты, restore evidence и владелец retention. Никакой новой cleanup-задачи для обязательного остатка не должно остаться.

## Финальный acceptance: можно полностью отключить

- [ ] S01–S11 закрыты; у каждого resource/reader есть migrate/retire/inert archive результат и доказательство.
- [ ] B01–B06 закрыты; active recovery/account-history investigation не требует source.
- [ ] Root/API dependency trees, build, CI, local Podman PG и deployment работают без Supabase SDK/CLI/credentials.
- [ ] Нет runtime GoTrue/REST/RPC/realtime/Storage/Management/pooler запросов и server fallback; отрицательные guards остаются.
- [ ] Все необходимые data/media references native или явно утверждённый независимый архив; zero missing; custom bucket решение подтверждено фактом.
- [ ] Native auth/привязки/обе роли/AI prompts/Assistant/speech/media/push и actor/RLS сохранены и проверены подходящими тестами.
- [ ] Assertion mapping полон; не потеряны уникальные product checks/браузеры/viewports; full exact-head CI green.
- [ ] Секреты/permissions/revisions всех сред, remote functions/cron/Vault/hooks и внешние consumers учтены и выключены; shared native AI keys сохранены.
- [ ] Старые клиенты имеют принятый sunset; source writers ограждены, очереди не отправят дубли; окно наблюдения пройдено.
- [ ] Source независимый архив и актуальный native backup восстановлены в изоляции; Cloud.ru rollback не требует Supabase.
- [ ] Обратимая остановка проверена; явное разрешение delete/retention получено; нет остаточных billed ресурсов/операционных зависимостей.

Это конечная матрица. Переход к следующему этапу определяется доказательствами, а не количеством удалённых файлов. Следующая содержательная задача — **P0: remote/data census и закрытие решений по blockers**, после неё P1; дальнейшие случайные удаления не заменяют этот порядок.

## Проверка самого планового PR

Только Markdown: inventory path/count/coverage validation, относительные ссылки, `git diff --check`, штатный scope classifier и применимый CI. Runtime tests, native DB/browser acceptance, production smoke, remote/data audit и shutdown **не выполнялись этим PR** и не объявлены завершёнными. `npm run check` для документального diff заменяется утверждённой docs-only классификацией, если она подтверждена на точном head; обязательный CI не обходится.


## P2 — удаление legacy frontend — итерация 31.10.2026 — GPT-6 / OpenAI

Задача: удалить весь legacy frontend-контур и SDK, перевести оставшиеся сценарии на native fixtures. База main93784374. Серверный legacy chat/media migration, историческая Supabase БД, remote resources и secrets вне scope.

Расхождения: DataBackend выводит контракт из legacy реализаций; до их удаления выделяется явный provider-neutral контракт. Production уже native; local/test composition ещё выбирает Supabase. Авторизация email/password — прекращённый контракт, её проверки не выдаются за native покрытие.

Acceptance: (F1) native composition во всех режимах; (F2) явные DTO/repository contracts без SDK/DB rows; (F3) удалены legacy query/repository/auth/storage/realtime пути и frontend SDK; (F4) уникальные продуктовые assertions перенесены в native fixtures, obsolete transport/auth assertions отмечены отдельно; (F5) prompts/native поведение/media сохранены; (F6) полный check, Chromium/WebKit/visual и exact-head CI.

Решение: переиспользовать существующий native repository/API и native browser fixtures. Не создавать второй fake Supabase protocol или production fallback. Удаление server SDK/CLI/старой БД отложено за границу этой задачи.

Проверка/открыто: реализация и перенос сценариев выполняются; финальные результаты и соответствие старого покрытия будут записаны здесь до handoff. Production не изменялся.

P2, проверенная итерация: удалены local auth/data composition,22 legacy repositories,
legacy queries и root SDK dependency; runtime contracts явно описаны в
`src/data/contracts`. Generated legacy DB type побайтно перемещён в
`supabase/database.types.ts`, frozen SQL/operational consumers сохранены.
Нативные AI запросы выделены из удаляемого query-модуля без изменения prompts.
Публичное удаление аккаунта больше не требует authenticated backend до входа.
Исторические invitation source markers продолжают читаться через native API.

Проверки31.10: повторный полный `npm run check` после интеграции main88901eb7
прошёл —314 unit files,2833 tests; coverage83.62/78.31/83.17/88.1;
API1549 passed/238 skipped; lint/typecheck/build и policy suites passed.
E2E TypeScript и workflow docs checks passed. Уникальные browser assertions и
прекращённые SDK/GoTrue/PostgREST контракты: [карта соответствия](LEGACY_FRONTEND_TEST_MAPPING_20261031.md).
Native CRUD/auth/приглашения/chat, обе роли, записи и проверки прав используют
реальный локальный API/PostgreSQL; дальнейший exact-head browser/visual CI остаётся
гейтом. Draft PR1909: https://github.com/podkolzinpd/fit/pull/1909.

Обнаруженная совместимость при переносе: WebKit отображал native preparation
select ниже обязательной touch-высоты, native sport options имели40px.
Две scoped CSS-правки восстанавливают48px select и44px options, используя текущий
дизайн; никаких изменений prompts, данных, ролей или server permissions.
Падающие проверки доступности/таймауты не ослаблены. Восстановлены сохранённые
`fact.reps` при сборке fixtures рекордов: поверхностное переопределение `fact`
первоначально теряло повторения; продуктовая логика не менялась.

Отвергнуто: сохранение SDK ради старых protocol tests; второй fake backend;
снятие SQL regression из shared local stack (отклонено автоматической проверкой
scope, оставлено без изменения). Local stack по-прежнему готовит frozen SQL,
frontend env при этом всегда native. Linux ARM Podman/WebKit прогон локально
нестабилен, не объявлен зелёным; source/базы production не использовались.
Дальше в рамках этого же PR: завершить exact-head CI и передать готовый PR.
