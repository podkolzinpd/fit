# Вывод проекта Vercel

## VERCEL-RETIRE-01 — 18.11.2026

Владелец: «Я хочу удалить проект vercel». Это заменяет прежнее требование
сохранять проект ради редиректа. После удаления старый адрес перестанет
работать; основной `fit-training.ru`, API, PostgreSQL и media — в Cloud.ru.
Удаление Supabase, DNS-зоны/регистрации, OAuth приложения, иных проектов,
credentials и организация Vercel в scope не входят.

## Итерация1 — 18.11.2026 — Codex / OpenAI

Задача: убрать зависимости и удалить старый проект Vercel.
Расхождения: Cloud.ru packaging читала `vercel.json`; прямое удаление файла
сломало бы CI. Решено вынести нейтральный static routing и сохранить точную
read-совместимость уже опубликованных пакетов (checksum/identity не меняются).
Сделано: удалены provider config, redirect-only тесты/оператор; Vercel origins
сняты из исходных CORS; canonical DNS/TLS/HTML/assets monitor сохранён.
Проверки уникальных assertions: analytics из старого redirect test перенесены
в public landing tests; SPA/asset recovery остаются в routing/HTTP/Nginx тестах;
проверки сохранения path/query старого домена удаляются вместе с этим сервисом.
Новое покрытие: запуск обоих packaging CLI без provider config; old/new release
совместимость, сохранение identity и отказ подменённому legacy routing.
Отвергнуто: менять fingerprint старых пакетов или ослаблять проверку routing;
удалять canonical monitor вместе со старым redirect monitor.
Проверка: frontend hosting202/202 PASS; финальные proxy/CORS/docs62/62 PASS;
workflow-doc budgets/links/history PASS. Lint/typecheck и frontend coverage3210/3210
PASS. Полный `npm run check` остановился на известном macOS mock-curl тесте
`runner GitHub reads work without gh installed and reject failed HTTP requests`
(389/390 infra PASS); отдельно воспроизведён тот же curl56/401 на неизменённом
baseline424be8e. Тест/таймауты не менялись. Остальные этапы выполнены отдельно:
calendar22/22, hosting202/202, API1592 PASS/423 opt-in skipped, frontend build
и startup verification PASS. Реальный пакет246 файлов и offline Cloud.ru Nginx
созданы только в `/private/tmp`, без provider config и без activation. CI впереди. В GitHub repository secrets/variables с VERCEL в имени
не найдены; значения не читались.
Remote: публичный старый адрес вернул308 на canonical, canonical auth200.
API Vercel ответил403 на read-only запрос с существующей CLI-авторизацией;
Dashboard сначала требовал входа; владелец вошёл. В UI проверен exact проект
`fit`: Git отключён, домен только `fit-drab.vercel.app`, Integrations — пусто.
Удаление пока не выполнено, credentials не менялись.
Открыто: CI и финальное browser-подтверждение удаления exact проекта `fit`.
Дальше: закончить проверки, отправить PR; после доступа проверить привязанные
ресурсы точного проекта перед удалением, затем canonical site/API health.

## Итерация2 — 18.11.2026 — Codex / OpenAI

Задача: завершить удаление после входа владельца.
Расхождения: нет. Browser-инструмент требует подтверждение необратимой операции
непосредственно перед действием; владелец подтвердил «Да, удалить проект fit».
Сделано: exact проект `fit` удалён штатной кнопкой Vercel Dashboard.
Результат UI: `projectDeleted=fit`, пустой список проектов. Удалены только
ресурсы этого проекта; организация, Supabase, Cloud.ru и DNS не менялись.
Проверка18.11.2026 09:57:22 UTC после удаления: canonical/www auth200,
API и web-proxy health/ready200, защищённые clients401, DNS/TLS PASS.
Production API release618cc23e; выпуск нового API этой операцией не выполнялся.
Старый `fit-drab.vercel.app/auth` после удаления вернул404 без redirect.
Решение: VERCEL-RETIRE-01 выполнено для remote проекта. Сохранение старого
provider config не требовалось для живого Cloud.ru сайта, но было лишней
зависимостью будущих сборок; её удаление доставляется в PR2134.
Отвергнуто: удалять иные проекты/ресурсы или менять auth/БД ради уборки hosting.
Открыто: CI и merge PR2134 с уборкой исходников. При проверке первого head:
6 checks PASS,28 pending, failures0; это не завершённый зелёный CI.
Дальше: дождаться обязательных проверок PR2134; красный PR не сливать.

