# Параллельная production-mode browser приёмка — 02.11.2026

## Задача и согласованный результат

Владелец: «Опять тесты долго работают», после диагностики — «давай улучшать это».
Первый этап: разделить длинный `e2e-yandex-auth`, сохранив весь набор.

- P1: четыре независимых части вместо одного последовательного задания.
- P2: те же spec, Chromium/WebKit, fixture flags, production build и assertions;
  объединение частей точно равно исходной коллекции, пересечений нет.
- P3: обязательный `e2e` ждёт всю matrix; failures не скрываются, прежние
  timeout/retries/один worker/`--fail-on-flaky-tests` сохраняются.
- P4: уникальные artifacts каждой части и безопасные тайминги успешных прогонов.

Не входит: удаление тестов, изменение продукта/пилотов/БД, новая skip-политика,
продление истёкшего Fit Lime scope или правка его защищённых spec/digest.

## Итерация 1 — 2026-11-02 — GPT / OpenAI

Задача: сократить последовательный критический путь CI без потери проверок.
База: main `0f5dbe7d930129198bdb35761c1b970214852df1`.
Расхождения: нет. Название auth историческое: job уже проверяет вход, питание,
client-workout-reference, coach-live-v79, quick-entry и attendance.

Исходный замер: [CI41468393763](https://github.com/podkolzinpd/fit/actions/runs/41468393763),
job125356490116 — 40m17s, browser step38m40s. Сам Playwright:
870 cases / один worker,862 passed+8 skipped за37,6m. Полный CI45m40s.
Это измерение конкретного прогона, не стабильный SLA. Параллельные PR/main
создают дополнительную очередь; установка зависимостей не объясняет37,6m тестов.

Сделано: `.github/workflows/ci.yml` добавляет native Playwright shards1/4…4/4,
`max-parallel:4`, `fail-fast:false`; каждый runner собирает тот же production
frontend и запускает один worker в прежнем pinned Playwright image.
Идентификатор job и required aggregate остаются прежними. Повторная подготовка
увеличивает суммарные runner minutes; очередь может ограничить ускорение.

Решение CI-PROD-SHARDS-20261102: переиспользовать стандартное Playwright
разбиение, а не копировать списки spec по отдельным jobs. Все четыре части
используют один список и оба прежних project. Существующий location-only
`fit-lime-timing-reporter.mjs` переиспользуется без изменения: историческое
имя JSON `lime-timings.json` сохраняется, artifacts имеют отдельный auth prefix.
В них нет titles, payload, errors, stdout или attachments; case ID/location,
duration/retry/status позволяют следующему аудиту опираться на фактуру.

Отвергнуто: просто увеличить workers на одном runner — конкуренция за CPU;
удалить браузер/сценарии или продлить временный skip — потеря покрытия либо
отмена отдельного решения. Дополнительные дубли пока не удаляются: development
и production-mode приёмка не тождественны.

Проверка: реальный `playwright --list --reporter=json` с теми же fixture-env
сравнил прежнюю команду с каждым shard по case identity/project. Результат:

| Коллекция | Chromium | WebKit | Всего |
| --- | ---: | ---: | ---: |
| До разбиения | 420 | 450 | 870 |
| 1/4 | 218 | 0 | 218 |
| 2/4 | 202 | 16 | 218 |
| 3/4 | 0 | 217 | 217 |
| 4/4 | 0 | 217 | 217 |

Union точно870/870, пересечения0. Новых browser cases0, удалённых0.
Mapping: каждый прежний case identity/project сохраняется ровно в одном shard;
spec/config/fixture-файлы byte-identical базе. Существующие browser skip
conditions остаются прежними; collection не выдаётся за выполнение тестов.

Один новый policy-test защищает matrix, передачу shard через реальный workflow
shell, уникальность artifacts и propagation ненулевого exit контейнера.
Существующие scope/gate тесты сохранены; целевые54/54 прошли.
Первый локальный inventory был остановлен из-за неполного разбора unquoted
fixture env в одноразовой диагностике; после исправления collection прошла,
продуктовые тесты/fixtures для этого не менялись.

Полный локальный `npm run check` завершился exit0: frontend2920/2920,
API1555passed+254 штатных localDBskip, infra379/379, SpeechKit7/7,
hosting196/196, calendar22/22, media2/2, lint/typecheck и обе сборки passed.
Workflow docs budgets/links/archive, PR acceptance structure, YAML/job
dependencies и diff-check passed. Runtime/spec/config и protected Lime
sources/reporting byte-identical базе. Первоначальный Ruby helper использовал
недоступный в системной версии safe_load_file; совместимый YAML parser прошёл.

Открыто: CI нового head; wall-time после разбиения пока не измерен. Локально
870 browser cases не исполнялись повторно: проверен реальный inventory;
выполнение полного набора проверяет новый CI. Четыре части равны по числу,
не гарантированно по длительности.
Дальше: один push/PR → полный CI и сравнение таймингов. Текущая CI-фактура
остаётся в связанном PR, без второго push только ради записи статуса.
Реальные production/БД/мобильные устройства не затрагиваются.
