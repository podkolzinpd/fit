# Fit — текущее состояние проекта

## Очистка frontend-релизов — 2026-10-06

PR#1467 слит223cb7d4; CI37502696391 success. Plan37521471733 success:771файл+121manifest/241207827байт,56релизов сохранены, overlap0; raw CLI size исправлен fail-closed. Второй gate: HEAD last_modified_at/секунды vs list last_modified/миллисекунды. Follow-up исправлен локально:retention23/23,hosting115/115,check2412/API1176+92 skipped/build passed; база28309ef4 после #1468, ETag/размер сохранены.
Ежедневное удаление пока выключено. По подтверждению владельца frontend deployer получил ACL READ+WRITE только frontend-бакета и policy DeleteObject releases/*; DeleteObjectVersion явно запрещён, wildcard AWS-service правило исключает deployer. IAM uploader/viewer сохранены; без editor/admin/media/state/БД. Readback ACL2/policy8/versioning enabled подтверждён; текущий/предыдущий, последние3дня и общие файлы защищены; apply ещё не был.

## YAFIT-595 — третий тренер Fit Lime — 2026-10-06

Migration127 задаёт лимит трёх тренеров и owner-only подключение к Fit Lime/Schedule V2 через IAM runner. Новый ключ передаётся repository secret, не публикуется; два прежних назначения сохраняются. Привязка — при новом входе через Яндекс. Клиентский пилот не меняется.
PR#1461: первый CI37469475413 success; rebase от `85584a47`, повторный check2412/1176/build, clean-chain127/actor92/92, rollback/reapply3→2→3 и legacy1511/1511 зелёные. CI обновлённой ветки повторяется. Общая локальная БД сохранена: старый drift migration112. Владелец явно разрешил закрытый GitHub Secret; ключ сохранён, подключение выполняется после зелёного CI/штатной выкладки. Реальной сессии третьего тренера нет. План: design/YAFIT_595_FIT_LIME_THIRD_TRAINER.md.

## Вес в выпадах, удержаниях и проходках — 2026-10-06

PR#1464:14refs — шесть выпадов/зашагиваний кг+повторы, три удержания кг+время, ВиПР кг+повторы с выбором кг+время, четыре проходки кг+дистанция/необязательное время без темпа. Plan/fact/review/Live/summary/copy сохраняют подходы/историю. План: design/EXERCISE_LOAD_FIELDS_20261006.md.
Migration128 исправляет только editable snapshots шести выпадов, version+1 однократно. Check2449/API1176/build и clean PostgreSQL17/actor98/98 прошли; shared local:verify блокирован старым drift112, без сброса.
WebKit5/5: plan→Live/reload удержания/проходки, выпады, дроби, ВиПР, light/dark390/430/1440. CI37525942947/Android37525942882 зелёные; после нового main повторяются. Владелец разрешил#1464 раньше красного#1463, не меняя его. Production пока не менялся: CI/миграция/deploy/readback впереди.

## Клиентский Lime: остатки заполненного прогресса — 2026-10-06

#1459/#1462/#1465 слиты; release85584a47 CI37486398084/Android37486397713 success; deploy37488943876 verified206/readback12/YS Geo2. Published8cases. Новый скриншот подтвердил analysis/goal18px и sheet18px/close14px; база223cb7d4 после #1467, plan CLIENT_LIME_PROGRESS_FILLED_20261006.md. V16–19 используют cards/7PRO headers32px, sheet40px/close44круг, tertiary14/500/44; только client scope. WebKit13/13 D/L390/430/pending/error/PRO/off-control passed; Chromium13/13; check2412/API1176+92 skipped/policy/hosting/build success. hosting114/114 passed; PR1468 слит28309ef4, CI37522475372/Android37522475377 success, main CI/выпуск выполняются. Раскрытие всех7 ПРО подтвердило V20 D/L390/430: body-mode14/pseudo9/7px; план CLIENT_LIME_BODY_MODE_20261006.md, существующий segmented28/24/44 только client, WebKit16/16/Chromium16/16 passed: все7 открыты, empty/filled mode, другой клиент/trainer; check2412/API1176+92 skipped/policy/hosting114/build success; rebasec39bc3fc после1469, UI/E2E/package diff пустой, hosting115 passed; CI/readback далее. Выпуск28309ef4 не активирован: main обновился. Полное покрытие не заявляется; НЕ ПРОВЕРЕНО остаётся в аудите. Физический iPhone/удалённые LLM/SpeechKit/Store-релиз не подтверждены.

## Фактическая длительность тренировки — 2026-10-06

Ветка `codex/workout-duration-edit-20261006` от `ba911a31`, обновлена до `9a8734d9`; один PR, полный выпуск разрешён.
План/приёмка: design/WORKOUT_ACTUAL_DURATION_EDIT_20261006.md, пункты1–5 сохранены.
Быстрый completed-ввод обеих ролей: необязательные минуты с дробями/черновиком;
done detail/report: отдельный диалог, manual выше Live, очистка возвращает timer.
Migration126/PUT duration: только время/версия, visible done actor, без прав на план.
Clean PostgreSQL17 chain и actor92/92 passed; timestamps/sets неизменны, calories refresh.
WebKit7/7 + visual Darwin/Linux12/12; check stages2417/1254/build passed с2workers/local15s.
local:verify блокирован старой историей000111/112; общая база не сбрасывалась, использована изолированная55434. CI/merge и API/frontend rollout — гейты; до подтверждения production не выпущено.

## Аудит БД и дублирующие индексы — 2026-10-06

#1434 защищает фото, #1449 — snapshot, #1450 — серверную pagination; все слиты. #1454 слит `4eab2e22`: статистика карточки — один actor SQL-агрегат, ИИ/Progress/ближайшие назначения сохранены. CI37384227309, API37384227223/frontend37385582939 success. Планы — DATABASE_AUDIT в docs/design.
PR#1457 слит: migration125 удаляет два дублирующих position индекса с проверкой каталога и lock wait3s; UNIQUE DEFERRABLE/данные/RLS/API сохранены.
Clean PostgreSQL17 chain/actor91/91, check2409/1159/build и WebKit3/3 passed;
local:verify блокирован прежней Supabase-миграцией, baseline не сбрасывался.
План: DATABASE_AUDIT_DUPLICATE_INDEXES_20261006.md; production API200 до выпуска.

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
Локальная регрессия416/416 WebKit/Chromium; Android debug run37232171038
success, iOS собран/установлен/запущен в симуляторе. Store-релиза и проверки
диктовки на физическом устройстве не было; relay smoke её не заменяет.

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

<<<<<<< HEAD
Frontend: Yandex Gateway/Storage, fit-training.ru; API/auth/БД: Yandex PostgreSQL17.
Vercel — legacy redirect; новые Vercel deployments/Supabase migrations запрещены.
Supabase — только legacy recovery/media/test, не fallback поверх новых Yandex writes.
Pilot не авторизует данные: RLS/ownership на сервере. Откат Lime: CLIENT_LIME_ENABLED=false + deployment.
SpeechKit transcript устраняет финальные повторы, сохраняет реплики и разделяет упражнения с параметрами.
История/чеклисты — PRODUCT_WIKI, docs/design и Git.
=======
Frontend: Yandex API Gateway/Object Storage, fit-training.ru. API/auth/данные: Yandex Cloud PostgreSQL17. Vercel — legacy redirect; новые Vercel deployments и Supabase migrations запрещены. Supabase остаётся legacy recovery/media/test зависимостью; нельзя включать его обратно поверх новых Yandex writes.
Клиентский pilot — только оформление, не авторизация данных. RLS/ownership проверяются сервером. Откат: CLIENT_LIME_ENABLED=false и новый frontend deployment.
Голосовой transcript устраняет перекрывающиеся финальные фрагменты SpeechKit, сохраняет границы реплик и разделяет однословные упражнения с параметрами.
Предыдущая продуктовая история и полные чеклисты — PRODUCT_WIKI, docs/design и Git.
>>>>>>> 91aaa1e6 (feat(workouts): allow narrow actual duration correction)

## Ранее открытые post-cutover задачи

Ниже — незакрытые пункты прежнего snapshot; в этой UI-задаче не перепроверялись.
1. Выполнить успешный media migration без `allow-missing` для оставшихся chat
   и custom-exercise objects; Vital Gym Pro уже перенесён и полностью проверен.
2. Добавить Yandex custom-exercise photo adapter.
3. На время диагностического отката #1144 frontend снова создаёт Supabase SDK
   при импорте и подписывается на Auth; `VITE_SUPABASE_*` обязательны для запуска.
   Supabase auth events не инициализируют legacy-профиль в Yandex-only режиме;
   отсутствие Yandex session не выбирает Supabase. Legacy SDK может обновлять
   сохранённый auth token; это не dual-write и не перенос данных обратно. Переменные и серверные bridge secrets для recovery/media пока не удалять.
4. Провести ручной E2E matrix с реальными тестовыми identities: linked trainer,
   linked client, recovery старого email-only профиля, новый Yandex-only аккаунт
   и оба invitation path. Автоматизированы серверные контракты, production auth
   DOM, PKCE redirect и unauthenticated guards; реальный OAuth callback в этом
   cutover-сеансе не выполнялся.
5. Провести backup restore drill, повторить authenticated AI summary и push
   smoke. До завершения observation window Supabase не удалять: write gate
   остаётся paused, а обратной миграции Yandex writes нет.

## Отложено
- DataLens/Telegram/Tracker отложены; HA replica нужна только по SLA; APNs и Android/FCM не входят в Web Push cutover.
- Android: добавлен Capacitor-проект и команда локальной debug-сборки для будущей публикации в RuStore. Android origin закреплён как `https://localhost` и включён в API CORS allowlist deployment workflow. Внешний браузер Yandex ID не может вернуть OAuth-код на `https://localhost` в WebView, поэтому Android использует deep link `com.coachspace.fit://auth/yandex/callback` с PKCE state-проверкой. Этот Redirect URI зарегистрирован в Yandex OAuth 2 октября; прежние URI сохранены. Работающий вход ещё не подтверждён: нужна проверка на устройстве. Ручной GitHub Actions job собирает production-configured debug APK для проверки входа; это не release-сборка. Подпись release и публикация не выполнялись.
