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
