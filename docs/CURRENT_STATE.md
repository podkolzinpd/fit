# Fit — текущее состояние проекта

## Кардио: фактическое время равно плану — 2026-10-07

YAFIT-598: прежний Live dedupe сравнивал только числа и пропускал явное подтверждение времени, совпавшего с планом. Ключ автосохранения учитывает источник метрик: `entered` доходит до БД и участвует в расчёте калорий; сама формула и схема БД не меняются. Регрессии закрывают выбор того же значения в поле, сохранение факта и DB-оценку при неизменном числе.

## YAFIT-597 — надёжность оплат — 2026-10-07

План: `design/FINANCE_PAYMENTS_20261006.md`, GitHub#1472, PR1#1473 / PR2#1475. Владелец разрешил оба выпуска по общей очереди. PR1 добавляет actor-scoped request receipts и фактическую дату начальной оплаты (migration130/v2, старые записи и контракты сохранены). Clean PostgreSQL17 chain/actor93/93, UI/repository64/64 и WebKit error/retry2/2 passed. `local:verify` ограничен прежним drift общей базы migration112; общая база не сбрасывалась. Параллельный check ловил локальные таймауты соседних тестов; последовательный API1177/1177 и frontend-покрытие надстройки PR2 —2419/2419 passed без изменений тестов; policy/db-types/iOS/media/hosting/build и CI API/RLS/app-tests зелёные. После #1464 clean-chain/actor99/99; после #1471/#1463 (main07c9dcb1) финальная clean-chain/actor100/100 и finance/Yandex repository64/64 passed. CI финального head314915c5 (37546811112) success; PR1#1473 слит3bea5635. API/migration130 rollout выполняется, production ещё не подтверждён; реальная финансовая сессия клиента не проверена.

## Полный свайп клиентов — 2026-10-06

PR#1471 слит2867f1d9; exact-head CI37537752452/main CI37541769868/Android37541769919 success. Yandex production37543515079 activation/smoke/readback success; public index/sw/manifest/JS hashes совпали, оба full-swipe markers опубликованы. Trusted production bundle206files проверен внутри iOS binary; sync/build/install/launch собственного simulator прошли. Длинный свайп архивирует при отпускании; короткий открывает кнопку, обратный/вертикальный/cancel не меняют данные. Ownership/version/pending/error/undo сохранены. Владелец подтвердил «работает» на своём устройстве; это не полная физическая Safari/PWA-матрица. Прежняя automation-3 отключена.

## Оформление свайпа клиентов — 2026-10-07

PR#1479, план design/CLIENT_SWIPE_PRESENTATION_20261007.md. Только оформление: короткая нейтральная панель с иконкой архива, прежний danger-акцент после порога, читаемый pending, feedback с подтверждением/Вернуть44px; на телефоне действия отдельной строкой. Механика/API не меняются; другие жесты только предложены. Component77/77; browser20/20 (Chromium touch/WebKit mouse, light/dark/Lime320/390/430/1440, long-name/reduced-motion/focus/contrast) passed, screenshots просмотрены. Check на90435247: frontend2475/API1178+100 skipped/policy/hosting115/build passed; финальный build повторён. После переноса на mainbfe826b3 combined77/browser20 повторно passed. CI текущего head/новый production ещё не подтверждены.

## YAFIT-597 — интерфейс оплат — 2026-10-07

PR2#1475 добавляет видимое «Уже оплачено», «Вся сумма», дату получения и прямую оплату остатка в карточке; локальная история использует действующие edit/delete формы с подтверждением суммы и даты. Кнопки после полей, единая геометрия Mono/Lime; исправлен потерянный первый тап при blur клавиатуры; форма закрывается после обновления остатка, исключая прежнюю сумму при быстром повторном открытии. Component23/23, WebKit18/18 (320/390/430/1440, light/dark/focus400), coverage283 files/2419 tests и build passed. Обычный параллельный check ловил соседние таймауты ExercisePicker, последовательный набор прошёл без ослаблений. Production и физический iPhone пока не подтверждены. План: `design/FINANCE_PAYMENTS_20261006.md`.

