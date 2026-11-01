# Native frontend fixtures — 01.11.2026

Подготовительный этап вывода Supabase. Runtime legacy SDK, composition,
queries/repositories и существующие unit-тесты сохраняются. Production API,
AI prompts и Cloud Functions не меняются. Исходная полная работа сохранена
в `codex/remove-legacy-frontend` (`f406f293`), большой PR1909 закрыт.

## Контракт

- Browser fixture executable слушает loopback и создаёт отдельную локальную
  PostgreSQL17 DB на worker; production DSN запрещены проверкой host/port.
- Применяется native migration chain; реальные actor/RLS adapters работают
  через fit_api. Синтетическая app-session выдаётся fixture endpoint.
- Перед сценарием reset удерживает runtime connection до завершения seed;
  предыдущий browser context закрывается. Worker удаляет только свою DB.
- Playwright `native-e2e` mode выбирает уже существующие native aliases.
  Обычный development/test mode и production runtime не переписываются.
- Явный DataBackendContext экспортируется для трёх изолированных UI harnesses.
- CI browser lanes получают PostgreSQL17 и API build вместо GoTrue/PostgREST;
  frozen legacy SQL checks остаются без изменения.

## Сохранение покрытия

| Прежний setup/проверка | Сохраняющий native сценарий |
| --- | --- |
| GoTrue signup/signin для двух ролей | nativeSignIn/nativeRegister, настоящая opaque app-session |
| Supabase RPC CRUD клиентов/тренировок/прогресса | trainer-flow, clients/workouts/progress через native API/RLS |
| Realtime channel как триггер обновления | client-realtime: существующий native visibility refresh после writer commit |
| Приглашения/смена тренера | auth/invitation-links с настоящими native привязками |
| PostgREST-shaped UI fixtures | typed native training/progress/summary DTO fixtures |
| Legacy email/password snapshots | native Yandex welcome; local password unit coverage остаётся |
| Общие form harnesses со скрытым legacy backend | явный native DataBackendContext, прежние assertions |

Все роли, состояния доступа, Chromium/WebKit и visual viewports сохраняются.
37 PNG старых password-экранов прекращают участвовать в product E2E; unit tests
этих локальных экранов пока не удалены. Linux native PNG получены в pinned CI
runtime; thresholds, retries и таймауты не ослаблены. Идентичность native body-map
проверена с main93784374:0 разных RGB pixels. Две touch-правки native-форм
44px sport options/48px preparation select включены явно вместе с эталонами.
Anonymous AccountDeletion показывает существующее «Сначала войдите» до обращения
к обязательному authenticated backend. Тест online coaching задаёт обе даты
периода, чтобы смена календарного месяца не ломала submit.

## Проверки и ограничения

Проверки самостоятельного первого этапа публикуются в его PR. Полные замеры
скорости старого и нового suite на одинаковом окружении отсутствуют. Матрица
браузеров и CI shards не расширялась; product сценарии не размножены.
Production, настоящий OAuth и физические телефоны не проверяются этим fixture
набором. Отключение удалённых Supabase ресурсов не входит в этот этап.

Самостоятельный первый этап локально прошёл `npm run check`:333 unit files /
2972 tests; coverage81.43/76.35/81.16/86.03 при прежних порогах80/75/80/80;
API1549 passed/238 skipped, lint/typecheck/policies/build passed. E2E TypeScript
и Node syntax check fixture executable прошли. Chromium create-client/workout/
progress и WebKit empty Live обеих ролей/reload:4/4. Native welcome visual390
без update:1/1, обе сохранённые theme preferences. CI публикуется в PR.

## Исправление CI и синхронизация main — 01.11.2026

Repository-quality упал в merge checkout из-за превышения бюджета
CURRENT_STATE после параллельных обновлений main. Подлит main dba30d2b
с новым верхом календаря/четырьмя видами. Повторные сведения об уже слитом
PR1842 сжаты в индексе без изменения статуса, ссылок и ограничений проверки.
Лимиты документа и CI gates сохранены. Точные проверки нового head — в PR1928.

