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