## Очистка frontend-релизов — 2026-10-07

PR#1467 и #1469 слиты; обязательный CI зелёный. Исправлены реальные форматы YC CLI: отсутствующий размер допускается только у подтверждённого пустого folder marker; HEAD использует last_modified_at с секундной точностью, сохраняя точный ETag/размер. Retention23/23, hosting115/115, npm run check (frontend2412/API1176+92 DB skipped/build) passed; Yandex DB проверена в CI.
Штатная ежедневная очистка включена (целевое время 06:17 МСК; scheduler может задерживать запуск). Первый guarded apply завершён успешно: https://github.com/podkolzinpd/fit/actions/runs/37527012718; каждый DELETE подтверждён, gateway/site smoke passed, backup artifact сохранён. Текущий/предыдущий, последние3дня и общие файлы сохранены; версии не purged, прежнее lifecycle удаляет нетекущие версии через3дня. Независимый static smoke: auth/JS/CSS/sw на обоих frontend-адресах HTTP200 и одинаковые bytes; БД/media/state не затрагиваются.

## YAFIT-595 — третий тренер Fit Lime — 2026-10-06

Migration127 задаёт лимит трёх тренеров и owner-only подключение к Fit Lime/Schedule V2 через IAM runner. Новый ключ передаётся repository secret, не публикуется; два прежних назначения сохраняются. Привязка — при новом входе через Яндекс. Клиентский пилот не меняется.
PR#1461: первый CI37469475413 success; rebase от `85584a47`, повторный check2412/1176/build, clean-chain127/actor92/92, rollback/reapply3→2→3 и legacy1511/1511 зелёные. CI обновлённой ветки повторяется. Общая локальная БД сохранена: старый drift migration112. Владелец явно разрешил закрытый GitHub Secret; ключ сохранён, подключение выполняется после зелёного CI/штатной выкладки. Реальной сессии третьего тренера нет. План: design/YAFIT_595_FIT_LIME_THIRD_TRAINER.md.

## Вес в выпадах, удержаниях и проходках — 2026-10-06

PR#1464:14refs — шесть выпадов/зашагиваний кг+повторы, три удержания кг+время, ВиПР кг+повторы с выбором кг+время, четыре проходки кг+дистанция/необязательное время без темпа. Plan/fact/review/Live/summary/copy сохраняют подходы/историю. План: design/EXERCISE_LOAD_FIELDS_20261006.md.
Migration128 исправляет только editable snapshots шести выпадов, version+1 однократно. Check2449/API1176/build и clean PostgreSQL17/actor98/98 прошли; shared local:verify блокирован старым drift112, без сброса.
WebKit5/5: plan→Live/reload удержания/проходки, выпады, дроби, ВиПР, light/dark390/430/1440. CI37525942947/Android37525942882 зелёные; после нового main повторяются. Владелец разрешил#1464 раньше красного#1463, не меняя его. Production пока не менялся: CI/миграция/deploy/readback впереди.

## Клиентский Lime: остатки заполненного прогресса — 2026-10-06

#1468/#1470 (V16–20) опубликованы и подтверждены web/native-симулятором; исходные акты сохранены. PR1478 закрывает V21/P1: results select16/48/YS Geo/tokens/arrow и V22/P0: light close SVG фото-портала через existing brightness(0), public trainer/chat. План/до-после: design/CLIENT_LIME_RESULTS_FIELDS_20261007.md; полный реестр: client-lime-migration-audit.md. На прежнем head5b0a0d5b CI37547090059/Android37547090075 success, Chromium98/98/WebKit23/23 и check2465/API1177+99 skipped/build passed. После merge1476 (90435247) ветка обновлена, ownCSS прежний; свежие проверки и выпуск обязательны. Пользователь прямо разрешил1478 после1476 без ожидания1477. V21–22 до merge/deploy/readback не доставлены. Другие НЕ ПРОВЕРЕНО сохраняются: физический iPhone/native pilot login, внешние OAuth/LLM/SpeechKit/Store. Новая палитра/сценарии/trainer/nonpilot не вводятся.

