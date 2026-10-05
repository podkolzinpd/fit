# Fit — текущее состояние проекта

## Аудит БД первый шаг — 2026-10-05

PR #1434 сохраняет фото при конкурентных первых `saveDraft`/`uploadPhoto`;
схема, права, API/UI и первая версия 1 не меняются. Старый код провалил три
гонки; исправление прошло PostgreSQL17 actor/RLS76/76, check и WebKit2/2.
local:verify блокирует историческая Supabase-миграция; baseline не сбрасывался.
CI37292335746 зелёный; после sync с новым main нужен повторный CI, production
не менялся. План: design/DATABASE_AUDIT_PROFILE_PHOTO_CONCURRENCY_20261005.md.
Далее отдельно — согласованное чтение тренировки, затем пагинация истории.

## Часовой эксперимент frontend Gateway — 2026-10-05

PR #1433: private Node.js22/128МБ/60s, часовой timer, `/healthz` и `/auth`
на одном IP, без PII/чатов. Manual-only inspect; enable требует согласования
стоимости; через24ч HTTP прекращается, disable приостанавливает timer.
Candidate smoke/pinned tag защищают переключение. Ресурсов/активации нет,
Cloud invoke/эффект не проверены. Оценка21₽/31день при60s и повторе каждого
вызова; трафик/логи отдельно. OPERATIONS.md; причина медленного HTML не доказана.
IAM: deployer имеет functions.editor, не functions.admin. Нужен bootstrap
private-функции, functions.admin только на неё и scoped timer invoker; прав
не меняли. UI/auth/API/БД не меняются; независимый внешний probe сохраняется.
Локальный check: frontend2371/API1063 passed, DB71 skipped/hosting112.
E2E timeout12 переходов устранён разделением без ослаблений: targeted48/48,
WebKit236/236, CI37294091210 зелёный. После sync `6f7e3cea` check/E2E52/52
зелёные; новый CI остаётся гейтом.

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
проверок прошли; ветка `5542b4d7` отправлена. Четвёртый PR уплотняет круги,
ставит действие и меню в одну строку, убирает повтор миниатюры при раскрытой
анимации. Его 8 браузерных проверок и полный check с одним worker прошли;
первый параллельный check упёрся в таймаут worker, оба файла отдельно прошли.
До слияния и production-выпуска PR не считаются завершёнными.

## Ачивки — YAFIT-594

План: design/ACHIEVEMENT_PROGRESS_STATES_20261004.md. #1425/#1427/#1428
слиты: два состояния, отдельная полоска, сквозная приёмка 24→25 тренировок,
error/retry, повторный вход, согласованность «Кабинета»/«Прогресса» и safe area.
Assets/award logic сохранены; mobile WebKit/Chromium и CI/deployment/readback выше успешны.

## Выпуск клиентских исправлений — 2026-10-05

Семь PR #1408/#1410/#1411/#1412/#1413/#1415/#1417 слиты после зелёного CI.
#1426 дал каждому smoke-запросу отдельный 20-секундный таймер, сохранив
проверки файлов и откат. Две выкладки 0ca85201 откатились на `/healthz`;
причина сетевого таймаута не доказана. CI37237418210/deployment37238448692
выпустили 8fc46a31; readback37238977765 ACTIVE, warm37238988653 HTTP200.
Затем выпущены достижения: frontend `6810452f`, CI37241760363,
deployment37242590195 и readback37260193474 success/ACTIVE.

Пилот клиентского Lime по-прежнему только `budoha1@yandex.ru`.
Локальная регрессия416/416 WebKit/Chromium; Android debug run37232171038
success, iOS собран/установлен/запущен в симуляторе. Store-релиза и проверки
диктовки на физическом устройстве не было; relay smoke её не заменяет.

## Завершённая задача — семь исправляющих PR по клиентскому видео

Acceptance: `docs/design/CLIENT_LIME_VIDEO_REMEDIATION_20261004.md`.
Все семь PR выпущены, проверки выше; история в Git/плане. Lime identity
(YS Geo/REM) и пилот сохранены.
Текущий SpeechKit relay прошёл smoke с `done` после stop; старый recovery
адрес не относится к нему. Production browser ограничен политикой среды,
обхода нет; внешний YAFIT не настроен, неподходящие credentials не используются.

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
