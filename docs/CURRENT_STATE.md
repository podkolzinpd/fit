# Fit — текущее состояние проекта

## Аудит БД второй шаг — 2026-10-05

Первый шаг #1434 слит на `a9b9c8e6`; повторный CI37306986244 и API rollout
37307751042 success. Фото защищены; план PROFILE_PHOTO_CONCURRENCY в docs/design.
Второй шаг на main `3a0bcf3f`: training-data использует read-only REPEATABLE READ
до session resolution. Корни/упражнения/подходы одного ответа согласованы;
mutation, API/DTO, схема/grants/UI/Supabase не меняются. Четыре гонки воспроизведены
на старом коде; исправление прошло clean PostgreSQL17 actor/RLS80/80 и unit7/7.
Check frontend2371/API1070 и WebKit2/2 зелёные; CI ещё гейт, шаг не выпущен. local:verify остаётся
блокирован исторической Supabase-миграцией, baseline не сбрасывался.
План: design/DATABASE_AUDIT_WORKOUT_SNAPSHOT_20261005.md.
Следующий отдельный шаг — серверная пагинация истории, не часть текущей задачи.

## Часовой эксперимент frontend Gateway — 2026-10-05

#1433: private Node.js22/128МБ/60s, часовой timer, `/healthz`/`auth` на одном IP,
без PII/чатов; manual inspect, enable требует согласования стоимости.
Через24ч HTTP прекращается, disable останавливает timer. Candidate smoke/pinned
tag защищают переключение. Ресурсов/активации нет, invoke/эффект не проверены.
Оценка21₽/31день при60s и повторе вызовов, трафик/логи отдельно; OPERATIONS.md.
Причина медленного HTML не доказана. Нужен private bootstrap, functions.admin
только на функцию и scoped invoker; deployer пока functions.editor. Прав,
UI/auth/API/БД не меняли, внешний probe сохранён. Check frontend2371/API1063,
DB71 skipped/hosting112; E2E разделены без ослаблений:48/48, WebKit236/236,
CI37294091210 success. На `6f7e3cea` check/E2E52/52 зелёные; далее CI-гейт.

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
первый параллельный check упёрся в таймаут worker, оба файла отдельно прошли;
ветка `a31f49f7` отправлена. Пятый PR выносит длинную основу оценки калорий
из сетки истории клиента, сохраняя сами показатели; 8 WebKit/Chromium проверок
и полный check прошли; ветка `4e52dba3` отправлена. Шестой PR меняет только
форму голосовой кнопки в создании/редактировании: 8 мобильных сценариев и
полный check прошли, существующий ввод и черновики сохранены.
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

Acceptance: design/CLIENT_LIME_VIDEO_REMEDIATION_20261004.md; Lime identity/pilot сохранены. SpeechKit smoke `done` прошёл, старый recovery не относится к relay.
Production browser ограничен без обхода; внешний YAFIT не настроен, чужие credentials не используются.
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