Дополнительные CI failures: desktop completion оставлял native attendance
confirmation открытым; push diagnostics не доходил до browser failure без
VAPID public key. Browser-only env теперь получает существующий synthetic
public key из unit fixtures; trainer сценарии подтверждают проведение через
действующую кнопку. Product runtime, PNG, thresholds, retries и protected
Fit Lime spec не изменены.

Локально на main dba30d2b: полный `npm run check` —336 files/3007 unit tests,
coverage81.52/76.54/81.13/86.11; API1551 passed/242 skipped; build, lint,
typecheck и policies passed. Browser TypeScript/targeted lint passed; Node
workflow/doc policy52/52; desktop completion visual1/1 без update; push
diagnostics с FIT_SCHEDULE_V2_VISUAL=1 —1/1; связанные native trainer finish/
calendar Back/active-input flush Chromium/WebKit —6/6. Финальный CI — в PR1928.

Полные логи остановленного старого прогона дополнительно выявили устаревшие
assertions для нового trainer done-status и attendance dialog в realtime/
mobile-shell. Теперь проверяются явное «Проведена», primary submit/secondary
cancel действующего dialog; сохранение записанных/незаписанных результатов,
права и Back assertions остаются. Целевые Chromium/WebKit сценарии3/3, lint
и browser TypeScript passed. Других ошибок в логах оставшихся остановленных
auth/Fit Lime jobs не зарегистрировано; это не заменяет полный новый CI.

Оставшийся desktop visual mismatch: fixture personal-records содержал
legacy name/ref/primary_value вместо native exerciseName/exerciseRef/primaryValue.
DTO исправлен, закреплён через satisfies WorkoutPersonalRecord и явные
assertions рекорда42.5×9/статуса «Проведена». Lint/browser TypeScript passed.
Новый actual просмотрен: продуктовые WorkoutsPages/AttendanceSheet идентичны
main dba30d2b; прежний Darwin PNG показывал «Частично»/«Не выполнено», тогда
как принятое YAFIT-700 требует «Проведена»/«—». Автоматический approval review
отклонил обновление рабочих PNG без явного разрешения владельца. Эталоны
рабочей ветки не изменены; ожидается решение на соответствующие desktop PNG.
Локальный Linux Podman прогон остановлен после kill Vite окружением; его
снимки не используются как проверенные эталоны.

## Итерация — 01.11.2026 — Codex / OpenAI: повторный CI PR1928

Задача: исправить повторно упавший PR, сохранить native-поведение.
Расхождения: personal-records fixture ошибочно оставлял legacy поля; public
profile fixture использовал catalog `profile` вместо native `draft/published`.
Сделано: оба DTO исправлены и проверяются существующими доменными типами;
completion явно проверяет личный рекорд42.5×9 и статус «Проведена».
Public WebKit сохраняет три исходных случая и assertions, выбирает реальный
scroll-контейнер: mobile page или standalone desktop document.
Решение: пользователь ответил «поправь пр» на запрос обновить desktop PNG;
предыдущая блокировка approval этим снята. Принятые рекорд/статус/пустой факт
сохраняются; изменения UI для подгонки снимков и ослабление порогов отвергнуты.
Подлит main cdb2fbca без конфликтов; его перенос даты завершённой тренировки
учтён в тех же эталонах. WorkoutsPages/AttendanceSheet совпадают с main.
Проверка: public WebKit3/3; desktop Darwin1/1 обычным сравнением после update;
E2E TypeScript passed. Итог полного check/Linux/CI — в проверенной версии PR1928.
Production и настоящий OAuth не проверялись и не изменялись; PR остаётся ready.
Дальше: завершить обычный CI на исправленном head, зависимый PR1929 отдельно.

