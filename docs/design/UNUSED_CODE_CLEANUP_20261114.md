# Аудит неиспользуемого кода — 14.11.2026

## Задача и границы

Антон поручил проверить и убрать ненужные старые части приложения.
Очистка монохрома продолжается отдельно в Fit 16; её CSS и этапы MC5–MC8
не входят в этот пакет. База аудита: `27c8d603` (main, PR2117).
Каноническая запись этой задачи — данный документ.

| ID | Критерий |
| --- | --- |
| UC101 | Удаляются только объявления без потребителей, включая тесты и служебные входы |
| UC102 | Действующие маршруты, проверки данных, права, история и настройки сохраняются |
| UC103 | Тесты, сборка, зависимости и эксплуатационные входы проверены; непроверенное обозначено |
| UC104 | Остальные кандидаты имеют причину сохранения; очистка дизайна не дублируется |

## Метод и результаты аудита

- TypeScript AST: граф импортов/re-export/literal dynamic import от `src/main.tsx`;
  отдельно проверены импорты из тестов, e2e, сборки и scripts. Проверено 855
  TS/JS-файлов в `src`, достижимо 489 модулей. Недостижимость сама по себе
  не означает возможность удаления.
- Именованные экспорты сверены по всем отслеживаемым TS/JS-файлам репозитория;
  для удалённых проверены определения, внутренние ссылки, динамические входы
  и отсутствие побочных действий в удаляемых инициализаторах.
- Проверены модули API без импортирующих файлов: это server/function/CLI
  entry points, вызываемые workflows, package scripts и Terraform.
- Среди runtime-зависимостей без текстовых JS-ссылок только native-платформы
  Capacitor Android/iOS; они нужны native-сборкам. Зависимости не меняются.
- Все runtime-ресурсы `src/assets` имеют ссылки; оставшиеся PROVENANCE/OFL —
  происхождение и лицензия. Public URL-ресурсы нельзя снимать только по
  отсутствию импорта: есть иконки ОС, manifests, SW и генерация путей media.
- Основной объём оформления: `src/styles.css` 2 058 098 байт, `src/styles/`
  1 584 277 байт на исходной базе. Это размер исходников, не сетевой передачи.

## Удаляемые остатки

| Область | Подтверждённо неиспользуемое |
| --- | --- |
| Текст тренировок | Файл `workout-text-parser.ts`; действующие quick-entry/LLM parsers сохраняются |
| Push | Файл `wait-for-test-push-confirmation.ts`; актуальные settings/onboarding и SW сохраняются |
| Аналитика | Старый frontend `loadPrivateAnalytics` с локальной схемой/types; текущий explorer и серверные endpoints сохраняются |
| Каталог | `isExerciseSearchAlias`, `CATALOG_SECTIONS`, `WARMUP_MOBILITY_REFS`, `VITAL_FREE_PACK_VIDEO_BY_REF`; сами упражнения, media и действующий поиск сохраняются |
| Общие helpers | `blobFromDataUrl`, `todayLocalDate`, `prepareProfileImage`, `parseTrainerProfileDraft`; используемая обработка изображений, даты и schemas сохраняются |
| Остатки UI | Неподключённые `MissingWorkoutTemplatePage`, `StatusBadge`, `regularityWeekCountLabel`; CSS и работающие компоненты не меняются |
| Типы repositories | Неиспользуемые DutyReport/DutyAudit/CorporateInvitation и YandexPilotMembership/Invitation |
| AI/server | `clientContextRows`, `programTemplateSchema`, `assistantToolStateFilter`, `summaryQualityAdvisories` и старый `parseRequest`; действующие handlers/validators сохраняются |
| Server types/runtime | Неиспользуемые summary row types, SummarizeRequest/MAX_PERIOD_DAYS и `yandexDatabasePool` с его закрытым состоянием/imports; рабочий PgDatabasePool не меняется |

Ни один существующий тест не удалён и не ослаблен. Нет новых зависимостей,
миграций, изменений CI/CD, production-конфигурации или данных.

## Кандидаты, сохранённые в итерации 1

| Кандидат | Причина / следующий шаг |
| --- | --- |
| `composition-build-boundary.ts` | Используется Vite; граф только приложения этого не видит |
| `workout-home.ts` | Используется e2e fixture и собственными тестами; удаление сломает подготовку сценариев |
| `exercise-progress-page.ts` | Используется старым unit-контрактом; перед выводом требуется сопоставить assertions с текущим native-reader покрытием |
| `ClientProgressGoalSection`, `ProgressNextStepSection` | Недостижимы из приложения, но имеют тесты и прежние продуктовые решения. Отдельно согласовать с этапом Progress/MC; next-step логика по YAFIT-421 должна сохраняться |
| Legacy draft keys, каталожные aliases | Читают старые сохранённые данные; удаление может лишить пользователя черновика или истории |
| Supabase archive/rollback и native ops | Отдельный decommission-контракт; открытый PR2087 затрагивает operations. Этот пакет их не меняет |
| Большие WorkoutsPages/app.ts/generated catalogs | Размер не доказывает неиспользование. Декомпозиция потребует отдельного обоснования, не выполняется ради уменьшения файла |
| CSS, Onest/fallback и общие controls | Область Fit 16, действующие MC-контракты |

Дополнительный фильтр именованных функций (одно вхождение в нетестовом коде,
остальные только в тестах) дал ещё 23 кандидата. Это предварительный список,
не доказательство безопасного удаления тестов. Итог их разбора — в итерации 2 ниже:

| Группа | Имена / вывод |
| --- | --- |
| Нужные тестовые помощники | `resetYandexPlatformRequestStateForTests`, `exerciseSearchConflicts`: сброс состояния и аудит конфликтов каталога; сохранить |
| Старые преобразования/правила | `pageFromLookahead`, `exerciseProgressPageFromRows`, `groupCustomMetricValues`, `isLastSetOfBlock`, `clientWorkoutStatusLabel`, `compactPlannedSetOverview`, `exerciseChartPoints`, `canTransition`: сопоставить старые assertions с действующим native/API и UI покрытием |
| Progress | `ClientProgressGoalSection`, `bodyFigureVariant`, `clientProgressPresentation`, `formatWorkoutsPerWeek`: сверить принятый экран и этап MC перед выводом старого покрытия |
| Метро | `moscowMetroStationById`, `searchMoscowMetroStations`, `saintPetersburgMetroStationById`: сверить с объединённым справочником и сохранением городов |
| Остальные обёртки | `latestActiveWorkoutAction`, `captureInvitationLink`, `useVitalMediaUrl`, `replaceWithTranscript`, `goalCriterionFoundationState`, `parseTrainerCatalogPage`: проверить сохранение сценариев ассистента, приглашений, media/диктовки, целей и каталога тренеров |

## Итерация 1 — 14.11.2026 — Codex / OpenAI

Расхождения: нет для доказанно неиспользуемых объявлений; неоднозначные
кандидаты выше сохранены. Выбран узкий пакет удалений с неизменными тестами.
Отвергнуто: массовое удаление по словам legacy/old, возрасту или отсутствию
импорта из main; переименование провайдеров и новый механизм диагностики.

Проверки: исходная production-mode сборка и startup-проверка прошли;
сохранён компактный SHA256-манифест 244 файлов (30 486 706 байт).
Полный `npm run check` очищенной версии `f947d24c` прошёл: lint/typecheck,
3221 frontend tests, coverage 83,24% statements / 78,2% branches;
2 media + 7 speech + 483 infra + 22 calendar + 205 hosting tests;
API 1640 passed / 475 skipped (локальный PostgreSQL для DB-suite не запущен),
API build, frontend build и startup-проверка. Тесты с PostgreSQL остаются CI-гейтом.
Лог: локальный fit-storage run `20261114-111607-a2776153`, exit 0.

Сравнение сборок: 244 файла до/после, 235 побайтно идентичны, включая CSS,
media, WASM и OTA manifest. Main JS уменьшился с 4 522 643 до 4 522 423 байт;
остальные JS изменили hash/ссылки, размеры прежние. Общая разница — 220 байт.
Это прежде всего упрощение поддержки: большая часть мёртвого кода уже
отсекалась сборщиком. Ускорение приложения этим результатом не заявляется.

Удалены 28 неиспользуемых именованных экспортов и связанные закрытые
объявления: 24 code-файла, 2 строки заменённых imports против 272 удалённых.
Эксплуатационная инструкция обновлена в месте ссылки на удалённую фабрику.
Scope на точных SHA: frontendRequired=true/browserRequired=true (25 путей
первого коммита; последующее уточнение Markdown не сокращает набор).
Дополнительный строгий аудит unused locals выявил после удаления связанные
неиспользуемые imports — они сняты. В исходном тесте athlete-achievements
остаётся неиспользуемый параметр callback; обычный контракт теста не менялся.

