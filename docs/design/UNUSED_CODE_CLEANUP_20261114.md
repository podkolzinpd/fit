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

## Кандидаты, которые сохранены

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
не доказательство безопасного удаления тестов:

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
