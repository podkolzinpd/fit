# Fit — текущее состояние проекта

## Активная задача — визуальное завершение клиентского Lime

Владелец продукта 5 октября разрешил реализацию, PR и production-выкладку всей
серии. Принятый план: `docs/design/CLIENT_LIME_VISUAL_COMPLETION_20261005.md`.
Исправляются оставшиеся визуальные дефекты уже выпущенного пилота только для
`budoha1@yandex.ru`; действующие сценарии и тренерский UI сохраняются.
Первый PR (`e40a5497`, ветка `feat/client-lime-visual-foundation-20261005`)
исправляет геометрию действий и нижние отступы под навигацию; отправлен в
GitHub, локальные проверки и WebKit приёмка прошли. Второй PR убирает
многослойные рамки из списков плана и истории, раскрывает длинные названия;
полный check и мобильная WebKit/Chromium приёмка прошли. До слияния и
production-выпуска оба PR не считаются завершёнными.

## Ачивки — YAFIT-594

Утверждены три последовательных PR: два состояния → отдельная полоска →
сквозная приёмка. План: design/ACHIEVEMENT_PROGRESS_STATES_20261004.md.
PR1 #1425 слит в main; CI и production-проверка выпуска `8fc46a31` успешны.
Он убирает промежуточную окраску, сохраняет исходные assets и award logic.
Мобильные WebKit/Chromium light/dark 390/430: 8/8.
PR2 добавляет отдельную полоску и числовую подпись в коллекцию, сохраняет
три колонки и исходную картинку; полный локальный check и приёмка mobile
light/dark 390/430 прошли. #1427 слит; CI, production smoke и readback
выпуска `63226678` успешны.
PR3 #1428 проверяет сквозной переход 24→25 тренировок, ошибку и повторную
загрузку, повторный вход, согласованность «Кабинета» и «Прогресса» и свободный
нижний ряд над навигацией. Локально WebKit/Chromium 6/6. CI37241760363 и deployment37242590195
успешны; readback37260193474 подтвердил ACTIVE на `6810452f`.

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

Полное разрешение реализации/merge/deploy получено 2026-10-04.
Неизменяемый acceptance: `docs/design/CLIENT_LIME_VIDEO_REMEDIATION_20261004.md`.
Порядок: 1 черновики → 2 сохранение правок → 3 голос → 4 общие controls →
5 создание → 6 Live → 7 итог и сквозная приёмка. Пилот не расширяется.

- PR1 #1408, PR2 #1410, PR3 #1411, PR4 #1412, PR5 #1413 и PR6 #1415 слиты после зелёных checks.
  Последний main этого среза: 0707f015. Старый production frontend: run37211395236,
  commit59887b5c; новые промежуточные deployments остановлены проверкой актуальности main.
- PR6 #1415: явное подтверждение подходов, pending/error/retry, точное число
  незавершённых; проверки прошли на 695c5a0e, merged → 0707f015.
- PR7 #1417: честный zero/partial/full итог, компактная карточка и фактический
  результат для отправки. Локально WebKit190/190, client Chromium27/27,
  последняя zero-регрессия4/4, completion/share25/25. Финальный full check:
  frontend2366, API1063 passed (71 DB tests skipped), lint/typecheck/build/hosting passed.
- Текущий SpeechKit relay 89-169-132-80.sslip.io прошёл smoke с `done` после stop.
  Timeout старого адреса из recovery workflow не относится к текущему клиенту.
- Финальный main CI и production deployment успешны; debug APK и iOS simulator
  собраны. Подписанные store-релизы в этот выпуск не входили.
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
