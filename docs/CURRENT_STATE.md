# Fit — текущее состояние проекта

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

## Проверенная точка — 2026-10-04

- Main: `df88c702`; клиентский Lime выпущен, frontend run37211395236 success.
- Пилот только budoha1, независимое серверное назначение clientLime + frontend
  CLIENT_LIME_ENABLED=true. Темы: светлая, тёмная, системная.
- #1395 исправил границы streaming transcript; #1398/#1401 улучшили штатную
  проверку gateway. Эти изменения уже в main.

## Активная задача — семь исправляющих PR по клиентскому видео

Полное разрешение реализации/merge/deploy получено 2026-10-04.
Неизменяемый acceptance: `docs/design/CLIENT_LIME_VIDEO_REMEDIATION_20261004.md`.
Порядок: 1 черновики → 2 сохранение правок → 3 голос → 4 общие controls →
5 создание → 6 Live → 7 итог и сквозная приёмка. Пилот не расширяется.

- PR1 в работе: отдельные черновики, явное продолжение/удаление, чистый новый ввод.
  Unit 9/9, клиентский WebKit 18/18 (390/430), frontend 2353 теста, API 1049 тестов,
  lint/typecheck/build и hosting checks прошли. Hosting повторён с разрешением
  локального порта после sandbox EPERM. CI и production ещё ожидаются.
- PR2 реализован локально: сохранение проверенного списка и undo одинаковых упражнений. Полный npm run check и WebKit 390/430 прошли. CI/rollout ожидаются.
- PR3 локально: сохранение промежуточного текста и видимое ожидание разбора.
- PR4 локально: клиентские controls; full check и WebKit 21/21 + polish 4/4 прошли.
- PR5 локально: focused compose/review/save и компактная проверка; check прошёл, WebKit/voice regression зелёные.
- PR6 локально: явное подтверждение подходов, ошибка/повтор и число незавершённых; full check, 19 unit, WebKit lifecycle 4/4 + retry 2/2 прошли.
- PR7 ожидает; не считать выполненными по наличию плана.
- Используется существующая Lime identity (YS Geo/REM, tokens), разрешённая
  пользователем; исторический monochrome контракт не отменяет принятый Lime.
- Production browser ограничен политикой среды, обход не выполняется.
- Физический iPhone/настоящая диктовка ещё не проверены. Симулятор не заменяет их.
- Внешний YAFIT не настроен в доступном корпоративном Tracker-контуре; план
  сохранён в репозитории, неподходящие credentials не используются.

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
