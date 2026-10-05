# Fit — текущее состояние проекта

## Аудит БД первый шаг — 2026-10-05

Исправлена гонка первых `saveDraft`/`uploadPhoto`: конкурентный создатель не
перезаписывает метаданные, а перечитывает строку под блокировкой. Схема, права,
API/UI и версия первого профиля 1 не меняются. На чистом Podman PostgreSQL17
старый код провалил три гонки; исправление прошло 76/76 actor/RLS, полный
check и WebKit2/2. local:verify блокирует отсутствующая историческая Supabase
миграция, baseline не сбрасывался. План: design/DATABASE_AUDIT_PROFILE_PHOTO_CONCURRENCY_20261005.md.
CI ещё впереди, production не менялся. Далее отдельно — согласованное чтение тренировки, затем серверная пагинация истории.

## Ачивки — YAFIT-594

Все три PR #1425/#1427/#1428 выпущены: два состояния → отдельная полоска →
сквозная приёмка. План: design/ACHIEVEMENT_PROGRESS_STATES_20261004.md.
Исходные assets, award logic и три колонки сохранены. Mobile WebKit/Chromium
light/dark 390/430, переход 24→25, retry/relogin, согласованность двух разделов
и нижний ряд проверены. CI37241760363 и deployment37242590195 success;
readback37260193474 подтвердил ACTIVE на `6810452f`. История — Git и PR.

## Выпуск клиентских исправлений — 2026-10-05

Все семь продуктовых PR (#1408, #1410, #1411, #1412, #1413, #1415, #1417)
слиты после зелёного CI. Дополнительный PR #1426 исправил повтор запросов
при frontend smoke: каждый запрос получает собственный 20-секундный таймер;
проверки файлов и автоматический откат сохранены. Первые две попытки
выкладки 0ca85201 откатились на таймауте `/healthz`; причина сетевого
таймаута не доказана, но повторные запросы больше не используют отменённый
сигнал. CI37237418210 и deployment37238448692 успешно выпустили 8fc46a31.
Штатный readback37238977765 подтвердил ACTIVE; warm37238988653 получил
HTTP 200 для `/healthz` и HTML. Следующие PR по достижениям также успешно
выпущены. Текущий production frontend: `6810452f`, CI37241760363,
deployment37242590195 и readback37260193474 success/ACTIVE.

Пилот клиентского Lime по-прежнему только `budoha1@yandex.ru`.
Финальная локальная регрессия исправлений: 416/416 WebKit/Chromium.
Android production-config debug APK: run37232171038 success; iOS:
сборка, установка и запуск в симуляторе. Это не публикация подписанных
приложений в магазинах. Настоящая диктовка на физическом устройстве не
проверена; симулятор и relay smoke её не заменяют.

## Ускорение CI — 2026-10-04

В отдельной ветке Fit Lime использует два worker в прежних двух jobs;
каждый устанавливает только свой Chromium/WebKit. На baseline `e1578092`
282/282 browser cases и полный `npm run check` прошли. Сравнение одинаковых
141 WebKit cases без retries: один worker 234,7 s, два 129,3 s (−45%);
оба без ошибок/skips/flaky. Это локальный замер, не гарантия времени GitHub
runners. После обновления от main `59887b5c` 358/358 Chromium/WebKit cases
прошли с двумя worker. Полный `npm run check` с `VITEST_MAX_WORKERS=2`
зелёный: 2352 frontend / 1049 API, 70 DB cases штатно skipped.
CI обновлённой ветки остаётся гейтом выпуска.
Первый Linux CI выявил общий 30 s timeout обхода 19 узких экранов;
те же проверки разделены по маршрутам без увеличения timeout/retries.
Целевой повтор 48/48 Chromium/WebKit зелёный; полный `check` повторён успешно.

## Завершённая задача — семь исправляющих PR по клиентскому видео

Полное разрешение реализации/merge/deploy получено 2026-10-04.
Неизменяемый acceptance: `docs/design/CLIENT_LIME_VIDEO_REMEDIATION_20261004.md`.
Порядок: 1 черновики → 2 сохранение правок → 3 голос → 4 общие controls →
5 создание → 6 Live → 7 итог и сквозная приёмка. Пилот не расширяется.

Все семь PR слиты после зелёных checks и выпущены. Live явно подтверждает
подходы с pending/error/retry; итог различает zero/partial/full и подтверждённый
факт. Финальный локальный check: frontend2366/API1063, 71 DB skipped;
WebKit190/190, Chromium27/27, zero4/4, completion/share25/25.
SpeechKit relay прошёл smoke с `done` после stop; timeout старого recovery
адреса не относится к текущему клиенту. #1395/#1398/#1401 уже в main.
Debug APK и iOS simulator собраны, store-релиза и проверки физической диктовки
не было. Lime identity YS Geo/REM сохраняется. Production browser ограничен
политикой, обхода нет. Внешний YAFIT не настроен; план в репозитории.

## Следующий персональный pilot — ссылки на функции в Assistant

Пользователь разрешил реализацию, PR, слияние зелёного CI и production-выпуск
только для native Yandex login `irainbuster98`. План и критерии:
`docs/design/ASSISTANT_FEATURE_LINKS_PILOT_20261004.md`. Сервер отвечает на
навигационные вопросы только reviewed internal link markers, frontend отклоняет
внешние и неизвестные пути. Доступ требует одновременно environment switch и
привязанный hash allowlist; после первого API rollout нужен повторный вход
Yandex ID. До успешных CI, API/migration rollout и frontend activation задачу
нельзя считать выпущенной.

## Постоянные границы

Frontend: Yandex API Gateway/Object Storage, fit-training.ru. API/auth/данные:
Yandex Cloud PostgreSQL17. Vercel — legacy redirect; новые Vercel deployments
и Supabase migrations запрещены. Supabase остаётся legacy recovery/media/test
зависимостью; нельзя включать его обратно поверх новых Yandex writes.
Клиентский pilot — только оформление, не авторизация данных. RLS/ownership
проверяются сервером. Откат: CLIENT_LIME_ENABLED=false и новый frontend deployment.
Голосовой transcript устраняет перекрывающиеся финальные фрагменты SpeechKit,
сохраняет границы реплик и разделяет однословные упражнения с параметрами.
Предыдущая продуктовая история и полные чеклисты — PRODUCT_WIKI, docs/design и Git.

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
