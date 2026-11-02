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

## Итерация 2 — 2026-11-02 — Codex / OpenAI

Задача: устранить конфликт [PR1947](https://github.com/podkolzinpd/fit/pull/1947)
после merge #1938. Включён main `c49f3a517b5384fb0b1f1be12097d52e6e86557f`
обычным merge, без rebase/force push. Единственный конфликт — две независимые
записи CURRENT_STATE; обе сохранены. Расхождений решений нет; продуктовый код,
SQL178 и browser fixtures взяты byte-identical main. Собственные CI/policy
файлы byte-identical предыдущему проверенному headfa56da4b.

Предыдущий полный CI41480136831 завершился success: все четыре production-mode
части прошли, длительности jobs8m19s/8m52s/12m36s/13m15s против исходного40m17s.
Это отдельные наблюдения, не контролируемый benchmark: очередь сдвинула старты,
общий span четырёх jobs был21m24s. Результат предыдущего head не является
зелёной приёмкой нового merge head.

Проверено после объединения: CI/scope54/54, YAML/matrix/dependencies,
docs budgets/links/archive и diff-check passed. Повторный реальный inventory
показывает873/873:219+218+218+218, пересечений0, Chromium420/WebKit453;
три новых случая пришли из main, наши spec/fixtures не менялись.
`npm run build` (typecheck/Vite/postbuild) прошёл; полный npm run check повторно не запускался: конфликт
документационный, CI/policy неизменны, full check прошлого head зафиксирован
выше, объединённый head должен заново пройти полный CI.

Отвергнуто: выбрать только одну сторону snapshot или переписать историю ветки.
Открыто: CI нового head. Дальше: публикация merge commit в тот же PR;
production/mobile не меняются, PR этим исправлением не сливается.

## Итерация 3 — 2026-11-02 — Codex / OpenAI

Задача владельца: «CI падает» в PR1947. Актуальный headd53d7024,
CI41485991118 завершился failure: единственный browser failure — shard4/4,
job125418973731. Остальные проверки прошли; итоговый e2e красный вследствие
этого job. WebKit case `client confirmed swipe explicit cancel delete and
reload dark compact430` исчерпал30s при повторном открытии удаления первого
подхода после отмены. Retry прошёл за7,6s, но `--fail-on-flaky-tests` правильно
вернул exit1:217 passed+1 flaky. Это не успешная приёмка.

Evidence: error-context первого падения показывает открытое удаление второго
подхода вместо первого. Координаты в helper вычислялись отдельно от browser
actionability точного origin; сценарий сразу продолжал raw pointer stream
после отмены диалога. Позднее смещение scroll/hit-target — гипотеза, точная
последовательность первого pointer stream не записана: штатный trace собирается
на первом retry, а не на нулевой попытке. Исходный локальный точный повтор
прошёл10/10 за35,3s без retries; детерминированного red→green не заявляем.

Изменение ограничено этим существующим E2E: до каждого swipe проверяется
отсутствие alertdialog и выполняется `origin.hover()` на номере первого
подхода. Playwright проверяет стабильность/доступность конкретного origin до
повторного измерения raw координат; произвольного sleep нет. Сам свайп,
cancel/delete/reload, запрет DELETE при отмене, версия/receipt, соседний факт,
rest deadline и остальные исходные assertions сохранены. UI/runtime/shared
gesture helper, protected inventory, browsers, budgets и flaky gate не меняются.
Это синхронизация обычного CRUD-сценария, не снятие проверки отдельного race.

После правки точный case10/10 прошёл за35,0s, retries0. Полная существующая
матрица:8 профилей ×2 engine ×3 диагностических повтора =48/48 passed за2,1m,
workers1/retries0. В CI новых browser cases0/удалённых0. Реальный
inventory873/873 и disjoint union219+218+218+218 сохранён; policy54/54 passed.

Отвергнуто: слепой rerun, ослабление timeout/retries/`--fail-on-flaky-tests`
или изменение продуктовой механики без доказательства её дефекта.
Полный локальный `npm run check` exit0: frontend2923/2923,
API1563passed+264 штатных localDBskip, infra379/379, SpeechKit7/7,
hosting196/196, calendar22/22, media2/2, lint/typecheck/build/postbuild passed.
Docs/PR acceptance и diff-check passed. Полный browser набор873 локально
повторно не исполнялся; новая CI-проверка обязательна.
Открыто: CI исправленного head.
Дальше: закончить проверки, один push в тот же PR и новый полный CI;
production и мобильные приложения не затрагиваются.

## Итерация 4 — 2026-11-02 — Codex / OpenAI

Задача владельца: «опять упали». CI41507028084 на354bc5ef отменён после
внешнего merge main в6c0bde47; это не зелёная приёмка. Новый CI41509756386
на6c0bde47: swipe прошёл, shard4/4 job125499230400 получил другое падение —
`client technique retries failed video and keeps manual play usable`.
После восстановления503 тест безусловно ждал `!video.paused`5s. Retry прошёл,
но217 passed+1 flaky правильно дают failure при строгом flaky gate.
Точная причина отказа autoplay в той попытке не доказана.

Проверен утверждённый [контракт воспроизведения](EXERCISE_TECHNIQUE_PLAYBACK_20261027.md):
iPhone может запретить autoplay, до реального playing остаётся ручная кнопка.
Runtime уже реализует этот fallback; ExerciseImage component test отдельно
проверяет rejected play, ручной запуск и скрытие кнопки только по playing.
Ошибка E2E — требование гарантированного autoplay после retry, которого нет
в контракте. Продуктовый player, media queries и политика браузера не меняются.

Соответствие старых проверок новым:

- Ошибка503, hitbox retry44×44, новая подписанная ссылка, исчезновение ошибки,
  закрытие detail и отдельный inline retry → те же assertions в том же case.
- Безусловный autoplay после detail/inline retry → `autoplay` attribute,
  реальная готовность MP4, затем настоящий пользовательский play; попытка
  autoplay и разрешённый отказ остаются в существующих ExerciseImage tests.
- Скрытая кнопка при playing → после реального ручного запуска в detail
  и inline; до запуска кнопка обязана быть доступной.
- Pause→manual play→движение видео → сохранено; дополнительно currentTime
  обязан вырасти относительно позиции pause, а не просто быть больше нуля.

Новых/удалённых CI cases0, браузеры и матрица прежние. Не добавлены sleep,
mock video.play, retries/timeout overrides или обход `--fail-on-flaky-tests`.
Отвергнуто: слепой rerun и изменение runtime без доказанного дефекта.
Проверено:20/20 browser (WebKit10+Chromium10), workers1/retries0, за43,7s;
ExerciseImage33/33, включая rejected autoplay; CI/scope54/54. Реальный
inventory873=219+218+218+218, Chromium420/WebKit453, пересечений0.
Локального замера исходного video case до правки нет; CI first attempt5s
timeout и успешный retry не являются контролируемым benchmark.
Полный локальный `npm run check`: frontend2923, API1567passed+278 штатных
localDBskip, infra380, SpeechKit7, hosting196, calendar22, media2 passed;
lint/typecheck/build/postbuild passed, итог exit0. Docs/PR acceptance и
diff-check passed. CI нового head ещё гейт. Полный browser набор873
локально повторно не исполнялся. Production/БД/mobile не затрагиваются.
