# Собственный профиль клиента — 04.11.2026

Владелец утвердил макет «Как у тренера», сохранение подцелей и три PR словами
«фиксируй план, делай, выкатывай». Разрешены реализация, обычные слияния и
последовательный официальный выпуск после проверок. Повторное согласование
обычного выпуска не требуется. Новый scope согласуется отдельно.

Источник композиции: локальный client-own-profile.html в этом чате; шапка
тренерской карточки из CLIENT_PROFILE_LIME_20261104. Фото121×120/radius24,
имя24/24 Medium, четыре Doto-показателя; существующие YS Geo/Lime токены.
Демонстрационный портрет, имена и значения из эскиза в приложение не включаются.
Второй компактный вариант не реализуется. Светлая/тёмная темы одной разметки.

## Три последовательных PR

| ID | PR | Результат и приёмка |
| --- | --- | --- |
| COP101 | 1 | Шапка: реальное фото/имя/email/возраст/рост/последний вес/ИМТ; пропуски — прочерк; длинное имя и настройки/редактирование доступны |
| COP102 | 1 | Клиент загружает/заменяет только своё фото существующей карточки; активный тренер сохраняет прежний доступ; посторонний/отключённый/архивный/merged запрещены |
| COP103 | 1 | Приватное media storage и существующая версия фото, JPEG/лимиты; stale conflict, идемпотентность и явный повтор без потери выбранного файла |
| COP104 | 1 | Фото и данные читаются после reload и у обеих ролей; фото не меняет версии/результаты тренировок, новые зависимости/отдельная копия профиля не нужны |
| COP201 | 2 | Основная цель/срок/текущая подцель с датами и номером; полный список этапов раскрывается в прежнем порядке, отсутствующий текущий этап не выдумывается |
| COP202 | 2 | Существующая ClientGoal со stages/criteria, версии и подтверждение критериев сохраняются; текст client.goal не заменяет aggregate |
| COP203 | 2 | Прежний редактор/создание/изменение/удаление этапов/архивирование; возврат в профиль при входе оттуда, прежние другие входы сохраняются |
| COP204 | 2 | Нет цели/нет этапов/несколько этапов/ошибка/конфликт/reload/изменение тренером; никаких придуманных процентов и новых статусов достижения |
| COP301 | 3 | Мой спорт: прежние private sports/bio/раскрытие и редактор; приватная заметка тренера клиенту не передаётся |
| COP302 | 3 | Тренер: анкета/чат/поиск/приглашение/подтверждение смены/отключение с сохранением истории; один активный тренер |
| COP303 | 3 | Услуги: фактические пакеты/остатки/оплата/подробности, без новой финансовой логики |
| COP304 | 3 | Итоговое оформление/темы/390/430 и узкий WebKit360/375, клавиатура/фокус/длинные тексты/ошибки; все существующие входы доступны |

Каждый PR: подходящие unit/API/реальный PostgreSQL для прав/транзакций,
production-build браузер для взаимодействий, визуальная матрица отдельно;
новый head получает собственный обязательный CI. Тесты не размножаются без
нового риска, assertions/timeouts/retries/strict-flaky/coverage не ослабляются.
Исходные провалившиеся попытки и диагностика сохраняются перед повтором.

Порядок выпуска каждого принятого PR: свежий main/очередь → normal squash с
match-head без admin/force/bypass → full actual-main CI → official Cloud.ru
API точного SHA → web с exactAPI guard → совместимый signed OTA. Автоматические
dispatch не дублировать. Принять опубликованный web и точный извлечённый ZIP
Chromium/WebKit: все файлы SHA256/size, оба API release/health/ready/auth401,
RSA/source/ABI/sequence и same-version readback после UI. PNG сохраняются и
просматриваются. Последний PR получает сквозную приёмку всего профиля.
Business writes в production запрещены: browser synthetic API. Физический
телефон/реальный OAuth/device OTA отдельно отмечаются непроверенными.

## Итерация 1 — 04.11.2026 — Codex / OpenAI