CI версии `33382a4a7c340e2002640b20847c7f4e93dd1ae4` завершён успешно:
[CI run 43575462856](https://github.com/podkolzinpd/fit/actions/runs/43575462856),
[Android build 43575462839](https://github.com/podkolzinpd/fit/actions/runs/43575462839).
36 checks SUCCESS, отдельный Android auth-smoke штатно SKIPPED.
Пройдены app/e2e, API/PostgreSQL, Chromium/WebKit, полная visual/Lime матрица
и все четыре части native auth/nutrition. Физический телефон не проверялся.
[PR2118](https://github.com/podkolzinpd/fit/pull/2118) слит по прямому поручению
Антона 14.11.2026 в 12:10:26 МСК: `c736d4cadfea47a7712016737436c6776d03b116`.
Merge выполнен с проверкой точного head `33382a4a`. Перед merge проверены PR/CI:
ранее открытый PR2087 прямо ограничивает свою задачу «слияние и production
в этой задаче не выполняются»; его CI завершён, новых commits/reviews/comments
после 10.11 нет. Основание прохода очереди — явно удерживаемый выпуск,
не один лишь возраст PR. Чужой PR и чаты не изменялись/не опрашивались.
Merge не выдаётся за подтверждение production-доставки; main CI — run 43579283560.


## Итерация 2 — разбор всех 23 кандидатов — 14.11.2026 — Codex / OpenAI

Основание: после слияния PR2118 Антон поручил разобрать оставшиеся 23 кандидата,
удалить действительно ненужное, сохранить рабочие сценарии и не пересекаться
с Fit 16. База: `c736d4ca`; та же собственная рабочая копия, ветка
`chore/unused-code-candidates-20261114`. Изменений в CSS, controls, экранах,
`features/progress`, расчёте целей, схемах БД, API, конфигурации и зависимостях нет.

Результат аудита: **16 удалены; 2 нужны тестам; 5 оставлены в области целей/Progress**.
Последние пять не объявляются используемыми приложением: их удаление требует
разбора действующих продуктовых контрактов этой области, исключённой из пакета
по границе Fit 16. `ProgressNextStepSection` также сохраняется по YAFIT-421;
он не входил в эти 23 именованные функции.

| Кандидат | Решение и основание |
| --- | --- |
| `resetYandexPlatformRequestStateForTests` | Сохранён: изоляция состояния запросов в тестах |
| `exerciseSearchConflicts` | Сохранён: проверка конфликтов каталожных aliases |
| `ClientProgressGoalSection` | Сохранён: область Progress/Fit 16 |
| `bodyFigureVariant` | Сохранён: область Progress/Fit 16 |
| `clientProgressPresentation` | Сохранён: область Progress/Fit 16 |
| `formatWorkoutsPerWeek` | Сохранён: область Progress/Fit 16 |
| `goalCriterionFoundationState` | Сохранён: семантика целей/Progress, не затрагиваем контракт этой области |
| `pageFromLookahead` | Удалён: native repository использует `hasMoreWorkouts` и реальное число элементов; `collectPages` сохранён |
| `exerciseProgressPageFromRows` | Удалён весь orphan-файл: приложение читает готовую страницу native API через `exerciseProgressSchema` |
| `groupCustomMetricValues` | Удалён: native bundle уже содержит метрики внутри соответствующего замера |
| `isLastSetOfBlock` | Удалён: Live вызывает `restSecondsAfterSet`, учитывающий подтверждение круга и завершение всей тренировки |
| `clientWorkoutStatusLabel` | Удалена обёртка; те же проверки вызывают `workoutStatusPresentation(...).label` |
| `compactPlannedSetOverview` | Удалён неиспользуемый старый формат обзора; действующие compact/detail форматтеры сохранены |
| `exerciseChartPoints` | Удалён старый расчёт по массиву Workout; действующий экран читает серверные результаты по выполнению |
| `canTransition` | Удалено старое правило последовательных переходов; текущие start/finish/recordPlannedResult остаются без изменений |
| `moscowMetroStationById` | Удалён дубль и закрытая Map; тесты всех ID используют `metroStationById` |
| `searchMoscowMetroStations` | Удалён дубль; тесты используют `searchMetroStations(query, 'moscow')` |
| `saintPetersburgMetroStationById` | Удалён дубль и закрытая Map; ID и пересадки проверяются через общий справочник |
| `latestActiveWorkoutAction` | Удалён старый workout-only selector; сценарии проверяют действующий `latestAssistantSurfaceAction` |
| `captureInvitationLink` | Удалена одноаргументная обёртка; проверки query/hash/storage/auth используют `captureInvitationLocation` |
| `useVitalMediaUrl` | Удалена обёртка; проверки подписания/режима/retry читают `.url` действующего `useVitalMediaState` |
| `replaceWithTranscript` | Удалён старый нормализатор; те же строки проверяются через `appendTranscript('', text)` |
| `parseTrainerCatalogPage` | Удалена обёртка; отклонение старого формата проверяется через используемую repository схему |

### Сохранение покрытия вместо самопроверки мёртвого кода

Перед удалением проверены потребители по всему отслеживаемому коду. Удаляемые
функции вызывались только тестами; после правок их имена отсутствуют в
src/services/scripts/e2e. Рабочие реализации не переписаны, мёртвые функции
не перенесены в тестовые helpers. В runtime изменены только удаления и один
список type-imports: 11 файлов, 255 удалённых строк и 1 строка замены import.

| Прежние assertions | Действующее покрытие / причина вывода старого ожидания |
| --- | --- |
| 2 проверки offset/lookahead | Новый native repository test проверяет содержимое первой/последней страницы, offset, totalCount и параметры следующего запроса. `collectPages` по-прежнему проверяет последовательную загрузку и остановку |
| 2 теста старого exercise-progress row mapper | `workouts.repository.progress.test.ts` переведён на `createYandexMainRepository`: все поля результата, null→undefined в подходах, 20 элементов, totalCount, точный cursor, передача cursor в следующий HTTP-запрос, отсутствие cursor у последней страницы. SQL lookahead сохранён в native DB integration test «returns an old record after more than twenty newer results…» |
| 2 теста группировки custom metrics | Новый native repository test проверяет несколько замеров с пересекающимися metricId, сохранение значений за своим замером и пустой список. Старый Map по плоским SQL-строкам больше не является контрактом клиента |
| 2 теста последнего подхода блока | Сохранён блок `restSecondsAfterSet`: отдых между интервалами, активное восстановление, неподтверждённый круг, выполнение не по порядку, разные позиции и завершение. Старый признак «последний по позиции» не определяет действующий отдых |
| 1 тест компактного обзора плана | Сохранены `compactPlannedSetSummary` (одинаковые/разные/время/дистанция) и `compactExerciseDetailSummary` с UI-тестами редактора. Формат «первые два значения + …» относится только к удалённому formatter и не переносится в продукт |
| 9 тестов старых chart points | Действующий `WorkoutsPages` строит точки из серверных `primaryValue`, не из Workout и не через объединение тренировок одного дня. Native DB tests сохраняют confirmed-only, strength/reps/duration/distance, исключение planned/deleted и порядок по completedAt/UUID; `ExerciseProgressSummary.test.tsx` — единицы, факты без подмены планом, PR; `trainer-flow.spec.ts` — путь история→упражнение→назад и сохранённый факт. Старое объединение по дню не навязывается новому контракту |
| 1 тест canTransition | Сохранён native repository lifecycle test: start, finish, recordPlannedResult; API/DB/e2e lifecycle suites остаются. Старое blanket-ожидание planned→done=false не соответствует текущему отдельному сценарию записи результата |
| Обёртки auth/media/voice/metro/status/schema | Сохранены входные случаи и ожидания, вызовы направлены на действующие функции. В assistant старое ожидание скрыть новый non-workout tool заменено проверкой реально используемого surface selector: выбирается новый tool, старая тренировка не возвращается. Проверки applied/cancel/small-talk/restart и режима навигации сохранены |

Точечный прогон: 15 файлов / 326 тестов. Сначала новый тест native custom
metrics обнаружил неверное ожидание `notes: null` в добавленной фикстуре:
действующий mapper возвращает `undefined`. Исправлено только новое ожидание;
повтор соответствующего файла: 89 passed. Остальные 14 файлов: 237 passed.
Падающие существующие тесты не удалялись. Проверка TypeScript дополнительно
потребовала явный `null` как cursor первой страницы в двух новых вызовах;
аргумент исправлен согласно `data/contracts/backend.ts`. Полный повтор
`npm run check` запущен для окончательного кода. Локальные skipped DB-тесты
не засчитываются как пройденные; CI PostgreSQL/browser остаётся обязательным.

Дальнейшее состояние: подготовка отдельного PR второго пакета, без изменения
области Fit 16. Автоматические проверки и выпуск этого пакета ещё не
подтверждены; полный репозиторий очищенным не объявляется.


Квитанция локальной приёмки `3d61accc28110247f82fb0da66f34572ba18e07e`:
полный `npm run check` завершился exit 0, run fit-storage
`20261114-122317-283f69cc`. 359 frontend files / **3207 tests passed**;
coverage 83,21% statements / 78,2% branches; API 1640 passed / 475 skipped
(локально нет PostgreSQL); остальные проверки политик, lint/types,
frontend/API build и startup также прошли. Разница 3221→3207 = 16 тестов
только удалённых реализаций сняты, 2 проверки действующего repository добавлены;
ещё 2 старых mapper-теста заменены двумя native-контрактными тестами.

[PR2121](https://github.com/podkolzinpd/fit/pull/2121), head `3d61accc`.
Scope по точным base/head SHA: 26 файлов, frontendRequired/browserRequired=true.
CI run 43580444062 и Android run 43580444214 наблюдаются одним процессом с
паузой 90 секунд. Эта квитанция дополняет локальный канонический журнал;
проверяемый head после запуска CI не менялся.

Сравнение без повторной сборки с сохранённым исходным манифестом до PR2118:
244 файла в обеих версиях, 235 побайтно одинаковы; все исходные CSS совпадают.
Итоговый размер 30 486 424 против 30 486 706 байт: −282 байта за оба пакета
(−62 байта относительно итерации 1). Польза — уменьшение поддерживаемого
исходного кода; заметное ускорение или сокращение загрузки не заявляется.

CI attempt 1: `e2e-yandex-auth (3/4)` / job `132405016259` завершился failure
из-за **1 flaky** при 446 passed. Тест `Progress Lime skin ownership
client-light-390-query-error-true` (`e2e/lime-progress-skin.cases.ts:132`)
не прошёл первое сравнение before/after в `probeEditorSkin`, но прошёл retry.
Высота root изменилась 1617,36→1641,77, diff содержит дополнительные элементы.
Probe не меняет DOM/CSSOM: это нестабильное состояние во время двух снимков;
вероятная причина — завершение параллельной загрузки во время loading-пробы.
Точный источник позднего обновления по сокращённому CI-логу не установлен.
CSS, Progress и probe не менялись в пакете. Политика fail-on-flaky сохраняется.
После окончания attempt 1 допустим один повтор только этого failed job и
его зависимых gates, без повторения зелёных jobs. Исправление Progress/probe
не включается в этот пакет по прямой границе с Fit 16. Большой diagnostics ZIP
(215,6 MB) не скачивался; сохранён компактный лог конкретного job.


Main CI после merge PR2118 (`43579283560`) завершился SUCCESS. В первом
запуске PR2121: 33 CI jobs SUCCESS, только flaky shard и зависимый e2e gate
FAILURE. Попытка повторить завершённый job до конца всего workflow была
отклонена GitHub; после завершения attempt 1 точечный rerun принят (exit 0).
Повторяется только job `132405016259` и зависимый gate, исходники/head неизменны.


### Итог приёмки итерации 2

14.11.2026, 14:08 МСК: точечный повтор завершился SUCCESS без изменения
`3d61accc28110247f82fb0da66f34572ba18e07e`. В основном CI 35 jobs SUCCESS;
с Android — **36 SUCCESS / 1 штатный SKIPPED**. PostgreSQL, browser/WebKit,
visual/Lime и native auth/nutrition gates пройдены. Первая нестабильность
Progress сохранена выше как отдельная находка; тесты и fail-on-flaky не
ослаблялись, Fix Fit 16 в пакет не добавлялся.

[CI](https://github.com/podkolzinpd/fit/actions/runs/43580444062),
[Android](https://github.com/podkolzinpd/fit/actions/runs/43580444214).
PR2121 OPEN / MERGEABLE, base `c736d4ca`, head `3d61accc`, не слит.
PR2118 MERGED; его main CI также SUCCESS. Все 23 кандидата разобраны:
16 удалены, 2 тестовых помощника сохранены, 5 элементов целей/Progress
сохранены по границе Fit 16. Полная очистка всего репозитория не заявляется.

Этот локальный отчёт дополнен квитанциями после проверяемого коммита;
актуальная приёмка опубликована в описании PR2121. Head после CI не менялся.
Лог первого flaky job хранится вместе с закреплённым локальным прогоном
fit-storage `20261114-122317-283f69cc` как `ci-auth3-attempt1.log`.

## Итерация 3 — подготовка разрешённого merge PR2121 — 15.11.2026

Антон разрешил слияние PR2121 и запросил оценку оставшегося лишнего кода вне
Fit 16. Перед merge main продвинулся до `5325de7e` (PR2119, публичный landing;
5 файлов вне нашего runtime diff). В собственную ветку добавлен актуальный
main без конфликтов; ранее локальные квитанции итерации 2 включены в коммит.
Код удаления 16 кандидатов не менялся. Правила AGENTS/FIT_WORKFLOW/
CURRENT_STATE/ACTIVE_CONTRACTS/ENGINEERING_RULES/REGRESSION_LESSONS между
`c736d4ca` и `5325de7e` не изменились. Новый head требует новой приёмки.

Очередь проверена по GitHub: PR2120 остаётся draft с прямым условием
«PR остаётся draft до отдельного разрешения владельца на выпуск; merge,
auto-merge и публикация не запускались»; PR2087 по-прежнему явно исключает
слияние и production из своей задачи. Их head/ограничения проверены,
чужие PR и чаты не изменялись. Это основание для выпуска разрешённого
PR2121 после актуализации и зелёных проверок, не обход по возрасту PR.


### Остаток вне Fit 16 — дополнительная оценка 15.11.2026

Повторный адресный AST/текстовый просмотр 1607 tracked TS/JS-файлов дал три
именованных экспорта с единственным вхождением: `chatRepository`,
`trainerProfilesRepository`, `workoutTemplatesRepository` в
`src/test/native-backend.ts`. Проверены все consumers модуля: используются
`nativeBackend` и другие named exports, namespace/dynamic enumeration нет.
Три aliases не имеют потребителей; сами соответствующие backend-сервисы
работают и не предлагаются к удалению. Это три строки в тестовой заготовке,
не заметный размер production bundle; отдельный большой PR ради них не нужен.
В этом ходе они не удаляются: запрос на остаток — оценка, merge касается PR2121.

Следующий крупный слой — завершение source/operations decommission:
- PR2087 уже содержит снятие obsolete nutrition inspector/workflow и Supabase
  Auth lookup из athlete restore. Не дублировать и не сливать без отдельного
  поручения; сам PR явно удерживает выпуск.
- Account history/links/deletion, private program/journal import и
  email-audience/recovery имеют текущие workflow consumers и Supabase readers.
  Это кандидаты на замещение/вывод после завершения нужных восстановлений,
  а не доказанно мёртвые файлы.
- `services/api/src/tenant-migration/` — 23 tracked файла, 208776 bytes.
  Экспорт/импорт/rehearsal можно отделять от постоянно нужного обслуживания,
  но `fingerprintTenant`/bundle используется native rollout/identity unlink,
  а `migration-app` обслуживает maintenance. Каталог целиком не удалять.
- `services/legacy-api-proxy` и `route-legacy-yandex-to-cloudru` сохраняют
  совместимость прежних API-адресов; без traffic/version evidence и решения
  по старым клиентам не считать их лишними. В этом ходе remote traffic/данные
  и secrets не проверялись, production-записей не было.

Не являются доказанным мусором: `legacy-workout-parser` импортируется сервером
и pilot parser, `legacy-summary` — действующим training-summary core; старые
ключи черновиков сохраняют чтение пользовательских данных. Объём файла и
слово legacy сами по себе не дают основания удалять. Новая оценка не меняет
зафиксированный результат 16/23 и границы Fit 16.


Новый полный локальный `npm run check` для head `1ba90ef8` завершился exit 0:
fit-storage `20261115-160130-ec54364f`. Source приложения/очистки не менялся
после объединения с main. CI43716832357/Android43716832349 выполняются.

CI43716832357, attempt1: `e2e-fit-lime (webkit, visual, 4/4)` job
`132820172357` FAIL: 152 passed, 2 failed, 1 flaky. В
`trainer-schedule-v2.visual.spec.ts:5945` контроль before был снят с начальным
значением 15.11.2026/без времени, а после закрытия календаря уже загрузились
данные fixture 24.09.2026/10:00–11:00. Другие попытки этого case и сценарии
`:6974` доходили до 30s timeout / закрытия страницы; dark390 прошёл retry,
light390 не уложился. Точный источник задержек без отдельного воспроизведения
не объявляется установленным. Source приложения, API и e2e между прежним
зелёным `3d61accc` и `1ba90ef8` побайтно прежний (git diff пуст); добавился
только публичный landing и журнал. Fail-on-flaky/timeouts/assertions не
меняются. После завершения attempt1 — один адресный повтор failed job и gate;
изменения Fit16/shared visual tests в этот пакет не добавляются.

Attempt1 завершён: 33 CI jobs SUCCESS, WebKit visual4/4 и зависимый e2e gate FAIL; Android SUCCESS / один штатный SKIPPED. Один адресный rerun job132820172357 принят 15.11 в16:50 МСК, зелёные jobs не перезапускались. Единственный watcher session14490, пауза90s. Исходный failure log перемещён в закреплённый fit-storage run20261115-160130-ec54364f как ci-webkit4-attempt1.log.

Адресный повтор CI43716832357 завершился SUCCESS в17:07 МСК: всего36 checks SUCCESS /1 штатный Android SKIPPED для1ba90ef8. Визуальные тесты не менялись. Перед merge повторная проверка main выявила уже слитый PR2120 (MC5.5) в231e132eb03eef7555a1f353928df14014cc3fa7. Наша ветка обновлена без конфликтов; изменение Fit16 сохранено как upstream, самостоятельных правок skin нет. Прочитаны только изменившиеся CURRENT_STATE и новый раздел REGRESSION_LESSONS о границах skin/семантических fallback; другие обязательные инструкции не менялись. Новая совместная версия требует свежего local check и CI. PR2087 остаётся open с явным запретом выпуска в его задаче, других open PR перед обновлением нет.

Совместный headbeec7d3401f8732755a4162e5d25df5100f36f3e включает main231e132e. Полный локальный npm run check PASS, exit0:3207frontend/359files; coverage83.22%statements/78.2%branches/82.19%functions/88.08%lines; API1640passed/475conditional-skipped; lint/types/policies/build/startup PASS. Квитанция fit-storage20261115-171059-09eaa1aa закреплена. CI43722951177 и Android43722951205 выполняются, единственный watcher94844; новая причина повторного полного прогона — изменившийся main с MC5.5, собственный код очистки прежний.

Итог15.11: headbeec7d34 прошёл CI43722951177 attempt1 (35SUCCESS) и Android43722951205 (assembleSUCCESS/штатный auth-smokeSKIPPED):36checksSUCCESS/1SKIPPED, без повторов этого head. Перед merge подтверждены origin/main231e132e, CLEAN/MERGEABLE, точный headbeec7d34. Очередь:2087 с прежним явным release hold;2122 позднее нашего2121. PR2121 MERGED в15:27:43UTC (18:27:43МСК), squash3140a1cb2da2bb8f9c48f489550e7a3cdc6d8675. Readback GitHub подтверждён. Слияние разрешено пользователем; отдельный production deploy не запускался, его результат не заявляется. Финальная квитанция добавлена локально после проверенного head и опубликована в PRbody; source head после CI не менялся.

Продолжение15.11: актуализация2087 и аудит migration/recovery ведутся в существующем [плане вывода Supabase](SUPABASE_DECOMMISSION_PLAN_20261023.md#sb-native-ops-03--безопасная-актуализация-pr2087--15112026); рабочие пути и границы удаления зафиксированы там.


## Итерация 4 — небольшой безопасный остаток после PR2087 — 15.11.2026

Задача владельца: следующий безопасный пакет, рабочие сценарии и граница Fit16
сохраняются. База main3bc55ab3 (2087 MERGED), своя прежняя копия переиспользована.

| Объект | Доказательство отсутствия рабочего вызова | Сохранение контракта |
| --- | --- | --- |
| 13 named aliases в src/test/native-backend.ts | Все tracked imports, включая e2e harness, используют только nativeBackend/exercisesRepository/appFeedbackRepository | Эти3экспорта, сама composition и media fixture сохранены |
| SYSTEM_EXERCISE_CATALOG_VERSION | Только импорт и toBe(16) в собственном тесте | Данные каталога,39test cases и содержательные assertions прежние |
| readNutritionPilot | Старый UUID parser вызывается только собственным тестом; server использует readNativeNutritionPilot | Native fail-closed/cohort/duplicates/disabled tests, diary/draft UUID validation сохраняются |
| diagnosticAllowed | Старый email gate истёк18.09 и не вызывается runtime | PrivateSummaryDiagnostic и2живых requestYandexSummary diagnostic tests остаются |

Уточнение прежнего инвентаря: не3, а13 test aliases лишние. Поиск одинаковых имён
по всему репозиторию ошибочно связывал остальные с несвязанными product/mock
объявлениями. Проверены именно импорты модуля, namespace/dynamic enumeration нет.
Удаление test aliases не удаляет ни один сервис nativeBackend.

В API дополнительно найдены12 runtime-недостижимых экспортов, оставленных для
следующего отдельного пакета после карты assertions к живым путям:
-5self-service helpers (authorizeSummaryActor/clientVisibleSummary/cache/empty/
HTTP-error) → DatabasePilotTrainingSummaryService/RLS; живой parseYandexJson
сохранить. Старое разрешение connected trainer не переносить в более строгий
нынешний приватный summary-контракт;
-completedWorkoutsInPeriod → реальная SQL-выборка training-summary.ts;
-requestYandexSummaryDeduplicated → действующий DB generation guard;
-runNativePilotAssistantTurn → DatabasePilotAssistantTurnRunner.runTurn,
сохранить idempotency/turn-id reuse/persisted action ID assertions;
-summaryTurn/allowsAssistantAction/createProgramTurn/createClientTurn → живые
programPilotTurn/assistantNavigationTurn/recordWorkoutTurn. Исторические tool
validators и общие matching helpers всё ещё используются, их не удалять.

Сохранены доказанно полезные test/операторские объекты: resetYandexPlatformRequestStateForTests,
workoutHomeSummaries/computeClientStats (e2e fixtures),83-card reviewed media inventory,
withActorTransaction, programPlanFromTemplate/prescribeProgram и USDA provenance.
Direct program service имеет отдельный незакрытый cleanup-prechannel долг;
его crypto client helpers не удаляем по одному отсутствию imports. Самостоятельный
CLI аудита купленного media-каталога также не orphan. Рабочие recovery/migration
сценарии из предыдущей итерации повторно не переписываются.

CSS, JSX экранов, профиль/Progress, Fit16 визуальные тесты, CI/deploy, зависимости,
БД/данные/реальные настройки не затрагиваются. Новые тесты/оси не добавляются;
снятые self-tests относятся только к прекращённым реализациям. Приёмка впереди.

Итерация4 опубликована в PR2124, headc741d222a1e6e53c9063f8e3da267479c6edb804.
Целевые39catalog+14API cases PASS. Независимый review подтвердил отсутствие
живых consumers удалённых export/gates и сохранность session/RLS/privacy paths.
Полный npm run check PASS, exit0; fit-storage20261115-200830-9bcca555 закреплён:
frontend3207/359files, coverage83.21/78.2/82.19/88.07; API1638passed/475conditional
skips без localPG (минус ровно2obsolete self-cases), infra475passed; lint/types/
policies/build/startup PASS. Production frontend bundle index-B9-uzUoP.js прежний,
ускорение/уменьшение runtime от этой небольшой уборки не заявляется.
Классификатор exactbase3bc55ab3/headc741d222 требует полный browser/frontend CI.
CI43739544083/Android43739544145 выполняются. Merge/deploy не выполнялись.

CI43739544083 attempt1:33SUCCESS, job132890097212 e2e-yandex-auth(1/4)
и зависимыйe2e FAIL. Причина job:3Fit16 library/editor skin cases превысили30s
(467passed,44.5min): client-light-390-favorite-editor-true,
trainer-dark-430-template-editor-true, trainer-dark-390-clarify-true-false.
Timeout случался в CSSOM/state/style handle probes, а в одном retry после
выбора уточнения упражнений. Эти тесты/UI/CSS не менялись; frontend bundle
совпадает с предыдущим зелёным2087. Причина задержек не объявляется доказанной.
После завершения всего первого workflow принят один адресный rerun failedjob
и gate в21:16МСК, без изменения source/assertions/timeouts/retries. Log сохранён
в pinnedrun20261115-200830-9bcca555/ci-auth1-attempt1.log. Повторное падение
не будет скрыто очередными перезапусками или исправлениями чужой Fit16 области.

Итог единственного повтора CI43739544083: job132908715736 FAIL, те же3cases
превысили30s,467passed(43.1min). На этот раз stops в CSSOM/state/style-handle/
fonts-ready probes; ни одна причина задержки не объявлена окончательно установленной.
Лог pinnedrun20261115-200830-9bcca555/ci-auth1-attempt2.log. Проверенный checkout
первогоjob c97011ab — mergec741d222 в3bc55ab3, база CI совпадала с локальной.
GitHub exactheadc741d222:34checksSUCCESS/2FAILURE(job+gate)/1штатныйSKIPPED.
Локальные проверкиPASS, но общая приёмкаBLOCKED; PR2124 переводится вdraft,
merge/auto-merge/deploy не выполняются. Повторных rerun больше не запускаем,
таймауты/гейты/тесты не ослабляем, Fit16 файлы не редактируем и его чат не читаем.
Условие продолжения: устранён воспроизводимый timeout соответствующих Fit16
probes или подтверждена/исправлена причина среды; затем актуальный main/head
и штатная приёмка. Код текущей очистки сохраняется для review, готовность к
слиянию не заявляется. Оба watcher завершены; новая автоматизация не создавалась.


Уточнение 16.11: перечень 12 AI-кандидатов выше — историческое состояние
итерации 4. Все 12 разобраны и сняты в уже слитом PR2126 (итерация 5 ниже),
карта переноса assertions сохранена. Для connected trainer действует актуальная
migration000149: сводку видит текущий активный тренер, прежний после disconnect
теряет доступ. Это проверено реальным native/RLS-тестом; рабочая логика не менялась.

## Итерация 5 — оставшиеся 12 AI-кандидатов — 15.11.2026 — Codex / OpenAI

Основание: Антон поручил разобрать 12 оставшихся AI-кандидатов, перенести
полезные проверки на действующие сценарии и убрать лишнее. Дополнительное
условие: не менять механики ИИ-разбора. PR2124 (предыдущий пакет, итерация 4)
остаётся отдельным удерживаемым черновиком и не сливается. Этот пакет начинается
от main `2769acf597eb020673e9a51963f512f77cc38148`, без изменений PR2124.
Собственная рабочая копия переиспользована; ветка `chore/ai-unused-code-20261115`.

Расхождения: нет. Невызваемые реализации не являются действующим продуктовым
контрактом. Поиск consumers включает tracked runtime, тесты, scripts и
динамические входы; одного слова legacy или размера файла недостаточно.
В production удаляются только недостижимые объявления и их закрытые helpers.
Промпты, модели, распознавание, выбор упражнений, структура тренировок,
доступ, сохранение, feature flags и исторические валидаторы не меняются.
CSS, экраны и visual-проверки Fit 16 не затронуты.

| Кандидат | Решение / действующий путь |
| --- | --- |
| `authorizeSummaryActor` | Удалён; доступ проверяет `DatabasePilotTrainingSummaries` через native session и PostgreSQL RLS |
| `clientVisibleSummary` | Удалён; клиентский ответ формируют `list/readCache`, отдельная опубликованная сводка скрывает внутренние поля |
| `hasCompletedWorkouts` | Удалён; реальный `readSource` отклоняет пустой текущий период |
| `shouldUseClientCache` | Удалён; `generate` проверяет настоящий fingerprint-cache, в том числе при force |
| `yandexHttpError` | Удалён старый formatter; действующий model client и его ошибки остаются |
| `completedWorkoutsInPeriod` | Удалён orphan-модуль; текущий SQL выбирает выполненные, неудалённые тренировки текущего и предыдущего периодов |
| `requestYandexSummaryDeduplicated` | Удалены wrapper и локальная Map; реальный путь защищён PostgreSQL generation guard |
| `runNativePilotAssistantTurn` | Удалён старый runner; сервер использует `DatabasePilotAssistantTurnRunner.runTurn` |
| `summaryTurn` | Удалён старый builder; живые matching/cancellation helpers и historical validators сохранены |
| `allowsAssistantAction` | Удалён старый общий gate; реальные workout/program flows и navigation сохраняют свои проверки |
| `createProgramTurn` | Удалён старый одношаговый builder; используется `programPilotTurn` с questionnaire |
| `createClientTurn` | Удалён прежний диалог создания; действующая navigation открывает карточку, historical payload остаётся читаемым |

### Перенос полезных проверок

| Старое покрытие | Проверка действующего сценария |
| --- | --- |
| Capability reply, replay, конфликт turn ID, action UUID, собственная карточка | Пять прежних cases вызывают `DatabasePilotAssistantTurnRunner.runTurn`; настоящий native transaction wrapper, synthetic DatabasePool. Дополнительно replay не пишет повторный ответ |
| Приветствия/вопросы, склонения имён, неоднозначные aliases, отмена программы | `recordWorkoutTurn`, `programPilotTurn` с настоящим matcher и `isSummaryCancellation`; questionnaire не запускает генерацию преждевременно |
| Поля старой client-card action | Historical validator сохраняет мужской/женский payload и отклоняет недопустимые поля; enabled validator запрещает новые legacy actions. Navigation открывает создание без write-action |
| Одновременный повтор генерации | `training-summary-generation.test.ts` вызывает реальный `generate`: один model call, второй запрос получает 409 in_progress; сохранение и завершение guard однократны, повтор force возвращает кэш |
| Доступ, приватность, source filtering, пустой период, cache/force | Новые cases в PostgreSQL actor-context suite вызывают реальный summary service; отдельные native sessions и синтетические данные |
| Блокировка конкурентной генерации | Две реальные PostgreSQL транзакции проверяют один claim и один in_progress для одного fingerprint |

Снятые специфические ожидания: локальная dedup-Map возвращала общий Promise,
но живой API отвечает 409 на незавершённый повтор; старый одношаговый program
brief заменён действующим questionnaire; старый client-builder парсил реплику,
а действующая navigation не создаёт карточку сама. Эти старые поведения не
переносятся в продукт. Некорректные/null даты не являются допустимой строкой
PostgreSQL `date NOT NULL`. Старые literal HTTP503/504 сообщения сняты вместе
с formatter; действующий core сохраняет проверки unavailable и invalid JSON.
`parseYandexJson` и его assertions сохранены без изменения.

Отвергнуто: массовое удаление legacy-каталогов, изменение работающего ИИ ради
упрощения тестов, новые production injection points, ослабление обязательных
проверок. Реальные AI-вызовы и production операции не выполняются.

Приёмка: целевые unit-наборы пройдены; полная локальная проверка и PostgreSQL
ещё выполняются. Сквозная CI-проверка и слияние этого пакета пока не выполнены.
Следующий шаг — завершить локальную/CI-приёмку и подготовить отдельный PR.

Первый PostgreSQL-прогон новых fixtures выявил две проблемы. В новой cleanup
заготовке не учитывался FK `client_trainer_relationships`; порядок удаления
собственных синтетических строк исправляется. Отдельно обнаружен существующий
дефект `DatabasePilotTrainingSummaries.diagnose`: прямой SELECT из
`app_private.training_summary_generation_guards` недоступен роли `fit_api`
после применения действующей цепочки миграций. Метод и grants не менялись
в этом diff. Расширение прав/исправление diagnostic API исключено из безопасной
очистки и остаётся отдельной задачей. Новые проверки переведены на действующие
`generate/list` с синтетическим ответом модели; production AI не вызывается.
Неуспешная первая квитанция: fit-storage `20261115-222232-c2e6d175`.

Локальная приёмка: 3200 frontend tests, coverage 83,2% statements / 78,19%
branches; lint/types и проверки политик прошли в общем `npm run check`
(`20261115-222231-6eff0412`). Этот запуск остановился на типизации новых API
тестовых mocks в ESLint. Исправлены только тестовые типы/Promise.resolve;
оставшиеся API lint/types/tests/build и frontend build/startup прошли отдельным
продолжением `20261115-222732-6e0074f8`: API **1638 passed / 479 skipped**
(DB-тесты здесь условно пропущены). Успешные неизменные frontend этапы не
повторялись. Workflow docs и whitespace checks прошли.

Четыре новых PostgreSQL cases прошли на настоящей локальной PG17:
`20261115-222516-0a6487f9`. Полный DB-прогон `20261115-222535-120a3ea9`
завершился на прежнем assertion выбора индекса session cleanup: planner выбрал
`yandex_app_sessions_profile_expiry_idx` вместо ожидаемого cleanup index;
15 + 405 tests passed, 1 failed, 1 optional S3 skipped. Сам тест/индексы не
менялись. Повтор с чистой базой требуется, чтобы исключить влияние данных
предварительного прогона. Его первый старт `20261115-222732-8f5a1490` попал
на незавершённую инициализацию PG; это ошибка подготовки среды, не PASS.

Независимый review production AST: **0 изменений сохраняемых деклараций**;
удалены 349 строк runtime в пяти файлах. Снятые инициализаторы — пустая Map
и RegExp, без IO/регистраций. Имена всех 12 кандидатов отсутствуют в оставшемся
tracked коде, включая строковые обращения. CI и полный DB-гейт остаются
условиями приёмки; состояние отдельных прогонов не выдаётся за весь зелёный PR.

Итог локальной приёмки `28d8671d6bca8346f5fb8a23859a8cc517014f07`:
после подтверждённой готовности чистой PostgreSQL полный `npm run test:db`
прошёл, exit 0, fit-storage `20261115-223300-5065ff23`: 478 Vitest + 6 Node
tests passed, одна необязательная S3-проверка skipped. Предыдущий index-plan
assertion также прошёл без изменения теста/SQL. Локальные frontend/API/DB,
lint/types/policies/build/startup завершены; сохранённые квитанции закреплены.
Финальный docs-only commit не меняет проверенный source.

Открыто: GitHub CI/browser matrix ещё не запускались. `git push` отклонён
автоматическим approval-review: для внешней публикации ветки/нового PR
потребовано отдельное явное разрешение Антона. Действие не выполнялось,
обход не предпринимался. Готовы локальный коммит и описание draft PR;
после разрешения — push этой ветки, создание отдельного draft и полный CI.
PR2124 повторно прочитан: OPEN/DRAFT, head `c741d222`, без слияния/изменений.
Собственная временная тестовая PostgreSQL останавливается после проверки;
production/общие контейнеры не изменяются.

Антон отдельно разрешил публикацию ветки, отдельный draft PR и запуск проверок;
запрет merge PR2124 сохранён. Ветка опубликована, создан
[PR2126](https://github.com/podkolzinpd/fit/pull/2126), точный head
`619cc22f7ec47325794c55de06e4b6654b9dbbe0`, OPEN/DRAFT. Main при публикации
по-прежнему `2769acf5`; самостоятельных изменений Fit16 нет. CI run
`43753838123` и Android `43753838080` запущены автоматически для этого head.
Свой CI наблюдается одним процессом с внутренней паузой 90 секунд; другие
чаты/PR не опрашиваются. Эта локальная квитанция добавлена после публикации
и не меняет проверяемый head. Слияние и production-выпуск не выполняются.

Итог PR2126 для `619cc22f7ec47325794c55de06e4b6654b9dbbe0`: CI
[43753838123](https://github.com/podkolzinpd/fit/actions/runs/43753838123)
завершён SUCCESS (35 jobs), Android
[43753838080](https://github.com/podkolzinpd/fit/actions/runs/43753838080)
SUCCESS (assemble; один штатный auth-smoke SKIPPED). Всего 36 SUCCESS /
1 SKIPPED, attempt 1, без rerun. Пройдены API/PostgreSQL, приложение,
Chromium/WebKit, полная visual/Lime матрица и четыре части native auth/nutrition.
Квитанция `20261115-224235-d1795ef8` закреплена; watcher завершён exit 0.
Полный результат и ID приёмки опубликованы в PR body, без изменения source/head.
PR остаётся draft; PR2124 не сливался, production deploy не запускался.
Физический телефон не проверялся. Прежний дефект diagnostic SELECT остаётся
отдельным открытым хвостом, механики работающего ИИ не менялись.

Антон разрешил слияние обоих PR и уточнил порядок: **2126 первым, 2124 после**.
Предыдущий hold 2124 снят этим поручением. Перед merge проверены точные PR и
GitHub-очередь: открыты только 2124/2126. За время CI main продвинулся до
`d6e1840a` (MC5.6), поэтому 2126 стал BEHIND. Инструкции не изменились,
прочитан только изменившийся пункт CURRENT_STATE. Собственная очистка прежняя;
новый main включается как upstream, без самостоятельных правок Fit16.
Совместная версия проходит новую локальную проверку и CI до слияния.

Совместный head `f81b1bbb39157df37059c32ca8d8eba37830a3e8` опубликован.
Полный локальный `npm run check` завершён exit 0, закреплённая квитанция
`20261115-233551-e192a777`: frontend/API lint/types/tests, policies,
обе сборки и startup PASS. Код API/перенесённых summary-проверок относительно
прошлого зелёного `619cc22f` побайтно прежний; PostgreSQL также проходит в
новом CI. CI `43759043668` / Android `43759043641` выполняются, свой watcher
с паузой 90s; эта локальная квитанция не меняет опубликованный head.

16.11.2026: совместный `f81b1bbb` прошёл CI43759043668 (35 SUCCESS) и
Android43759043641 (assemble SUCCESS / штатный auth-smoke SKIPPED), без rerun.
Квитанция `20261115-233740-04d9344d` закрепляется. Перед merge подтверждены
main `d6e1840a`, CLEAN/MERGEABLE, точный head, 36 SUCCESS / 1 SKIPPED.
Очередь: открыты только наши 2124/2126; Антон прямо указал 2126 первым.
PR2126 MERGED 16.11 в 00:20:23 МСК, squash
`1568a09b55fa098f9aa943306008d79c5ce0dfcb`; readback GitHub подтверждён.
Далее — актуализация/приёмка/merge PR2124, затем дополнительный аудит остатков.
Слияние не выдаётся за подтверждённую production-доставку.


### Приёмка PR2124 после слияния PR2126 — 16.11.2026

Антон разрешил слияние обоих пакетов в порядке 2126 → 2124, затем дальнейший
аудит остатков. PR2126 уже слит в main1568a09b. Ветка2124 актуализируется от
этого main; единственный конфликт был в конце данного журнала. Сохранены
итерации4/5 и обе карты assertions, локальные квитанции прежних запусков.
Runtime/API/test-файлы объединились без конфликтов. Старое падение c741d222
не является вердиктом новой версии: upstream включает passive UI checks
из2122 и MC5.6; наши skin/UI-файлы не меняются. Для нового head выполняются
полный local check и CI, гейты/таймауты/продуктовые механики не ослабляются.

Head `04f61298634c7490cbd4a52b82f494bebea97192` опубликован. Полный
`npm run check` PASS, exit 0, закреплённая квитанция
`20261116-002318-971dfe2b`: 3200 frontend / 1636 API tests passed,
479 conditional API/DB skips локально; coverage 83,19% statements / 78,18%
branches, lint/types/policies/build/startup PASS. Минус два obsolete API cases
относительно PR2126 — только удалённые собственные проверки старых gate/parser.
Независимый integration review не обнаружил изменённых сохраняемых деклараций,
откатов PR2126 или потерь native cohort/UUID/privacy/diagnostic поведения.
CI43763547818 / Android43763547784 выполняются; свой watcher с паузой90s.
Публикация данной квитанции не меняет текущий проверяемый head.

16.11 итог: head04f61298 прошёл CI43763547818 (35 SUCCESS) и Android43763547784
(assemble SUCCESS / штатный auth-smoke SKIPPED), всего36 SUCCESS /1 SKIPPED,
attempt1, без rerun. Старый блокировавший auth1 также прошёл на новой базе.
Квитанция `20261116-002624-3277080b` закреплена; watcher завершён exit0.
Перед merge подтверждены main1568a09b, CLEAN/MERGEABLE, точный head и очередь:
единственный открытый PR —2124. PR2124 MERGED16.11 в01:20:39МСК, squash
`5ff8ff6d93a0316929030332113c14233d11f8a1`, readbackGitHub подтверждён.
Порядок владельца2126→2124 выполнен. Далее начинается аудит оставшегося кода
на общей main5ff8ff6d; собственная рабочая копия переиспользована. Отдельный
production deploy не выполнялся и его результат не заявляется.

## Итерация 6 — аудит после обоих слияний — 16.11.2026

База: `5ff8ff6d93a0316929030332113c14233d11f8a1`, уже включает PR2126 и
PR2124. Рабочая копия переиспользована, ветка `chore/remaining-code-audit-20261116`.
Это результат проверки: новых удалений, изменений runtime и нового PR нет.
Проверены non-UI клиентские модули, серверные helpers, операторские инструменты,
генераторы и runtime-зависимости. Fit16, экраны и CSS исключены из чистки.

### Следующий безопасный пакет: 15 деклараций

Строки ниже относятся к указанной базе. Поиск учитывал tracked imports,
namespace/dynamic обращения, тесты, scripts/config/workflow и ручные entrypoints.
Для серверных кандидатов дополнительно проверена идентичность TypeScript symbols:
одноимённые функции в разных модулях не считаются одним потребителем.

| Область | Кандидаты | Доказательство и границы удаления |
| --- | --- | --- |
| `services/api/src/assistant-orchestrator/core.ts:22,31,35` | `SummaryPeriod`, `HttpError`, `required` — 3 | `required` не вызывается, локальный `HttpError` нужен только ему; private type нужен только старому parser ниже. |
| Тот же файл, `:222,443` | `isSummaryRequest`, `summaryPeriodFromMessage` — 2 | После удаления `summaryTurn` остались только два assertions в `core.test.ts:126–127`. Общий `normalizeAssistantMessage` и `usesInformalAddress` с его assertions `:128–129` сохранить. |
| `services/api/src/training-summary-core.ts:24,67,261,301,307` | `MAX_SOURCE_ROWS`, `ProgressRow`, `fingerprint`, `addUtcDays`, `inclusivePeriodDays` — 5 | Нет импортов/вызовов, включая тесты. Одноимённые действующие расчёты в `training-summary.ts` — другие декларации, их не менять. |
| `services/api/src/yandex-db-function-runtime.ts:5` | `yandexAiAuthorization` — 1 | Wrapper не вызывается; consumers модуля используют `actorSession`. Убрать можно wrapper и два ставших ненужными imports. Настоящие provider-классы, `buildYandexAiAuthorization` и `actorSession` сохранить. |
| `src/shared/vital-gym-pro.generated.ts:13053,17575,17594` | `VITAL_GYM_PRO_LEGACY_ROOT_BY_REF`, `VITAL_GYM_PRO_EXCLUDED_PUBLIC_IDS`, `VITAL_GYM_PRO_REFS` — 3 | Есть только объявления и emitter `scripts/import-vital-gym-pro.mjs:202,207,208`; consumers не найдены. Убирать вместе с emitter и вычислением `legacyRoots:190`, иначе генератор вернёт их. Объём generated-объявлений: 261 строка / 13 420 байт исходника; выигрыш размера сборки не измерен. |
| `scripts/frontend-release.mjs:72–81` | `planRelease` — 1 | Только собственный тест и исторический rehearsal-документ. CLI вызывает `packageRelease`, действующий upload использует `gatewayPlan`. Сохранить identity assertions `frontend-release.test.mjs:158–162`; проверки prefix/overwrite/checksum/immutable collision уже есть у действующих upload/gateway. |

Удаление не требует изменения работающих AI prompts, моделей, парсинга,
подбора упражнений, структуры ответов, сохранения, auth/RLS или флагов.
Новые механики и диагностика в пакет не входят. При реализации: подтвердить
неизменность сохраняемых деклараций/данных, выполнить положенную приёмку нового
head; текущий аудит сам по себе не является проверкой будущего изменения.

### Что сохраняется и почему

- `VITAL_GYM_PRO_ASSETS` и исходный каталог с исключениями, alias/media mappings:
  нужны действующим данным и проверке комплектности 670 упражнений / 2010 медиа.
  Удаление трёх лишних generated exports не разрешает менять состав каталога.
- `suggestGoalCriteria` в `src/data/queries/workout-ai.queries.ts:31` найден как
  отдельный tests-only кандидат, но относится к целям/Fit16. В пакет не включён:
  живой экран вызывает repository method с другим endpoint, полезные assertions
  потребуют отдельной сверки в этой области.
- Recovery/private-program/migration helpers и старый SpeechKit relay сохраняют
  операторские или package/workflow entrypoints. Целых безопасно удаляемых orphan
  модулей в проверенной области не подтверждено.
- `workoutHomeSummaries`, `computeClientStats`, reviewed-media inventory и reset
  diagnostics нужны действующим fixtures и изоляции тестов. `src/test/setup.ts`
  включён конфигурацией Vite. Отсутствие runtime-импорта не означает ненужность.
- Проверены 32 runtime-зависимости в четырёх manifests: подтверждённо лишних не
  найдено. `@capacitor/ios` используется установленным Capacitor CLI при sync;
  отсутствие JS-импорта не позволяет удалить платформу. Onest импортируется в
  `src/main.tsx` и используется e2e fixtures; шрифты не входят в эту чистку.
- Public URL assets, старые версии иконок, aliases и verification HTML не
  объявляются мусором по отсутствию JS-импорта. Генератор иконок/его тесты
  поддерживают aliases, существующий install-контракт сохраняет старые версии;
  внешние потребители verification HTML этим аудитом не проверялись.

Проверка read-only для приложения: новый source не менялся, тесты/CI повторно
не запускались. В рабочей копии обновлён только этот журнал; предсуществующий
`scripts/__pycache__/` не включён в изменения. Известная проблема diagnostic
SELECT в `DatabasePilotTrainingSummaries.diagnose` остаётся отдельным дефектом,
а не поводом менять работающие AI-механики в рамках удаления лишнего кода.

## Итерация 7 — удаление 15 подтверждённых остатков — 16.11.2026 — Codex / OpenAI

Задача: Антон разрешил удалить все 15 кандидатов итерации 6, сохранить рабочие
сценарии/AI-механики, исключить Fit16, создать отдельный draft PR и запустить
проверки. Следующим сообщением разрешил сразу слить после завершения и успешной
приёмки; прежний запрет слияния нового PR снят. Расхождений нет. База `5ff8ff6d`
свежая, перед началом GitHub-очередь открытых PR пуста. Рабочая копия прежняя.

Сделано: удалены ровно 11 серверных деклараций, 3 неиспользуемых generated
exports каталога и `planRelease`. Генератор больше не производит удалённые
exports; вычисление `legacyRoots` снято. Остальные данные каталога, исходные
исключения/медиа и работающий выпуск сохранены. Новых зависимостей нет.

| ID | Удалено / сохранено | Проверка до полного прогона |
| --- | --- | --- |
| UC701 | 11 серверных деклараций; prompts/models/парсинг/выбор/сохранение/auth/RLS прежние | 88 сохраняемых top-level деклараций в трёх production-файлах побайтно неизменны по AST; 77 тестов в 6 целевых наборах PASS, ESLint 4 файлов PASS. |
| UC702 | 3 generated exports, их emitter и вычисление `legacyRoots` | Все 7 остальных generated-деклараций побайтно прежние; изолированное вычисление строкового emitter точно даёт файл, без запуска media/IO-генератора. `node --check` PASS. |
| UC703 | Только заглушка `planRelease` и её собственные assertions | 15/15 release tests PASS. Первый запуск был заблокирован запретом loopback-порта; повтор с разрешённым локальным сервером PASS, без изменений тестов/гейтов. |

Карта сохранности assertions:

- `core.test.ts`: сняты только `isSummaryRequest` и `summaryPeriodFromMessage`;
  общий case переименован и сохраняет обе проверки `usesInformalAddress`.
  Assertions 105 → 103, число cases прежнее. Это проверки удалённого parser;
  текущий выбор периода в frontend и расчёты `training-summary.ts` не менялись.
- `frontend-release.test.mjs`: сняты assertions `planRelease`; равенство
  идентичности для одинаковых байтов и её смена для других байтов сохранены.
  Действующие uploader/gateway по-прежнему проверяют prefix, повтор без
  перезаписи, отказ доступа, checksum, `deployable:false` и immutable collision.
  Исходные assets/Fit16 assertions в начале файла не менялись.

Решение: узкое удаление доказанных остатков, без изменения сохраняемого кода.
Отвергнуто: чистка соседних goals/Fit16, recovery/migration/compatibility,
изменение механик AI и исправление отдельного diagnostic SELECT дефекта —
вне согласованного пакета. Генератор с файловым/медиа IO не запускался.

Полный локальный `npm run check` запущен; его итог и CI ещё не заявлены.
Обязательный scope включает frontend/shared: полноценные frontend/browser
и API/DB gates сохраняются. Production/реальный AI не вызываются локально.
Перед merge требуется зелёный текущий head, свежий main и проверка очереди.

Опубликован [draft PR2127](https://github.com/podkolzinpd/fit/pull/2127), head
`d10303e44255055bd6100ca25b6bb9d3b4c9f473`. Классификатор по точным SHA
подтвердил `frontendRequired=true` / `browserRequired=true`; первоначальный
вызов с literal HEAD вместо SHA дал консервативный полный scope, не skip.
CI43813597656 и Android43813597819 наблюдаются одним процессом с паузой 90s.
Независимый review: 0 blockers; 131 сохраняемая production-декларация побайтно
прежняя, кроме целевого удаления трёх фрагментов строкового emitter. Его девять
оставшихся фрагментов и все top-level executable statements прежние. Скан
imports 1615 файлов не нашёл consumers удалённых named exports; два namespace
импорта используют сохраняемые функции. Побочные IO/регистрации не удалены.

Первый полный local check: `20261116-085511-7991f4c5`, lint/types PASS, затем
3196/3200 frontend tests PASS и 4 timeout по прежнему лимиту 5000ms:
DutyStatistics (конфликт/загрузка записи), ServicesPage (черновой период),
два ExercisePicker (retired/search/дубли). Замер после прогона: load averages
27.60/24.37/13.99; связь с нагрузкой была предположением, не доказанным дефектом
приложения. Тесты, лимиты и код не менялись. Для новой причины — этих падений —
полный coverage повторён с `--maxWorkers=2`, затем выполнены все оставшиеся
шаги check; уже прошедшие lint/types повторно не запускались.

Продолжение `20261116-090020-74297b9f` завершено exit 0: 3200 frontend /
1636 API tests PASS, 479 условных API/DB skips локально; coverage 83,18%
statements / 78,18% branches. Все четыре прежних timeout cases прошли,
ios/media/infra/calendar/hosting policies, API lint/types/build и frontend
build/startup PASS. Вместе с первым lint/types полный локальный набор check
закрыт. Обе квитанции закреплены. Обязательная PostgreSQL/browser приёмка CI
ещё выполняется; локальные skips не выданы за DB PASS.

Сравнение 28 записей Vite output с принятой предыдущей сборкой PR2124:
главный JS 4522,36 → 4505,99 kB (gzip 1049,32 → 1046,22 kB), CSS и media
hashes прежние; зависимые JS chunk hashes изменились. Это сравнение вывода
локальных сборок, не замер пользовательской производительности и не полное
побайтовое сравнение dist. Эта квитанция добавлена после публикации и не меняет
проверяемый head PR.

Итог PR2127: CI43813597656 — 35 SUCCESS; Android43813597819 — assemble
SUCCESS / штатный auth-smoke SKIPPED. Всего 36 SUCCESS / 1 SKIPPED, оба
attempt 1, без rerun; полный API/PostgreSQL/Chromium/WebKit/visual/Lime/native
auth/nutrition набор пройден. Квитанция `20261116-085902-a14ac96f` закреплена,
единственный watcher завершён exit 0. Итоговая приёмка опубликована в PR body;
`check-workflow-docs --pr-body` и whitespace check PASS.

Перед merge свежий main оставался `5ff8ff6d`, он является ancestor принятого
head `d10303e44255055bd6100ca25b6bb9d3b4c9f473`; единственный открытый PR —
2127, CLEAN/MERGEABLE. После разрешённого ready выполнен squash с защитой
`--match-head-commit`. GitHub подтвердил **MERGED 16.11.2026 в 09:46:53 МСК**,
коммит `656ca0cf9e5be18de7054588a42f3ee2f1040bb8`.
Все 15 кандидатов удалены, рабочих механик/Fit16 пакет не меняет. Отдельный
production deploy и физические устройства не проверялись; merge не выдаётся
за подтверждение доставки. Новых изменений или ожидающих проверок этого пакета нет.

## Итерация 8 — отключённый lint plugin и лишние reexports — 16.11.2026 — Codex / OpenAI

Задача: следующий безопасный пакет после PR2127; сохранить рабочие сценарии
и механики AI, исключить Fit16. База `656ca0cf`, правила репозитория с предыдущего
пакета не менялись. Рабочая копия переиспользована, ветка
`chore/safe-unused-code-followup-20261116`. Расхождений нет.

Новый аудит: 121 feature-local helper/hook/adaptor и 492 exports достижимы из
приложения; новых безопасных удалений здесь нет. Серверный проход учёл 1615
tracked JS/TS-файлов и 5768 деклараций, включая типы, shorthand, overloads,
namespace/dynamic/deploy/manual entrypoints. Проверены также 116 служебных
JS/MJS-файлов, 5 Python-скриптов и 29 devDependency-записей в двух manifests.
Возраст, размер файла и использование только тестами не считались доказательством.

| ID | Изменение | Доказательство / что сохраняется |
| --- | --- | --- |
| UC801 | Удалён `eslint-plugin-react-refresh` из config/devDependencies/lock | Его единственное правило было `off`, processors нет; других consumers/dependents нет. Все остальные effective rules/plugins/settings в четырёх представительных scopes после удаления совпадают; независимая модель пяти scopes подтвердила также parser/linter options. Рабочий `@vitejs/plugin-react` и браузерный HMR не менялись. JSON-сравнение manifest/lock подтвердило только целевое удаление, без смены других версий. |
| UC802 | Удалены type-reexports `NutritionPilot` из `nutrition-diary.ts` и `ProgramSourceSnapshot` из `program/turn.ts` | Consumers обращаются к исходным модулям; исходные типы, локальные imports, constructors и все применения сохранены. |
| UC803 | Удалён reexport `readAssistantTurnRequest` из assistant core и лишний import | Production `app.ts` уже читает parser напрямую; только `core.test.ts` использовал обходной путь. В тесте изменён источник импорта, все 23 cases и 103 assertions побайтно прежние, включая valid/invalid request. |

AST-сверка API: все 86 остальных top-level узлов в затронутых файлах побайтно
сохранены. Целевые core/nutrition/turn — 84 tests PASS; whitespace PASS.
Ни один assertion не удалён, новый тест ради зеркалирования удаления не добавлен.
Исходники parser, AI prompts/models/выбор/сохранение/auth/RLS не менялись.

Решение: пакет ограничен одним отключённым инструментом разработки и тремя
лишними путями импорта. Отвергнуто расширение на действующие операторские
entrypoints, восстановление, migration/compatibility, `exerciseSearchConflicts`,
Progress/goals/Fit16. `@testing-library/dom` нужен как peer тестового React,
`@types/*` и coverage provider используются инструментами неявно — сохранены.
Дополнительный `noUnusedLocals/noUnusedParameters` проход frontend показал только
неиспользуемое имя callback-параметра в achievements test; этот косметический
остаток не включён в пакет и не означает неработающий сценарий.

Полный локальный набор `check` запущен с `--maxWorkers=2` только у coverage,
учитывая подтверждённые таймауты при высокой параллельности прошлого пакета.
Состав, timeout, assertions и thresholds прежние. Изменение root manifests/config
требует полного CI; пропуски frontend/browser/native не назначаются вручную.
Итог полного прогона и CI пока не заявлены. Следующий шаг — завершить приёмку
и подготовить отдельный draft PR с проверенной версией и результатами.

Опубликован [draft PR2128](https://github.com/podkolzinpd/fit/pull/2128), head
`25a0d75b3894678f0de50af1a2ce7e8d44218fba`. Автоматический scope по точным
SHA подтвердил полный frontend/browser набор. CI43820661765 и Android43820661444
запущены; один watcher с паузой 90s, без наблюдения за чужими чатами/CI.

Локальный полный набор check прошёл с первого прогона, exit 0, квитанция
`20261116-095633-abc85c41` закреплена: 3200 frontend / 1636 API tests PASS,
479 условных API/DB skips; coverage 83,18% statements / 78,18% branches.
Lint/types, ios/media/infra/calendar/hosting policies, API/frontend build и
startup PASS. Отдельные CI/PostgreSQL/browser проверки ещё выполняются.
Независимый общий review: 0 blockers, 83 сохраняемых API-объявления и тела
тестов побайтно прежние; остальные 86 top-level узлов включают также imports.
UI/assets/e2e/Fit16 не менялись, лишних lock-изменений нет.
Квитанция добавлена после публикации без изменения проверяемого head.

Итог PR2128: CI43820661765 — 35 SUCCESS; Android43820661444 — assemble
SUCCESS / штатный auth-smoke SKIPPED, всего 36 SUCCESS / 1 SKIPPED, оба
attempt 1, без rerun. Полный API/PostgreSQL/Chromium/WebKit/visual/Lime/native
auth/nutrition набор пройден; watcher exit 0, квитанция
`20261116-100103-6d9e7e75` закреплена. PR body обновлён полной приёмкой;
workflow-docs acceptance check и whitespace PASS.

Продолжен ранее разрешённый владельцем цикл «сразу сливать, как всё сделаешь»;
это применение разрешения к следующему согласованному безопасному пакету было
обозначено в чате до слияния. Перед merge: свежий main `656ca0cf` — ancestor
проверенного head `25a0d75b3894678f0de50af1a2ce7e8d44218fba`; других открытых
PR нет, CLEAN/MERGEABLE. После ready выполнен squash с `--match-head-commit`.
GitHub подтвердил **MERGED 16.11.2026 в 10:40:00 МСК**, коммит
`26178971a1adb1397fcff12196fb608672419472`. Отдельный production deploy и
физические устройства не проверялись; слияние не выдаётся за доставку.

Уточнение результата `noUnusedParameters`: callback-параметр `value` в
`athlete-achievements.test.ts:246` сохраняет позицию используемого второго
аргумента `index`. Это не кандидат на удаление аргумента; возможное изменение
только его имени косметическое и не входит в пакет. Других крупных безопасно
удаляемых блоков в проверенной non-UI/ops области этот проход не подтвердил.

## Итерация 9 — лишняя внешняя видимость внутренних объявлений — 16.11.2026 — Codex / OpenAI

Задача: вычистить мелкие точно неиспользуемые остатки после PR2128, сохранив
рабочие сценарии/AI и не пересечься с Fit16. База `26178971`, инструкции с
прошлого пакета не менялись; та же рабочая копия, новая собственная ветка
`chore/small-unused-surface-20261116`. Локальные финальные квитанции PR2128
сохранены и входят в журнал. Расхождений нет.

Выбран узкий вид чистки: 34 объявления реально нужны внутри своих модулей,
но внешний `export` никем не используется. Сняты только эти модификаторы;
сами функции, типы, значения, схемы и все assertions оставлены. Это сокращение
лишнего внешнего интерфейса модулей, а не удаление 34 функций или обещание
меньшей сборки. Проект/API private, SDK export-map отсутствует.

| ID | Область и изменения | Сохранность |
| --- | --- | --- |
| UC901 | 15 exports в 10 non-UI клиентских файлах: client-finance, yandex-main queries, collect-pages, notification storage/reconcile, nutrition free-text, corporate-duties, meeting, nutrition, trainer-profile | 11 вложенных типов, 3 внутренних Zod-схемы и ключ onboarding теперь локальные. Существующие публичные функции/схемы и consumers прежние; 81 top-level узел совпадает после снятия выбранных modifiers. |
| UC902 | 15 exports в 5 API файлах: pilot-chat (7 типов), nutrition-diary (4 типа), chat-media (лимит), trainer-profile-media (лимит и вложенный тип), trainer-finance-request (внутренний helper) | Все 77 узлов сохранены. Вставка обратно 15 префиксов `export ` побайтно восстанавливает исходные файлы. PilotChat/ChatMessage, NutritionDraft, media/upload contracts и рабочие entrypoints прежние. |
| UC903 | 4 exports в 3 scripts: `referencedObjects`, `VITAL_GYM_PRO_MEDIA_MAX_FILE_BYTES`, `expectedVitalGymProMediaPaths`, `ClientWorkoutProfilesNotReadyError` | Внутренние вызовы, лимит и точные media paths, readiness/fail-closed, rollback/manifest guards прежние. Тесты продолжают вызывать публичные planCleanup/validator/resolver; прочие байты файлов совпадают с базой. |

Frontend-имена: `ClientFinancePayment`, `YandexMainHttpMethod`, `Page`,
`onboardingSeenStorageKey`, `PushSubscriptionServerAdapter`, `ParsedFoodLine`,
`CorporateDutyCounts`, `MeetingState`, `MeetingCredentials`, `MeetingAction`,
`nutritionValuesSchema`, `NutritionMeal`, `NutritionSelection`,
`trainerProfilePhotoSchema`, `trainerCatalogItemSchema`.
API-имена: `ChatThread`, `ChatBlockState`, `ChatConnectionState`, `ChatStoredImage`,
`ChatReplyPreview`, `ChatUnreadState`, `ChatCursor`, `Meal`, `FoodBasis`,
`FoodSelection`, `NutritionEntry`, `CHAT_IMAGE_MAX_BYTES`,
`TRAINER_PHOTO_THUMBNAIL_MAX_BYTES`, `TrainerPhotoUploadPart`,
`readTrainerFinanceSingleService`.

Проверка потребителей учитывала 1615 tracked JS/TS-файлов, named/namespace
imports, reexports, dynamic import/require, import-типы, tests/e2e/scripts,
workflow/deploy/manual обращения и одноимённые независимые декларации.
Frontend проверил 49 imports в выбранные модули; API — 938 exports.
Неиспользуемых локальных imports/bindings в 89 допустимых служебных MJS нет.
E2E noUnused-проход показал только позиционный `exercise` перед используемым
`position` в workout-copy-names fixture; аргумент нужен для позиции и сохранён.

Отвергнуто: удалять работающие объявления вместо их лишней видимости,
переписывать signatures/values, сокращать tests, включать Progress/goals/UI/CSS
или Fit16. `readbackOta` сохранён: docs подтверждают ручные обращения именно
к экспорту. Recovery/legacy/CLI entrypoints и известные нужные test helpers
остаются. AI prompts/models/parser/подбор/сохранение/доступ не менялись.

Whitespace check PASS. Полный check с двумя coverage workers выполняется;
состав и таймауты прежние. Ни успешный полный прогон, ни CI пока не заявлены.
Далее — отдельный PR, полная приёмка и слияние в ранее согласованном порядке
после проверки актуального main/head и GitHub-очереди.

Опубликован [draft PR2130](https://github.com/podkolzinpd/fit/pull/2130), head
`33989dd33a85bfffec468bb052eb97c12ffaaaf5`. Exact-SHA scope требует полного
frontend/browser набора; CI43830625621 / Android43830624880 запущены.
Независимый review: 0 blockers, весь source diff — ровно 34 снятых `export `,
остальные байты 18 файлов прежние. Проверены 80 imports этих модулей;
единственный dynamic import использует сохранённый `readChatImageUpload`.

Полный local check на базе `26178971` прошёл с первого прогона, exit 0,
квитанция `20261116-111838-a5e11cfa` закреплена: 3200 frontend / 1636 API
tests PASS, 479 conditional API/DB skips; coverage 83,18% statements / 78,18%
branches. Lint/types/policies, API/frontend build и startup PASS. Все 28 строк
Vite output (имена/hash/размеры) совпадают с принятой сборкой PR2128; это не
отдельный побайтовый snapshot всего dist и не проверка физических устройств.

В GitHub перед нашим пакетом открыт более ранний PR2129 MC5.7, head `5e62afbb`.
Он проходит первым; чужой PR не сливается и не объявляется неактивным по возрасту.
Свой CI наблюдается одним процессом с паузой 90s, только необходимое состояние
merge PR2129 — тем же ограниченным процессом не чаще 5 минут. Другие чаты,
их задачи и результаты не читаются. После его merge требуется обновление
нашего head от фактического main и приёмка совместной версии, без своих правок
Fit16. Текущие команды/CI не прерываются; результат текущего CI ещё не заявлен.

CI attempt 1: `frontend-infrastructure`, job133174976709, упал на скачивании
официального Terraform provider (`prepare-official-ci-tools.mjs:86`), HTTP 403
от GitHub release asset API. До terraform validate шага прогон не дошёл.
Этот script и workflow побайтно прежние относительно базы; причина текущего
падения — недоступность загрузки, а не assertion изменённого приложения.
Причина самого отказа 403 и его временность по имеющемуся логу не установлены.
Сохранён job log в `20261116-112357-b3621ea1/frontend-infrastructure.log`.
Остальные jobs не прерываются. После завершения — повтор только упавшей части
при прежнем head либо обязательный новый CI совместной версии после merge2129;
защитные проверки/источники/контрольные суммы не ослабляются.

Итог текущей приёмки: первый CI завершился 33 SUCCESS / 2 FAILURE (infra и
зависимый app gate). Выполнен `gh run rerun --failed` только для этих двух jobs;
attempt 2 снова завершился тем же HTTP403 в job133192302394, затем отказом
`Verify app checks`. Все 33 успешных CI jobs сохранились без повторного запуска;
Android attempt 1 — assemble SUCCESS / штатный auth-smoke SKIPPED. GitHub
rollup текущего head: **34 SUCCESS / 2 FAILURE / 1 SKIPPED**, не полный PASS.
Оба watcher завершены, активных фоновых проверок нет. Квитанции
`20261116-112357-b3621ea1` и `20261116-120054-e4800f5a` закреплены; второй
job log сохранён в последней папке как `frontend-infrastructure.log`.

Проверка того же официального URL вне CI получила HTTP200; архив не скачивался,
подписанные query-параметры не выводились. Это подтверждает доступность с
локального маршрута, но не объясняет повторяющийся отказ внутри GitHub runner.
Независимый read-only разбор не нашёл штатной альтернативы: workflow всегда
выполняет pre-download, cache restore и inputs нет, CLI принимает только mode
и pluginRoot; Terraform mirror применяется позднее. Версии, source URL, hashes,
авторизация и CI не менялись. Третий повтор без новой причины не запускался.

Checkpoint: PR2130 остаётся OPEN/DRAFT на `33989dd3`, main по-прежнему `26178971`.
Более ранний PR2129 открыт, его head продвинулся с `5e62afbb` на `695a4be4`;
оснований считать его неактивным нет. Слияние2130 не выполнялось: мешают
обязательный infra gate и очередь. Продолжение — восстановление штатной загрузки
в CI либо отдельное согласованное инфраструктурное исправление; после merge2129
включить фактический main в свою ветку, проверить неизменность 34 точечных
правок и получить зелёную приёмку нового head. Собственный scope/Fit16 не расширять.
Итоги и блокеры опубликованы в PR body; локальный журнал не меняет проверенный
source head. Пакет подготовлен, слияние и delivery не объявлены завершёнными.


### Продолжение UC904 — 16.11.2026 — Codex / OpenAI

Антон явно поручил разобраться с ошибкой CI и слить PR2130 после PR2129,
когда все обязательные проверки пройдут. Это разрешение распространяется
на необходимое исправление загрузчика CI, без изменения версий инструментов,
проверок целостности, продуктовых механик и границ Fit16.

Read-only проверка exact API URL и URL с уникальным query дала локально
302 → 200; оба редиректа ещё действовали, GitHub rate limit remaining 58/57.
Это не устанавливает причину отказа в runner. Существующий лог теряет
источник HTTP403, поэтому следующий шаг — ограниченная безопасная
классификация отказа в самом загрузчике и проверка в CI. Сырые тела ответов,
токены и подписанные URL не печатаются. Авторизация, зеркала, retry и pins
на этом шаге не меняются; предположительный fix без подтверждения отвергнут.

Открыто: установить конкретную причину на runner, затем исправить её,
дождаться merge2129, включить актуальный main и принять окончательный head.

Диагностический патч: приватный helper сообщает конечный hostname, числовые
rate-limit headers и фиксированную категорию. Error body читается не более
4096 байт/1 секунды; raw body/query/signature не выводятся. Happy path и
контроль целостности прежние. 24/24 targeted downloader tests и 51/51
CI/scope tests PASS, workflow-docs/node syntax/diff checks PASS. Старые
продуктовые тесты не менялись; полный CI следующего head ещё не завершён.

CI43839811634 на `15491136`, job frontend-infrastructure, 16.11.2026
09:27:35UTC подтвердил точную причину: `HTTP403; host=api.github.com;
x-ratelimit-remaining=0; x-ratelimit-reset=1794823160; reason=api_rate_limit`.
Исчерпан лимит анонимного GitHub API на runner; гипотезы об истёкшей CDN
подписи/недоступном архиве не подтвердились. Повтор прежнего анонимного
запроса и локальный200 проблему не исправляют.

Выбран штатный GITHUB_TOKEN текущего Actions job с прежним contents:read,
только в шагах скачивания инструментов и только для HTTPS api.github.com.
Новые секреты, права, внешние зеркала, версии и pins не нужны. Неавторизованный
локальный путь остаётся доступен; неизвестные отказы и ошибки size/SHA256
по-прежнему прерывают проверку. Временный body-reader/таймер/классификатор
после установления причины удаляются, остаётся краткий HTTP-контекст.
Новые тесты проверяют адресата Authorization и сохранение error redaction;
продуктовые assertions не меняются. Текущий CI не отменяется; следующая
публикация только после его завершения.

Полный local check завершился exit0, квитанция `20261116-122748-a1e7da63`
закреплена; запуск начат на15491136, продуктовые исходники весь прогон
оставались прежними. Финальный token/downloader патч проверен отдельно:
24/24 downloader tests; 46/46 CI/OTA contract tests, docs/diff checks PASS.
Текущий own CI/watch receipt `20261116-122822-4b925125` закреплён и содержит
лог подтверждённой причины403; его завершение ещё ожидается.

Независимое review финального исправления: blockers0. Auth ограничен
HTTPS GitHub asset API без URL credentials; redirect safety обеспечивается
штатным Fetch, который снимает Authorization при смене origin. Все4consumer
получают token только на нужном шаге, permissions/гейты прежние. AST/byte
сверка18sourcefiles: ровно34export modifiers к26178971, остальные байты
прежние; эти18файлов побайтно совпадают с33989dd3. Fit16/UI не затронуты.

Диагностический CI43839811634 завершён:33SUCCESS/2FAILURE, Android
43839811620:1SUCCESS/1штатныйSKIPPED. Два отказа — download и зависимыйapp;
остальные сценарии PASS. После завершения всех jobs опубликован final fix
`c25dc486a965aa24bc5616a95aaeac3c3fe2459b`, CI43847859621/Android43847859839.
Base по свежему fetch всё ещё26178971; PR2129 активен, headb782910b.

Новый infra job16.11.2026 10:20:52UTC завершился другим отказом:
`TypeError: terminated`, cause `read ECONNRESET`, во время получения архива.
Нового HTTP403/rate-limit сообщения нет. Лог сохранён в
`20261116-132021-2dd1ede8/frontend-infrastructure.log`. Этот единичный
transport failure не подтверждает регрессию авторизации и пока не является
основанием добавлять downloader retry/framework. После завершения текущего
CI — один failed-only retry либо приёмка нового head после merge2129.
Гейты/integrity не ослабляются, частичный архив не признаётся успешным.

PR2129 слит16.11.2026 10:39:19UTC, main `80f9006c41e34fa8245abc5442edda1ce8c32bc8`.
Включён обычным merge без конфликтов; новых требований в инструкциях нет,
CURRENT_STATE изменил только статус MC5.7. Все16входящих файлов Fit16
приняты изmain без собственных правок. Исходные18cleanupfiles с ними
не пересекаются. Старый c25 CI продолжает выполняться; повтор его failed
job не нужен, следующий прогон будет на совместном head. Канонический
урок GitHub API rate limit добавлен в REGRESSION_LESSONS отдельно от Fit16.
Дальше — полный localcheck с логом и полный CI нового head, затем merge2130
при зелёных гейтах и повторной сверке актуальногоmain.

Совместный head244619c7, base80f9006c: полный localcheck exit0, закреплённая
квитанция `20261116-134917-ef383b2a`, полный `check.log` содержит точныйHEAD.
3210frontend/1636API PASS,479условныхAPI/DBskips;24downloader tests PASS;
coverage81,88%statements/77%branches, прежние thresholds. Lint/types/policies,
API/frontendbuild/startup/docs/diff PASS. Независимое review: blockers0,
34export modifiers/18files,0внешнихпотребителей поsymbol-resolution на
объединённомHEAD; все5CI-authfiles побайтно равныc25dc486, Fit16/UI overrides
отсутствуют. Дальнейшее изменение этой записи не меняет проверенные source
файлы; обязательный CI всё равно проверит окончательный опубликованныйHEAD.

Старый c25 CI43847859621 завершён31SUCCESS/4FAILURE: infraECONNRESET,
зависимыйapp, e2e-yandex-auth1/4 и зависимыйe2e. Browser shard:487passed,
1failed — Editor Lime skin ownership trainer-dark-390-clarify-true-false,
30s timeout вlime-editor-skin.probe.ts73/126 на трёх попытках. Этот probe
и productbuild не менялись нашимc25 CI-authfix; исходная чистка раньше
проходила данныйнабор. Причина timing failure не доказана; он не объявляется
успехом/безусловноflaky. Fit16probe/timeout/assertions не меняются, приёмка
обновлённойbase80f9006c остаётся обязательной. Oldheadretry не выполняется
после сменыmain; старые watcher/tests полностью завершены.

Окончательный head `e1e167d12ca03d1e7b4744e50fa292125d57225c` принят в CI
с первой попытки: CI43855556995 —35SUCCESS; Android43855557013 —assemble
SUCCESS/auth-smoke штатныйSKIPPED. Infra download/init/validate/test PASS;
предыдущий Editor timeout в полном наборе новогоhead не повторился.
Ни testcase, ни30s timeout, ни обязательные гейты не ослаблены. Receipt
`20261116-141226-10069540` закреплён, watcher завершёнexit0; активных
фоновых проверок этой задачи нет. Перед merge — свежийmain/очередь/HEAD guard.

PR2130 MERGED16.11.2026 12:09:16UTC (15:09:16МСК), squash
`f6fe8662648952a24831229bea8b8ba533ec1ad8`, послеPR2129. Перед merge
origin/main80f9006c был ancestor принятогоe1e167d1; в очереди не было
более ранних открытыхPR, rollup36SUCCESS/1штатныйSKIPPED, pending/failures0,
mergeStateCLEAN. PR переведён изdraft и слит с match-head guard, безadmin/force.
Readback подтвердил MERGED/mergeCommit; tree принятогоe1e167d1 побайтно равен
squashf6fe8662. ПриёмочныйPR body прошёл структурнуюпроверку.
Слияние завершено, отдельный production deploy не выполнялся. Эти
post-acceptance receipts остаются локальной записью журнала, не новым
source head; дополнительныйCI ради записи не запускается.


## Итерация 10 — внутренние типы и тестовый helper — 16.11.2026 — Codex / OpenAI

Задача: следующий безопасный пакет, только доказанно неиспользуемое, без
изменения рабочих сценариев/AI и без пересечения с Fit16. База `f6fe8662`
(PR2130 MERGED), та же рабочая копия, ветка `chore/unused-internal-code-20261116`.
Расхождений нет. Финальные квитанции предыдущего пакета сохранены выше.

| ID | Изменение | Доказательство и сохранность |
| --- | --- | --- |
| UC1001 | Сняты 11 лишних export у внутренних типов в шести feature-модулях: OAuth (3), exercise-search (2), vitalMedia (2), app-install (1), analytics-model (2), speechkit-streaming-recognizer (1) | Прямых внешних ссылок на имена нет; функции, сигнатуры, значения, возвращаемые структуры, validators, storage и тесты прежние. Скомпилированный JS каждого модуля побайтно совпадает с базой. |
| UC1002 | Снят export у fixtureUuid в e2e/native-workout-fixture.ts | Внешних потребителей нет; все внутренние вызовы сохранены. Другие байты helper и все сценарии/ожидания тестов прежние. |
| UC1003 | Удалено поле trainer_id из приватного CustomExerciseRow в services/api/src/training-data.ts | Единственное применение — query с явным SELECT без этого поля. Mapper не читает его, владельца берёт из created_by. SQL, БД, WorkoutRow.trainer_id, ответ API, auth/RLS не менялись. Скомпилированный JS побайтно совпадает с базой. |

Имена типов UC1001: YandexAuthorizationIntent, PendingYandexNativeRegistration,
YandexAuthorizationCode, RankedExerciseMatch, ExerciseSearchConflict,
VitalMediaStatus, VitalMediaState, BeforeInstallPromptEvent, AnalyticsResult,
AnalyticsCard, StreamingSpeechResult. Это сокращение внешней видимости,
а не удаление работающих функций или измеренное уменьшение сборки.

Дополнительный аудит: 195 API source-модулей без unused-local диагностик;
155 служебных MJS вне CI/workflow/Fit16 (включая 61 тестовый файл) без unused
locals/imports/private members/labels и unreachable; в 17 Python infra/scripts
не найдены неиспользуемые imports. Среди 50 проверенных non-lime/non-progress
экспортов e2e только fixtureUuid не имел внешнего потребителя.

Сохранены cache url/promise/expiresAt и actorId/id для инвалидизации,
дедупликации и повторов; рабочие дубли mapConcurrent/run, scripts/data,
manual/recovery/migration/SpeechKit entrypoints. Три ClientWorkoutHistory-типа
исключены по границе календаря/Fit16. Внутреннее OCR ImageInput.sizeBytes
не трогали: runtime-нормализация AI не входит в этот пакет.

Проверка до полного прогона: восстановление 12 export-префиксов и одного
поля побайтно возвращает восемь source-файлов к базе; emitted JS семи
production-файлов неизменен. Whitespace PASS. Новых тестов не добавляли,
существующие assertions/timeouts/thresholds сохранены. Полный прогон и CI
пока не заявлены. Дальше: независимый review потребителей, положенные
проверки фактического head, отдельный PR и приёмка по очереди GitHub.

Независимая проверка UC1001–UC1002: 1621 tracked JS/TS-файл, 38 обращений
к семи модулям; named/namespace/reexport/dynamic/manual потребителей выбранных
имён нет. Import-тип AnalyticsFilters в repository сохранён. Blockers: 0.
Классификатор на diff f6fe8662→2281e2d9 требует полный frontend/browser набор;
skip не применялся. Источники правил и main не изменились.
