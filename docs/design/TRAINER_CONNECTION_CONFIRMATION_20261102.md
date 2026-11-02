# Единое подтверждение подключения и смены тренера

## Согласованное решение — 02.11.2026

Владелец подтвердил сценарий: спортсмен подтверждает нового тренера, видит
текущего и нового; при смене одна транзакция закрывает старый период и открывает
новый. Один активный тренер, история, авторство, приватные заметки, финансы и
разрешённая историческая видимость сохраняются. Тренер не может заменить другого
тренера без решения спортсмена. Это заменяет только прежнее требование отдельно
отключить тренера перед принятием нового приглашения; старые API его сохраняют.

## Объём и проверки

| ID | Результат | Проверка |
| --- | --- | --- |
| TC101 | Одинаковое подтверждение в чате, ссылке/QR и старом коде | Общий компонент; browser link/chat и контракт code |
| TC102 | Отправитель предложения не получает доступ до согласия спортсмена | Actor/RLS: тренер и посторонний не подтверждают; старый accept не меняет тренера |
| TC103 | Атомарная замена периода и сохранение канонической карточки | Реальный PG17: link/code/chat, старые заметки/доступ, прежний merge |
| TC104 | Изменение текущего периода или предложения требует новой проверки | Проверка relationship UUID и offer revision под блокировками; UI явного recheck |
| TC105 | Повтор после потери ответа возвращает результат без новой связи | Закрытая receipt-таблица, hash запроса и operation UUID; отключённая receipt не воскрешается |
| TC106 | Отзыв/истечение/блокировка/конфликт данных не отключают старого тренера | PG17: отказ до изменения либо rollback всей транзакции; конкурентный победитель один |
| TC107 | Существующие темы, длинные имена, pending/error/retry/success | Client390/430, обе темы, WebKit; public guest/auth continuation сохраняются |

Новая функция имеет один provider-neutral DTO и Cloud.ru/PostgreSQL реализацию.
Frozen Supabase adapter и migration chain не расширяются. Старые installed
клиенты продолжают использовать прежние защищённые команды. Клиентское
приглашение тренеру сохраняет прежнее согласие при создании и не позволяет
тренеру самовольно заменить существующего. Корпоративные приглашения отдельны.

## Реализация

Новая forward migration178 добавляет закрытые receipts и actor-scoped preview /
confirm. Подтверждение проверяет свежесть, берёт actor claim lock и client-row
locks, валидирует выбранное предложение. Для link/code переиспользуется текущий
claim/merge; любой конфликт объединения откатывает и отключение. Для chat
сохраняется только явно выбранное предложение, остальные старые аннулируются.
Технический partition-owner, сообщения, авторство и финансовые данные не меняются.
Имена берутся из опубликованных анкет, затем из аккаунта; draft не раскрывается.
Ни серверные логи, ни receipt не хранят bearer token.

UI переиспользует StatePanel, stack/compact, primary/secondary и текущую оболочку
приглашения/чата. Одно primary подтверждает подключение либо смену. При stale
consent остаётся «Проверить снова»; сетевой retry сохраняет operation ID.

## Журнал

### Итерация1 — 02.11.2026 — Codex / OpenAI

Задача: согласованные TC101–TC107, исходный main3efe3816.
Расхождения: старый чат запрещал даже предложение при другом тренере; старый
claim требовал ручное отключение. Новое явное решение владельца разрешает
athlete-only atomic switch; публичные legacy contracts не ослаблены.
Сделано: изолированная ветка, новая migration/API/DTO, общий consent в трёх
входах, регрессии API/БД/UI и browser.
Решения: новая команда вместо disconnect+claim из браузера; reuse существующего
merge; UUID периода вместо одного trainer ID ловит отключение/возврат того же
тренера. Закрытая receipt возвращает подтверждённый результат exact retry.
Отвергнуто: отключать первым отдельным HTTP; менять partition-owner; разрешать
switch тренеру; писать второй Supabase backend; молча обновлять согласие.
Проверка: реальный PG17 clean/upgrade и40 API/DB cases прошли;45 UI cases прошли.
Podman VM не запустилась; вместо неё изолированный PostgreSQL17 на localhost.
Полные проверки, browser, CI и выпуск ещё выполняются.
Открыто: приёмка native production build и текущего head, публикация/прочтение.
Дальше: завершить проверки, PR/current-headCI, штатный выпуск и after-probe.