## Фактическая длительность тренировки — 2026-10-06

PR#1463 включает main2867f1d9 (#1464/#1474/#1471); полный выпуск повторно разрешён7октября. План design/WORKOUT_ACTUAL_DURATION_EDIT_20261006.md, пункты1–5 сохранены. Ввод#1357 переиспользован; narrow done duration не даёт прав на план/подходы. Migration126/PUT: время+версия, calorie refresh; timestamps/sets неизменны, manual выше Live, очистка возвращает timer. Исправлены старые E2E-подписи, пустая колонка и геометрия клавиатуры (эмуляция, не физический iPhone). Full check: frontend2456/API1177/build/policy success; task-only PostgreSQL17 на55437actor99/99 и late126 после128 прошли, legacy2/2. WebKit/Chromium38/38; light/dark390/430/trainer1440 просмотрены. CI37542191860:21 gates green, WebKit два старых sections430 превысили общий30s. Trace подтвердил deadline; разделены на6+6страниц/detail без удаления assertions/изменения лимитов. Новый CI, merge, API/frontend rollout/readback и свежий iOS ещё гейты; production не выпущено. Общая БД сохранена (drift112).

## Аудит БД и дублирующие индексы — 2026-10-06
#1434 защищает фото, #1449 — snapshot, #1450 — серверную pagination; все слиты. #1454 слит `4eab2e22`: статистика карточки — один actor SQL-агрегат, ИИ/Progress/ближайшие назначения сохранены. CI37384227309, API37384227223/frontend37385582939 success. Планы — DATABASE_AUDIT в docs/design.
PR#1457 слит: migration125 удаляет два дублирующих position индекса с проверкой каталога и lock wait3s; UNIQUE DEFERRABLE/данные/RLS/API сохранены.
Clean PostgreSQL17 chain/actor91/91, check2409/1159/build и WebKit3/3 passed; local:verify блокирован прежней Supabase-миграцией, baseline не сбрасывался. План: DATABASE_AUDIT_DUPLICATE_INDEXES_20261006.md; production API200 до выпуска.
PR#1484 — диагностика runtime-пула; план design/DATABASE_POOL_DIAGNOSTICS_20261007.md. Агрегаты acquisition/queue/occupied/errors без PII/SQL; лимиты5/20, SESSION/scaling/RLS не меняются. Console readback7октября: runtime20/owner5, SESSION, API8/min1, dispatcher1. Targeted16/16, check frontend2477/policy/hosting115 passed; API compression test упёрся в timeout5s, весь API последовательно1186/1186+100 DB skipped прошёл без изменения assertions/timeout; builds passed. CI37602032366/be207ccc success, clean-chain/actor100/100. Ждёт раннего активного#1483, обновления от main/повторного CI; production ещё не выпущено. 3 API-пула + dispatcher могут занять20 без резерва; это риск, не доказанная причина502.

## Часовой эксперимент frontend Gateway — 2026-10-05
#1433: private Node.js22/128МБ/60s, часовой timer `/healthz`/`auth` на одном IP; без PII/чатов.
Manual inspect, enable требует согласования стоимости; через24ч HTTP прекращается, disable останавливает timer. Candidate smoke/pinned tag защищают переключение.
Ресурсов/активации нет, invoke/эффект не проверены, причина медленного HTML не доказана.
Оценка21₽/31день при60s/повторах, трафик/логи отдельно; OPERATIONS.md. Нужен private bootstrap, functions.admin только на функцию и scoped invoker; deployer пока functions.editor.
Прав/UI/auth/API/БД не меняли, внешний probe сохранён. Check frontend2371/API1063,
DB71 skipped/hosting112; E2E разделены без ослаблений:48/48, WebKit236/236; CI37294091210 success. На `6f7e3cea` check/E2E52/52 зелёные; далее CI-гейт.

