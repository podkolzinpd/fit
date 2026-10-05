# Fit — текущее состояние проекта

## Аудит БД третий шаг — 2026-10-05

Первый шаг #1434: `a9b9c8e6`, CI37306986244/API37307751042 success; фото защищены.
Второй шаг #1449 слит на `04eae004`: snapshot; CI37340759203/API37340759274 success.
План WORKOUT_SNAPSHOT в docs/design; frontend37341195922 failure: `fetch failed`.
Третий шаг от `04eae004`, ветка `codex/db-history-pagination`: фильтры клиента,
дат и ID применяются в API до LIMIT, metadata не выбирает историю. listPage
читает одну страницу; полный list для расчётов не усечён. Схема/grants/UI/auth
и Supabase не меняются; frontend deployment уже ждёт matching API rollout.
Полный check зелёный: API1084, PostgreSQL17 actor/RLS83, WebKit4; CI ещё гейт.
Третий шаг ещё не выпущен и в production не проверен.
local:verify блокирован исторической Supabase-миграцией; baseline не сбрасывался.
План: design/DATABASE_AUDIT_HISTORY_PAGINATION_20261005.md.

## Часовой эксперимент frontend Gateway — 2026-10-05

#1433: private Node.js22/128МБ/60s, часовой timer `/healthz`/`auth` на одном IP; без PII/чатов.
Manual inspect, enable требует согласования стоимости; через24ч HTTP прекращается,
disable останавливает timer. Candidate smoke/pinned tag защищают переключение.
Ресурсов/активации нет, invoke/эффект не проверены, причина медленного HTML не доказана.
Оценка21₽/31день при60s/повторах, трафик/логи отдельно; OPERATIONS.md. Нужен private bootstrap,
functions.admin только на функцию и scoped invoker; deployer пока functions.editor.
Прав/UI/auth/API/БД не меняли, внешний probe сохранён. Check frontend2371/API1063,
DB71 skipped/hosting112; E2E разделены без ослаблений:48/48, WebKit236/236; CI37294091210 success. На `6f7e3cea` check/E2E52/52 зелёные; далее CI-гейт.

## Активная задача — визуальное завершение клиентского Lime

Владелец продукта 5 октября разрешил реализацию, PR и production-выкладку всей
серии. Принятый план: `docs/design/CLIENT_LIME_VISUAL_COMPLETION_20261005.md`.
Исправляются оставшиеся визуальные дефекты уже выпущенного пилота только для
`budoha1@yandex.ru`; действующие сценарии и тренерский UI сохраняются.
PR #1435–#1444 слиты в `main` после зелёных CI: общие действия и отступы
навигации, списки плана и истории, обычный Live, круги, завершение, создание,
кабинет и календарь, прогресс, профиль, чат и ассистент. При последовательном
переносе каждый PR сохранял только свою правку; тренерский UI, голосовой поток
и серверные контракты не менялись. В CI учтён существующий флаг программы
ассистента; длинный тренерский маршрутный тест отдельно разделён в PR #1433.
PR #1445 добавляет сквозные проверки свободного места над нижней навигацией
после завершения и в истории. Локально 102/102 Client Lime сценариев на
WebKit/Chromium и полный `npm run check` прошли; матрица и оставшиеся шаги
зафиксированы в `docs/design/CLIENT_LIME_RELEASE_ACCEPTANCE_20261005.md`.
До слияния #1445 и production-проверки серия не считается выпущенной целиком.
## Ачивки — YAFIT-594

План: design/ACHIEVEMENT_PROGRESS_STATES_20261004.md. #1425/#1427/#1428
слиты: два состояния, отдельная полоска, сквозная приёмка 24→25 тренировок,
error/retry, повторный вход, согласованность «Кабинета»/«Прогресса» и safe area.
Assets/award logic сохранены; mobile WebKit/Chromium и CI/deployment/readback выше успешны.
Текущая UI-задача: согласованные тексты всех 15 наград «Регулярность», общая
подсказка про разные дни и единицы прогресса. Правила награждения не меняются;
план и приёмка: design/ACHIEVEMENT_REGULARITY_COPY_20261005.md.

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

Acceptance: design/CLIENT_LIME_VIDEO_REMEDIATION_20261004.md; Lime identity/pilot сохранены. SpeechKit smoke `done` прошёл, старый recovery не относится к relay.
Production browser ограничен без обхода; внешний YAFIT не настроен, чужие credentials не используются.
## Следующий персональный pilot — ссылки на функции в Assistant

Пользователь разрешил реализацию, PR, слияние зелёного CI и production-выпуск
только для native Yandex login `brainbuster98`. План и критерии:
`docs/design/ASSISTANT_FEATURE_LINKS_PILOT_20261004.md`. Сервер отвечает на
навигационные вопросы только reviewed internal link markers, frontend отклоняет
внешние и неизвестные пути. Доступ требует одновременно environment switch и
привязанный hash allowlist; старая FIT-сессия обновляется через защищённый
`/auth/yandex/refresh-assistant` без предварительного выхода. До успешных CI,
API/migration rollout и frontend activation задачу
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