### Итерация2 — 02.11.2026 — Codex / OpenAI

Задача: закончить локальную приёмку TC101–TC107 перед PR.
Расхождения: sandbox запрещает локальные sockets; полный check повторён с
разрешённым localhost. Корпоративный upgrade/down/up gate потребовал безопасной
повторной установки forward-only migration178; receipt и данные не удаляются.
Сделано: фиксированное подтверждение,15s transport timeout и сохранение operation
при сетевой ошибке; смена аккаунта заблокирована на время отправки. Browser
cases включены в существующий native Yandex CI-файл без изменения workflow.
Решения: сохранять UUID периода и offer revision, не угадывать текущего тренера;
старый public accept не умеет switch. При смене нового предложения через чат
тренер может только предложить, не выдать себе доступ.
Отвергнуто: удалять receipts при down/reapply; считать mock UI доказательством
production-транзакции; расширять legacy adapter или менять rollout других функций.
Проверка: полный npm run check exit0;3057frontend,1563API,264условных DBskip.
Отдельный реальный PostgreSQL17:232passed/2skip,21private-import и6erasure passed;
новые API/DB вместе40/40. WebKit native production build с проверенными2/2YS Geo:
3/3 cases retries0,link/chat preview→stale→recheck→success;390/430,light/dark,
длинные имена,нет horizontal overflow,touch>=44px. Снимки просмотрены.
Финальные целевые frontend131/131;workflow budgets/links/migration safety/diffcheck.
Логи:/private/tmp/fit-connection-check-final.log,/private/tmp/fit-connection-full-db.log,
/private/tmp/fit-connection-browser-final.log. Все identities/API браузера условные.
Открыто: CI текущего head,очередь,merge,API/web/OTA release и production readback;
реальный OAuth и физический телефон пока не проверены.
Дальше: PR и проверка CI; затем штатный выпуск точного main без пользовательских
production-мутаций ради тестирования.

### Итерация3 — 02.11.2026 — Codex / OpenAI

Задача: исправить CI1938 и интегрировать вышедший1928/main903f1409.
Расхождения: два visual4/4 lane искали старый claim/button; это изменение
пользовательского контракта требовало нового native preview/confirm fixture.
Новый main перенёс общие E2E на реальный native API: новая service добавлена
только в существующий test harness. Конфликт CURRENT_STATE разрешён сохранением
обоих статусов; прежние сведения main не возвращены/удалены.
Сделано: сохранён прежний success «Тренер подключён»/«Открыть кабинет»;
visual fixture теперь проверяет source/locator/expected period/offer revision,
отсутствие записи до click, прежние темы/radius/result/overflow assertions.
Защищённые test titles/tags и digest не менялись; остаётся full CI.
Решения: first-run coachmarks в native invitation tests закрываются штатным
«Понятно» после hydration; отсутствие overlay до hydration не считается готовностью.
Отвергнуто: force click/удаление overlay из DOM, увеличение timeout/retries,
отключение visual lane, auto-refresh protected digest или возврат старого API.
Проверка:11/11WebKit/Chromium shared/visual cases,retries0. Обратный native
спортсмен→тренер прошёл; отдельный повтор прямого trainer→athlete —1/1 за5s,
через реальный Fastify/actor session/PG17 с новым confirmation store. Настоящий
Yandex OAuth не использовался: сессии условные, SQL/RLS настоящие.
E2E TypeScript/targeted lint/node syntax/workflow budgets/diffcheck passed.
Полный check после merge выявил только5s timeout независимого compression test
при конкурентной локальной нагрузке; assertions/timeouts не менялись, итоговый
повтор выполняется с VITEST_MAX_WORKERS=2. Runtime feature tests сохранены.
Открыто: итог полного check этой интеграции, CI нового head,merge/выпуск/readback.
Дальше: отправить проверенную интеграцию в1938; старый CI не выдавать за новый.