Итог локально на main cdb2fbca: полный `npm run check` passed —336 unit
files/3007 tests, coverage81.52/76.54/81.13/86.11, API1551 passed/242 skipped.
Linux desktop обычным сравнением1/1: pinned Playwright1.61.1 arm64 в Podman,
тот же native-e2e Vite на macOS loopback через временный локальный proxy.
Это устранило задержки bind mount; временная оснастка не входит в PR.
Изменены только3 разрешённых PNG: completion Darwin/Linux и dark Linux.
Остальные PNG этого сценария совпали; пороги, retries, таймауты прежние.
Целевой lint, E2E TypeScript, workflow docs и diff whitespace passed.
CI результата нового head ещё нет; он фиксируется в PR после завершения.

## Итерация — 01.11.2026 — Codex / OpenAI: повторные загрузки native login

Задача: устранить повторное падение CI после merge main в c09dd9c0.
Расхождения: предыдущий head d46c3a77 прошёл полный CI, новый Chromium2/2
исчерпал30сек в публикации анкеты на всех трёх попытках; ещё3 сценария flaky.
Trace retry1 показывает /auth4.4/4.5/4.4сек, затем каждый прямой переход
по4.2–4.5сек. Native context routing выключает HTTP cache; лишняя загрузка
/auth повторно обрабатывала весь Vite module graph при каждой смене аккаунта.
Сделано: nativeSignIn использует storage текущего app origin; для about:blank
дожидается только commit документа, затем сохраняет synthetic session.
Последний полный /auth navigation сохранён: приложение заново читает session.
Из двух profile-тестов удалён только начальный /auth без assertions: теперь
его полностью обеспечивает nativeSignIn. Проверки публикации, каталога,
фильтров, страниц, доступа и возврата после входа сохраняются без дублирования.
Решение: устранять лишние загрузки, а не увеличивать таймауты/retries или
делить пользовательский контракт ради обхода лимита. Product runtime/PNG прежние.
Проверка: оба profile-сценария повторены3раза в mobile Chromium —6/6; публикация
6.3–7.1сек, пагинация1.3–1.7сек. Это не прямое сравнение с Linux CI: окружения
различаются. Целевые lint/E2E TypeScript passed.
Открыто: связанные сценарии временно не стартовали из-за остановленной Podman
VM/ECONNREFUSED; это не результат их проверки. Повтор и полный check выполняются;
финальный head/CI фиксируются в PR1928. Production не меняется.
Дальше: проверить новый head полным CI, не повторять push во время прогона.

Уточнение локального ограничения: повторный запуск существующей Podman VM
не удержал соединение с PostgreSQL; связанные3 сценария завершились до
тестовых действий с ECONNREFUSED/ECONNRESET. Их локальная проверка не засчитана.
Ресурсы/connection settings VM не менялись; обхода удалённой БД нет.
В старом CI c09dd9c0 auth завершился success; единственная failure — Chromium2/2.

Итог перед push: полный `npm run check` passed —336 files/3007 unit tests,
coverage81.48/76.48/81.05/86.07 при прежних порогах; API1551 passed/242 skipped,
lint/typecheck/policies/build passed. Profile Chromium6/6; связанные3 локально
не проверены из-за Podman, обязательные Chromium/WebKit CI lanes сохраняются.
Workflow docs и diff whitespace passed. Итог нового CI — в PR1928.

После внешнего merge main f1648bd0 полный локальный check выявил независимую
гонку ProgramFeedbackForm.test: ожидание spy submit уже выполнено, но React
ещё показывает «Сохраняем…» до commit результата. Существующий status assertion
теперь ожидает UI через waitFor; payload assertion и оба случая сохраняются.
Продуктовый Assistant/промпты не меняются. Это конкретный локальный failure,
а не основание отключать проверку или увеличивать её таймаут. Новый полный
check выполняется после исправления, итог head/CI остаётся в PR1928.

Итог после f1648bd0 и исправления async assertion: полный `npm run check`
passed —337 files/3031 unit tests, coverage81.52/76.53/81.09/86.12;
API1551 passed/242 skipped, lint/typecheck/policies/build passed.
Целевые ProgramFeedbackForm2/2, workflow docs и diff whitespace passed.
Новые сценарии не добавлены; прежние состояния, роли и проверки сохранены.
