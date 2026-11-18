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