## Клиентский Lime — визуальный выпуск завершён
Владелец продукта 5 октября разрешил реализацию, PR и production-выкладку всей серии. Принятый план: `docs/design/CLIENT_LIME_VISUAL_COMPLETION_20261005.md`. Исправляются оставшиеся визуальные дефекты уже выпущенного пилота только для `budoha1@yandex.ru`; действующие сценарии и тренерский UI сохраняются. PR #1435–#1445 слиты в `main` после зелёных CI: общие действия и отступы навигации, списки плана и истории, обычный Live, круги, завершение, создание, кабинет и календарь, прогресс, профиль, чат и ассистент. При последовательном переносе каждый PR сохранял только свою правку; тренерский UI, голосовой поток и серверные контракты не менялись. В CI учтён существующий флаг программы ассистента; длинный тренерский маршрутный тест отдельно разделён в PR #1433. PR #1445 добавил сквозные проверки свободного места над нижней навигацией после завершения и в истории; PR #1452 увеличил лимит CI для полного WebKit прогона. Локально 102/102 Client Lime сценариев на WebKit/Chromium и полный `npm run check` прошли. CI итогового `main` прошёл (37376020377); актуальный CI 37378543406 и production deployment 37380030323 подтвердили выпуск `7eb6c56f`: 206 объектов, активацию, smoke и readback. Визуальная матрица и ограничение ручной проверки на физическом iPhone записаны в `docs/design/CLIENT_LIME_RELEASE_ACCEPTANCE_20261005.md`.

## Ачивки — YAFIT-594
План: design/ACHIEVEMENT_PROGRESS_STATES_20261004.md. #1425/#1427/#1428
слиты: два состояния, отдельная полоска, сквозная приёмка 24→25 тренировок,
error/retry, повторный вход, согласованность «Кабинета»/«Прогресса» и safe area.
Assets/award logic сохранены; mobile WebKit/Chromium и CI/deployment/readback выше успешны.
Текущая UI-задача: согласованные тексты всех 15 наград «Регулярность», общая
подсказка про разные дни и единицы прогресса. Правила награждения не меняются;
план и приёмка: design/ACHIEVEMENT_REGULARITY_COPY_20261005.md.

## Выпуск клиентских исправлений — 2026-10-05
Семь PR #1408/#1410/#1411/#1412/#1413/#1415/#1417 слиты после зелёного CI. #1426 дал каждому smoke-запросу отдельный 20-секундный таймер, сохранив проверки файлов и откат. Две выкладки 0ca85201 откатились на `/healthz`; причина сетевого таймаута не доказана. CI37237418210/deployment37238448692 выпустили 8fc46a31; readback37238977765 ACTIVE, warm37238988653 HTTP200. Затем выпущены достижения: frontend `6810452f`, CI37241760363, deployment37242590195 и readback37260193474 success/ACTIVE.

Пилот клиентского Lime по-прежнему только `budoha1@yandex.ru`.
Локальная регрессия416/416 WebKit/Chromium; Android debug run37232171038 success, iOS собран/установлен/запущен в симуляторе. Store-релиза и проверки диктовки на физическом устройстве не было; relay smoke её не заменяет.

Acceptance: design/CLIENT_LIME_VIDEO_REMEDIATION_20261004.md; Lime identity/pilot сохранены. SpeechKit smoke `done` прошёл, старый recovery не относится к relay.
Production browser ограничен без обхода; внешний YAFIT не настроен, чужие credentials не используются.
## Следующий персональный pilot — ссылки на функции в Assistant