Задача: согласованный пакет трёх PR собственного профиля, подцели обязательны.
Расхождения: сервер фото сейчас разрешает запись только активному тренеру;
разрешённый COP102 требует узко добавить владельца существующей карточки.
Решение: тот же endpoint/namespace/version и forward migration функции прав,
без новой сущности/публичных фото/общего доступа к чужим карточкам.
Сделано: отдельный checkout/ветка от actualmain c8ce565a; старые локальные
квитанции1957 не изменены. Новый план зафиксирован до runtime-правок.
Проверка: текущие header/profile/goal/editor/photo API/SQL и существующие
тесты прочитаны. Корпоративный KB вернул известные ошибки, используем репозиторий.
Открыто: реализация и проверки всех трёх PR. Сообщение о новой очереди ФИТ14
отклонено automatic approval review; отдельно запрошено разрешение только
на эту координацию. Это не отменяет разрешённую реализацию/выпуск.
Дальше: COP101–104, права владельца/конкурентная версия, локальная проверка/PR1.

## Итерация 2 — 04.11.2026 — Codex / OpenAI
Сделано COP101–104: отдельная OwnClientProfileHeader и строго scoped Lime CSS,
единое фото/версия существующей карточки; forward188 добавляет только
владельца account_role=client с auth_user_id=actor. Прежние trainer/active/
archive/merged guards, размерыJPEG, идемпотентность и конфликты сохраняются.
Новый реальный app-session/fit_api тест проверяет отказ чужому до media.write
и чтение после собственного upload; пойман закрытый helper42501, исправлен
вызовом уже granted can_access_client из149, который внутри проверяет active
connection. Grant внутреннему helper не выдаётся. Автопроверка отклонила
первое удаление дублирующего helper-вызова; принят более явный non-owner
trainer guard через существующую разрешённую обёртку.
Проверка:3componentfiles13passed, ESLint/types/build/startup/docs passed.
Реальный SQL rights suite35passed. После добавления real-session adapter он
прошёл; последний полный36набор:35passed и1прежний code-claim timeout5s.
Два initialbeforeAlltimeout10s под параллельной нагрузкой сохранены; таймауты
и assertions не увеличивались. Full CI текущего source обязателен.
Первый browserbuild не содержал fixture OAuthclientID, второй не включал
client Lime; ошибки настройки сохранены, продфлаги не менялись. Третий прогон
начался до окончания prereqbuild, остановлен и не считается приёмкой.
Сейчас exactfixture Lime/auth build exit0; его6Chromium/WebKit сценариев
проверяют upload/conflict/reload и геометрию390dark/430light отдельно.
Открыто: полныйunitcoverage/browser/API/CI и публикация. Продданные не менялись.
Дальше: сохранить PNG/конкретные результаты, PR1 и параллельная подготовкаPR2.

## Итерация 3 — 04.11.2026 — Codex / OpenAI

Задача: устранить конкретные ошибки подключения browser acceptance PR1989.
Проверка source ade20:339unitfiles/3040passed; coverage83.64/78.62/82.89/88.33,
APIcheck exit0 (135files1569passed,320условныхDBskips — не SQL-доказательство).
Proper production fixture:6/6 Chromium/WebKit,0retry/skips, PNG просмотрены.
FullCI41885442250 первая попытка выявила ошибки самого acceptance:
новые standalone spec попали в legacy Chromium/WebKit без compiled clientLime;
native profile-settings ожидал заменённый аватар56, Lime visual — старую
кнопку radius0. Логи отдельных завершённых jobs сохранены до изменений.
Решение: неизменные три own-profile cases регистрируются через существующий
обязательный client-workout-reference entrypoint для обоих движков в native
production harness. Отдельные дублирующие entrypoints удалены; inventory6/6.
Прежние settings/visual сценарии сохраняют действия и проверки, geometry
обновлена на утверждённые photo121×120/edit52/radius18. CI-конфигурация,
assertions других состояний, retries/timeouts/strict-flaky не меняются.
Локальный повтор settings выявил отсутствующий client-workout pilot в нашей
fixture-сборке (нет Compact radio); исправлен только локальный build env.
Это не новая ошибка продукта и не разрешение пропустить проверку настроек.
Открыто: новый head требует собственного полного CI; публикации ещё нет.
Проверка исправления:14/14 browser (6header +4settings обоих движков +
4Chromium visual)14.1s; отдельно4/4WebKit visual,0retry/skips. Production
build/startup/fonts2/2, ESLint/docs/diff passed; WebKit PNG просмотрен/сохранён.
Дальше: normal push исправления и fresh source CI.