## Итерация3 — 18.11.2026 — Codex / OpenAI — CI2134

Задача: исправить упавшие тесты PR2134.
Расхождения: нет. На headc2049959/run44280961625 упала одна WebKit visual
проверка `Client Lime editor and exercise history light`;154 других cases
этой части PASS. Итоговый e2e красный по зависимости. Во всех трёх попытках
исчерпан общий30s budget, в разных местах. Изменений приложения от Vercel
не потребовалось. Retry trace:7 навигаций, включая прерванную последнюю,
заняли суммарно22,1s; это длинная последовательная проверка, а не отдельный
30s зависший запрос. Локальный исходный WebKit:light10,273s/dark6,772s PASS;
детерминированный local red→green не заявляем.

Сделано: независимые route/theme/width состояния получают отдельные cases;
сохранение optional времени вынесено в behavior с собственной native fixture.
Проверка reduced viewport остаётся только в light390/edit, как раньше.
Тема проверяет разные токены, ширины390/430 — responsive layout/control.
Новая бизнес-логика, ожидания, sleep, runtime, timeout/retry/workers и гейты
CI не добавляются и не меняются.

### Явный повторный аудит Fit Lime inventory

| Прежняя проверка | Сохраняющее её покрытие |
| --- | --- |
|2 callback с обходом3 routes ×2 widths внутри каждого theme |12 независимых cases: те же2 themes ×2 widths ×3 routes, Chromium и WebKit |
|class/surface/no overflow и screenshot каждого route |Те же assertions и16 диагностических снимков на движок (с календарём); snapshots без сравнения не выдаются за visual regression gate |
|calendar marker36px, draft cancel, reduced viewport/focus/visible apply |Те же4 edit-состояния; reduced viewport толькоlight390 |
|validation без PUT, midnight save/readback, remove end/save/reload |Один behavior case на движок с прежними точными assertions и native mock |

AST-аудит:30/30 исходных expect call expressions текстуально сохранены после
нормализации пробелов;172 visual и107 behavior посторонних callback bodies
совпадают побайтно. Общая fixture не меняется. Внешние параметризованные helper
cases сохранены. Реальная collection обоих движков:743→754 на движок
(−2 старых combined+12 route+1 behavior);1486→1508 суммарно. Behavior120→121,
visual623→633. Это разбиение прежних проверок, не новые бизнес-assertions.
Duplicate keys0. Policy проверяет присутствие каждого из12 route states и
единственного behavior, полный disjoint union остаётся обязательным.
Исходный reviewed SHA256 в `fit-lime-ci-scope.mjs` не обновлён: scope остаётся
full после изменения inventory/истечения временного окна. Никакого сокращения CI.

Проверка: оба движка26/26 PASS, workers2/retries0; отдельно WebKit13×2=26/26
PASS, workers1/retries0. Максимальный отдельный case4,673s; visual максимум1,909s.
Повторный WebKit wall49,0s/2 прохода против исходных18,8s/1 проход:
полная локальная работа выросла из-за изолированных BrowserContext, а длинный
общий budget устранён. Это не заявление об ускорении всего CI.
Policy/collection29/29 PASS, docs budgets/links/history и diff-check PASS.
Полный local check:lint/typecheck/frontend coverage3210 PASS, media2 PASS,
SpeechKit7 PASS; остановился на прежнем macOS mock-curl тесте (infra389/390).
Остаток отдельно:calendar22,hosting202,API1592 PASS+423 штатных opt-in skips,
frontend build/postbuild PASS. Тест mock-curl и production не менялись.
Новый CI ещё гейт; зелёный результат не заявляется до окончания.
Отвергнуто: слепой rerun, увеличение timeout, пропуск WebKit или удаление
поведенческой проверки из visual без сохраняющего её case.
Открыто: результаты полного check и CI исправленного head; PR не сливать красным.
Дальше: отправить один стабилизированный diff в тот же PR, дождаться CI.

