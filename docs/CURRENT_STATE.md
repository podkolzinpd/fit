# Fit — текущее состояние проекта

## Часовой эксперимент frontend Gateway — 2026-10-05

PR #1433: private Cloud Function Node.js 22, 128 МБ, максимум 60 секунд,
часовой timer; `/healthz` и `/auth` на одном IP, без PII и сообщений в чат.
Manual-only workflow по умолчанию inspect; enable требует согласованной
стоимости. После 24 часов HTTP прекращается; disable приостанавливает timer.
Candidate smoke и pinned tag защищают переключение. Ресурсы не созданы,
эксперимент не включён; Cloud invoke и эффект не проверены. Оценка — около
21 ₽/31 день при лимите 60 секунд и повторе каждого вызова, трафик/логи отдельно.
Подробности — OPERATIONS.md; причин медленного HTML эксперимент ещё не доказал.
IAM: deployer имеет functions.editor, не functions.admin. Нужен bootstrap
private-функции, functions.admin только на неё и scoped timer invoker; прав
не меняли. UI/auth/API/БД не меняются; независимый внешний probe сохраняется.
Локальный check: frontend2371, API1063 passed/71 skipped, hosting112.
Общий timeout E2E на 12 переходах устранён разделением тестов без ослабления
проверок/timeout/retries: targeted48/48, полный WebKit236/236. CI37294091210
зелёный. После sync с main `6f7e3cea` полный check и E2E52/52 зелёные;
новый CI остаётся гейтом.

## Активная задача — визуальное завершение клиентского Lime

Владелец продукта 5 октября разрешил реализацию, PR и production-выкладку всей
серии. Принятый план: `docs/design/CLIENT_LIME_VISUAL_COMPLETION_20261005.md`.
Исправляются оставшиеся визуальные дефекты уже выпущенного пилота только для
`budoha1@yandex.ru`; действующие сценарии и тренерский UI сохраняются.
Первый PR (`e40a5497`, ветка `feat/client-lime-visual-foundation-20261005`)
исправляет геометрию действий и нижние отступы под навигацию; отправлен в
GitHub, локальные проверки и WebKit приёмка прошли. Второй PR убирает
многослойные рамки из списков плана и истории, раскрывает длинные названия;
полный check и мобильная WebKit/Chromium приёмка прошли; ветка `853d3bff`
отправлена. Третий PR выравнивает вторичные действия обычного Live в обеих
темах без изменения состояния подходов; полный check и 8 мобильных браузерных
проверок прошли. До слияния и production-выпуска PR не считаются завершёнными.

## Ачивки — YAFIT-594

План: design/ACHIEVEMENT_PROGRESS_STATES_20261004.md. #1425/#1427/#1428
слиты: два состояния, отдельная полоска, сквозная приёмка 24→25 тренировок,
error/retry, повторный вход, согласованность «Кабинета»/«Прогресса» и safe area.
Assets/award logic сохранены; mobile WebKit/Chromium прошли. CI37241760363,
deployment37242590195 и readback37260193474 успешны, ACTIVE на `6810452f`.

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

## Завершённая задача — семь исправляющих PR по клиентскому видео

Acceptance: `docs/design/CLIENT_LIME_VIDEO_REMEDIATION_20261004.md`.
Все семь PR слиты и выпущены, проверки — выше; история в Git и плане.
Принята существующая Lime identity (YS Geo/REM), пилот не расширяется.
Текущий SpeechKit relay прошёл smoke с `done` после stop; старый recovery
адрес не относится к нему. Production browser ограничен политикой среды,
обход не выполнялся. Внешний YAFIT не настроен в доступном Tracker-контуре;
неподходящие credentials не используются.

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