## Итерация 4 — 04.11.2026 — Codex / OpenAI

Задача: COP201–204 без потери подцелей/критериев.
Сделано: OwnClientProfileGoal читает существующий aggregate, показывает цель,
срок, текущий этап с датами/номером и весь упорядоченный список подцелей.
Отсутствующий текущий этап не подменяется первым; отсутствие/error/loading
разделены. Legacy client.goal только текстовый fallback, не источник stages.
Критерии/подтверждение не пересчитываются, сохранены текущие правила/версии.
Прежний редактор получает разрешённый context from=/me/profile: сохранение,
отмена, back и архив возвращают в профиль только при входе оттуда.
Другие входы/редактор критериев и серверные команды сохраняются.
Проверка:5новых unit +прежний editor/profile =11passed; types/build passed.
Browser2/2 Chromium/WebKit: изменён второй из трёх этапов с expectedVersion8,
все названия/даты/порядок/критерий сохранены после возврата/reload, отмена
не создаёт повторную запись. PNG WebKit просмотрен, файлы сохранены отдельно.
Два промежуточных провала были ошибками нового теста: back является button,
ответ stage требует полный объект, а не только version. Assertions не сняты:
проверен фактический переход и ответ приведён к действующему API-контракту.
Попытка запуска preview без localhost-разрешения получила EPERM до тестов;
разрешённый локальный запуск прошёл, это не отказ приложения.
Открыто: PR2 пока локальный, sequential source/main/release после приёмкиPR1.
Дальше: подготовить COP301–304; PR1989 newsource483aacd8 CI41888524738.


## Итерация 6 — 04.11.2026 — Codex / OpenAI

Задача: необходимая интеграция фактического squash1979/d7de75bb.
Расхождения: actualmain изменился во время CI483; его старый результат не
заменяет проверку объединённого source. Решение: ordinary merge без конфликтов,
обе истории сохранены.10incomingfiles213+/19-: финансовые Lime стили/карточки/
payments/tests/журнал, scopedAppLayout и import. Наши header/photo/API/migration188
сохранены; package/lock/android/nativepolicy и SQL входящего main не менялись.
Проверка:13componentpassed, split/partition8passed с новым финансовым сценарием,
production build/startup/fonts2/2 passed;14/14header/settings/visual browser
Chromium/WebKit19.7s,0retry/skips. Правила actualmain AGENTS/workflow/contracts
сверены черезGit, новых инструкций нет. CI483 metadata сохранены перед заменой.
Дополнительно отдельный own-profile acceptance harness прошёл14/14 локально
11.3s под запретом realAPIwrites; inventory стадий6/8/14 exactsource проверен.
Это проверка harness, не публикация/не фактическая production-приёмка.
Открыто: новый fullsourceCI после merge; actual1979 ещё проходит CI/выпуск.
Дальше: normal push необходимого объединения и наблюдение точных новых runs,
без duplicate dispatch и без занятия чужого production окна.

## Итерация 8 — 04.11.2026 — Codex / OpenAI