## Итерация4 — 18.11.2026 — Codex / OpenAI — второй CI blocker

На head10066408/run44311031136 все десять Fit Lime частей PASS; прежняя
WebKit visual4/4 прошла158/158, все12 перенесённых states с retry0,
максимум4,905s. Остальные проверки также PASS, кроме auth4/4 и зависимого e2e.
Auth3/4 успешно завершился за43m15s. Auth4/4:514 PASS+1 flaky, строгий
`--fail-on-flaky-tests` вернул failure. Это не зелёный CI и не причина
перезапускать неизменённый head до удачного результата.

Выявлен второй перегруженный тест: `Yandex ready workouts edits, renames,
plans and deletes an independent favorite with explicit retries` дважды
исчерпал30s на позднем missing/error состоянии и прошёл толькоretry2 за27,18s.
В одном budget смешаны rename, editor, recovery,4 layout states, planning и
uncertain delete. Локальный исходный production-bundle case PASS за17,8s wall;
детерминированный local red→green не заявляется.

Сделано: один тест разделён на6 независимых сценариев, каждый с page-scoped
native fixture состояния источника. Настоящие действия внутри каждого
сценария сохранены, нет browser/page state между tests. Продуктовый код,
таймауты/retries/workers, `--fail-on-flaky-tests` и список CI файлов прежние.

| Прежние проверки | Сохраняющий case |
| --- | --- |
|Independent Ready при ошибке history, coachmark, rename focus/keyboard и409 |rename conflict and keyboard keep the chosen title |
|Добавление/reorder/replace/remove упражнения, draft и503 retry сохранения |editor adds reorders replaces and retries an independent copy |
|Recover cancel,503/missing, pending, запрет PUT, очистка draft без reload |recovery preserves draft on cancel failure missing and pending read |
|Длинное имя, обе темы,390/430, touch44 и overflow |long-name layout keeps touch targets in both themes and widths |
|Смена version при свежем cache, keep/reset draft,503 retry и source refresh, preset fields reload |planning reconciles changed favorite and preserves preset draft |
|Delete503, потерянный ответ после commit, missing/error/retry прямого editor |delete retries reconcile a lost response and reject missing source |

Явный аудит:178/178 expect call expressions совпадают после нормализации
префикса `state.` и пробелов;29 остальных test callback bodies побайтно прежние.
Themes/width matrix не размножает бизнес-цепочки;4 layout states остаются
в одном коротком case. В этом spec существовал только iphone WebKit:
его collection56→61, добавлены5 случаев за счёт split, новых движков нет.
Локальная полная native auth collection2079→2084; четыре shard
520/520/520/519→521/521/521/521, exact union PASS, duplicate keys0.
Остальные E2E исходники baseline424be8e и maine6a98007 совпадают.
Runtime inventory CI может отличаться по своим env/platform; его required gate
и real execution не заменяются локальной collection.

Проверка: native production bundle с synthetic stage origin;6/6 PASS,
max6,571s и23,5s wall вместо исходных17,8s. Изоляция контекстов добавляет
локальную работу, но устраняет общий30s budget разных функций. Повтор12/12
PASS за43,3s, workers1/retries0. Assertions и диагностические screenshots
сохранены. Финальный local check:lint/typecheck/frontend3210,media2,
SpeechKit7 PASS; остановился на том же macOS mock-curl тесте (infra389/390).
Остаток отдельно:calendar22,hosting202,API1592 PASS+423 штатных opt-in skipped,
frontend build/postbuild PASS. Docs budgets/links/history и diff-check PASS.
Новый CI исправленного head впереди; зелёный результат пока не заявляется.
Отвергнуто: увеличивать budget, принимать flaky pass или выбрасывать
поздние проверки missing/error; serial tests с общей страницей.
Открыто: окончание локальных проверок, новый полный CI исправленного head.
Дальше: один push стабилизированного исправления в PR2134 и ожидание CI.