Пользователь разрешил реализацию, PR, слияние зелёного CI и production-выпуск только для native Yandex login `brainbuster98`. План и критерии: `docs/design/ASSISTANT_FEATURE_LINKS_PILOT_20261004.md`.
Сервер отвечает на навигационные вопросы только reviewed internal link markers, frontend отклоняет внешние и неизвестные пути. Доступ требует одновременно environment switch и привязанный hash allowlist; старая FIT-сессия обновляется через защищённый `/auth/yandex/refresh-assistant` без предварительного выхода. До успешных CI, API/migration rollout и frontend activation задачу нельзя считать выпущенной.

Исправление от 6 октября: в production Yandex-orchestrator запись тренировки
целиком уходит на главный экран роли. Прямая диктовка больше не создаёт
record-workout card в Assistant, старый активный черновик не восстанавливается и
не блокирует программу.

Следующее уточнение интерфейса от 6 октября: для feature-links pilot стартовый
экран и ответ «что ты умеешь» показывают только фактические возможности —
составление программы, навигацию по приложению и короткий разговор о фитнесе и
спорте. Стартовые примеры: программа, прогресс, восстановление и возможности;
запись тренировки обозначается как переход на главную.

## Постоянные границы

Frontend: Yandex Gateway/Storage, fit-training.ru; API/auth/БД: Yandex PostgreSQL17.
Vercel — legacy redirect; новые Vercel deployments/Supabase migrations запрещены.
Supabase — только legacy recovery/media/test, не fallback поверх новых Yandex writes.
Pilot не авторизует данные: RLS/ownership на сервере. Откат Lime: CLIENT_LIME_ENABLED=false + deployment.
SpeechKit transcript устраняет финальные повторы, сохраняет реплики и разделяет упражнения с параметрами.
История/чеклисты — PRODUCT_WIKI, docs/design и Git.

## Ранее открытые post-cutover задачи

Ниже — незакрытые пункты прежнего snapshot; в этой UI-задаче не перепроверялись.
1. Выполнить успешный media migration без `allow-missing` для оставшихся chat и custom-exercise objects; Vital Gym Pro уже перенесён и полностью проверен.
2. Добавить Yandex custom-exercise photo adapter.
3. На время диагностического отката #1144 frontend снова создаёт Supabase SDK при импорте и подписывается на Auth; `VITE_SUPABASE_*` обязательны для запуска. Supabase auth events не инициализируют legacy-профиль в Yandex-only режиме; отсутствие Yandex session не выбирает Supabase. Legacy SDK может обновлять сохранённый auth token; это не dual-write и не перенос данных обратно. Переменные и серверные bridge secrets для recovery/media пока не удалять.
4. Провести ручной E2E matrix с реальными тестовыми identities: linked trainer, linked client, recovery старого email-only профиля, новый Yandex-only аккаунт и оба invitation path. Автоматизированы серверные контракты, production auth DOM, PKCE redirect и unauthenticated guards; реальный OAuth callback в этом cutover-сеансе не выполнялся.
5. Провести backup restore drill, повторить authenticated AI summary и push
   smoke. До завершения observation window Supabase не удалять: write gate
   остаётся paused, а обратной миграции Yandex writes нет.

## Отложено
- DataLens/Telegram/Tracker отложены; HA replica нужна только по SLA; APNs и Android/FCM не входят в Web Push cutover.
- Android: добавлен Capacitor-проект и команда локальной debug-сборки для будущей публикации в RuStore. Android origin закреплён как `https://localhost` и включён в API CORS allowlist deployment workflow. Внешний браузер Yandex ID не может вернуть OAuth-код на `https://localhost` в WebView, поэтому Android использует deep link `com.coachspace.fit://auth/yandex/callback` с PKCE state-проверкой. Этот Redirect URI зарегистрирован в Yandex OAuth 2 октября; прежние URI сохранены. Работающий вход ещё не подтверждён: нужна проверка на устройстве. Ручной GitHub Actions job собирает production-configured debug APK для проверки входа; это не release-сборка. Подпись release и публикация не выполнялись.