Source684 CI41891218478 завершился:33success, auth4 и aggregate failure.
Единственный упавший сценарий — восстановление merged client-card после
временно пустого списка, yandex-only-auth.webkit:1686/1713. Все три попытки
искали старый .client-profile-identity strong; это прежний selector, не новая
ошибка account recovery. Его собственные sessionReads/clientReads/no-writes
assertions не меняются. Новый semantic selector region«Мои данные»/heading
проверяет то же точное имя в утверждённой шапке.
Проверка: тот же production fixture WebKit1/1passed5.9s,0retry/skips;
ESLint/diff passed. Исходные metadata/joblog/diagnostics сохранены.
Дальше: новый точный полный source CI (head действительно меняется из-за теста),
без слепого failed-only повтора. Предшественник1979 принят по фактическому
PRbody:mainCI41888147254/API41891789173/web41891789081/OTA41893531769SUCCESS,
213files/36public+36ZIP Chromium/WebKit, финальная квитанция прочитана.

## Итерация 9 — 04.11.2026 — Codex / OpenAI

Source177 fullCI41898916268 первый запускSUCCESS35/35, Android41898915475
SUCCESS. Исторический auth-recovery failure684 не повторился; все прежние
assertions сохранены. Перед squash actualmain изменился на5612dbcd/#1982,
GitHub пометил1989 BEHIND. Выполнен necessary ordinary merge без конфликтов.
Входящие4files276+/8- — read-only roster audit/его тесты/журнал и регистрация
теста в package infra:policy:test. Dependencies/lock/API/schema/src/android
не меняются; nativeABI8922/code9 сохраняются, source177 runtime побайтный.
Разрешённые обычные merge/release продолжаются без передачи пакета в другой
чат: фактическая очередь проверяется напрямуюGitHub. Вопрос владельца
«зачем что-то передавать туда?» снял наше лишнее процедурное предположение;
исходящих сообщений не было, local bug repro=yes записан без отправки.
Открыто: новый полный exactheadCI из-за реального necessary main merge;
полныйgreen177 сохранён как история, им не подменяется новый head.
Дальше: штатная проверка объединения и squash безforce/admin/bypass.

## Итерация 10 — 04.11.2026 — Codex / OpenAI — локальная квитанция после freeze

Sourcee87 CI41903246584 attempt1FAILURE:33success, auth4 иaggregate failure.
Конкретный flaky — nutrition-diary.webkit:349:49/dark, trainer consent;
на354 ожидается region«Питание сегодня»/«Клиент пока не разрешил», timeout5s.
Retry0 failed7359ms; встроенныйretry1 passed5592ms, light retry0 passed4200ms.
246другихcases passed, strict --fail-on-flaky-tests корректно завершилjob1.
Исходный snapshot показывает закрытый«Статистика, замеры и питание» и роль
тренера; passed retry trace содержит нажатие summary и успешный consent-check.
Точная причина гонки не доказана без retry0trace; условный helper count()
до стабилизации раскрытия — гипотеза. Изменений питания/его теста/src/API
междуполностьюзелёным177 иe87 нет; наш UI scoped только own-client profile.
Metadata/joblog/timings/errorcontext/retry1trace сохранены отдельно до повторов.
Решение: один failed-only повтор auth4/aggregate того же e87 после окончания
всей попытки; main5612/head identity проверены. Assertions/timeouts/retries/
strict-flaky/coverage не меняются, исходная failure история не удаляется.
Открыто: фактический repeat результат; до полного green merge/deploy удержан.
Итог: attempt2SUCCESS35/35, auth4 job126847068163247passed13.4m,
0retry/flaky;полный лог сохранён. Выполнен ровно один failed-only повтор.

## Итерация 11 — 04.11.2026 — Codex / OpenAI

Перед squash freshmain сталab961d51/#1986, GitHub1989BEHIND. Включён
необходимый ordinary merge без конфликтов, локальная история10 сохранена.
Входящие3files150+/0-:manual inspect-account-history workflow, его контрактный
тест и журнал восстановления. Выполнение самой диагностики не запускалось.
Src/API/package/lock/android/наш профиль и nativeABI8922/code9 прежние.
Правила AGENTS/workflow/contracts/currentstate входящимmain не менялись.
Green e87/attempt2 сохранён, новая объединённая голова требует полногоCI.
Дальше: штатные проверки incoming workflow и exactsourceCI, без bypass.