Дополнение реаудита границ: прежний следующий click также доказывал, что
после rename/edit список обновил название, а после planning можно вернуться
к исходному favorite. После split эти три перехода проверяются явно в конце
соответствующих cases: точная доступная кнопка действий на карточке.
Все178 исходных call expressions остаются; добавлены3 boundary assertions
(6 AST call expressions, всего184). Case inventory прежний61; повтор12/12
на заново собранном synthetic production bundle PASS за55,1s, retries0,
skips0; целевой ESLint и diff-check PASS. Общий check предшествовал этим
трём E2E assertions; app/API/hosting исходники не менялись. Это дополнение
не разрешает flaky pass: полный CI актуального head остаётся обязательным.

## Итерация5 — 18.11.2026 — Codex / OpenAI — segments budget

На head7afa2810/run44322736983 обнаружена третья перегруженная семья:
`Client Lime segments keep one geometry and visible body-map selection`.
Все4 theme/width варианта исчерпали30s во всех попытках на поздней навигации
или следующем assertion. WebKit visual4/4:4 failed+154 passed; первые editor
сценарии не упали. Новых продуктовых дефектов эти логи не доказывают.
Один case объединял settings→reload→progress→settings дважды, затем history
и save. Локальный исходный WebKit4/4 PASS,38,3s wall, sum35,538s/max9,437s;
детерминированный local red→green не заявляется.

Сделано: body-map preference, history segments и save segments разделены.
Для каждой темы/ширины —2 body-map режима и по1 history/save case. Body-map
сохраняет реальное изменение выбора, reload, чтение progress и возврат settings.
Чтобы «Фигура» проверяла именно изменение после «Списка», native fixture
начинает с противоположного режима и это проверяется явно. Init script пишет
изначальный выбор только при отсутствии ключа: последующие reload не затирают
выбор пользователя. History/save fixture начинает с real, как конец прежнего
body-map цикла. Продуктовый preference transport и UI не меняются.

### Явный повторный аудит

| Старые проверки | Сохраняющий case |
| --- | --- |
|2 radio, обе selections, selected/backdrop contrast,28/24px |body-map selection для каждого режима |
|Выбор после reload, mode в progress и после возврата settings |Тот же самостоятельный preference round-trip |
|History calendar/list pressed,28/24px и screenshot |history segments keep geometry |
|Save completed/planned active,28/24px,screenshot,no overflow |save segments keep geometry |

Все34 исходных expect call expressions сохранены; добавлены2 AST call nodes
для проверки противоположного начального режима.172 остальных test callback
bodies совпадают побайтно. Tags,2 themes,390/430, оба движка и screenshots
сохранены. Layout matrix не повторяет history/save внутри preference journey.
Full inventory766/engine (754−4+16), behavior121+visual645; итог1532 на двух
движках. Guard явно проверяет все16 segment states; collection/disjoint union
и остальные policy29/29 PASS. Исходный SHA scoped inventory не обновлялся,
full CI и неизменные budgets/retries/workers обязательны.

Локально Chromium/WebKit32/32 PASS, workers2/retries0; самый длинный case
WebKit5,632s, Chromium4,359s. Sum WebKit вырос с35,538s до55,497s из-за
изолированных контекстов; это не заявляется ускорением всей acceptance.
Повтор8 WebKit preference states×2:16/16 PASS, retries0/skips0,
wall68,5s,max4,504s. Новых user data/remote ресурсов нет.
Финальный local check:lint/typecheck/frontend3210,media2,SpeechKit7 PASS;
единственный исходный macOS mock-curl failure (infra389/390) прежний.
Остаток отдельно:calendar22,hosting202,API1592 PASS+423 штатных opt-in skips,
frontend build/postbuild PASS. Docs/diff-check PASS. В текущем CI7afa2810
исправленный auth4/4 уже SUCCESS за32m32s; auth1/4 и3/4 ещё выполняются.
Полный CI актуального segments patch впереди.
Отвергнуто: принять случайный retry pass, увеличить30s, удалить темы/ширины
или разорвать собственно preference/reload/progress round-trip.
Открыто: проверить остальной текущий CI, завершить local check, отправить patch.
Дальше: дождаться полного зелёного CI нового head, не сливать красный PR.
