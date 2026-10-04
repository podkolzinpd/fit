# Fit — текущее состояние проекта

## Проверенная точка — 2026-10-04

- Main: `7ed498ee`, все пять этапов клиентского Lime слиты после зелёного CI.
- Предыдущая production-версия: `77491118` (#1383, завершение YAFIT-593).
  Диагностика Gateway `37190468629` подтвердила ACTIVE, эту версию и завершённые
  операции после отката первой клиентской выкладки. Это проверка инфраструктуры,
  не авторизованной пользовательской сессии.
- Последующие frontend-выпуски используют только успешный CI текущего main.
  Run `37189769572` остановился на внешнем smoke, предыдущая конфигурация
  восстановлена. Run `37190660822` остановлен до активации, поскольку появился
  более новый main. Run `37191604966` повторно встретил внешний timeout,
  прежняя версия восстановлена и проверена. Read-only probe `37192113317`:
  gateway-health timeout20s, HTML200 за19.9s. Проверки публикации не ослаблены.
  Нельзя считать эти попытки успешным выпуском клиентского Lime.

## Активная задача — клиентский Lime только для budoha1

Пользователь явно разрешил реализацию, публикацию в podkolzinpd/fit,
слияние зелёного CI и выпуск на fit-training.ru. Повторное разрешение не нужно.
Неизменяемый план: `docs/design/CLIENT_LIME_PLAN_20261004.md`.
Порядок выпуска: `docs/design/CLIENT_LIME_RELEASE_20261004.md`.

| Этап | PR / состояние |
| --- | --- |
| 1. Основа и независимый флаг | #1384 → `de601c46`, слит после CI |
| 2. Оболочка и темы | #1385 → `9e139fc8`, слит после CI |
| 3. Главная и тренировки | #1387 → `d8a0d893`, слит после CI |
| 4. Остальные разделы и окна | #1388 → `146d6ab5`, слит после CI |
| 5. Общая приёмка и включение | #1389 → `7ed498ee`, слит после CI |

Светлая/тёмная/системная темы сохраняются отдельно для учётки. Охвачены главная,
тренировки/Live/завершение, прогресс/цели/замеры, профиль/оплата, чат/достижения.
Бизнес-операции и тренерское оформление сохраняются.

По уточнению владельца PR5 использует существующий проверенный OAuth-контур
тренерского пилота, но отдельные client allowlist, роль и experiment.
Migration121 хранит ровно один hash native login `budoha1`, привязывает только
подтверждённый клиентский профиль и не отменяет disabled при повторном входе.
Ручной UUID не нужен; старый frontend UUID allowlist в PR5 больше не используется.
После выпуска API требуется повторный вход Yandex ID для первого назначения.
`VITE_CLIENT_LIME_ENABLED=true` установлен после успешного API rollout
`37193370353`: применена migration121, availability50/50 без retry. Main CI
`37193370317` success. Frontend-публикация ещё выполняется; не считать её завершённой.

## Следующий персональный pilot — ссылки на функции в Assistant

Пользователь разрешил реализацию, PR, слияние зелёного CI и production-выпуск
только для native Yandex login `irainbuster98`. План и критерии:
`docs/design/ASSISTANT_FEATURE_LINKS_PILOT_20261004.md`. Сервер отвечает на
навигационные вопросы только reviewed internal link markers, frontend отклоняет
внешние и неизвестные пути. Доступ требует одновременно environment switch и
привязанный hash allowlist; после первого API rollout нужен повторный вход
Yandex ID. До успешных CI, API/migration rollout и frontend activation задачу
нельзя считать выпущенной.

## Проверки задачи

- PR1–4: локальные проверки пройдены; после обновления main PR2 восстановлены
  зависимости и отдельно повторён timeout bundle test, остаток check прошёл.
  PR3/4 актуальные полные check завершились успешно.
- Финальный frontend: 2349 тестов; два ожидания ExercisePicker в общем запуске
  повторены отдельно, suite вместе с gate — 111/111. Остальные шаги check,
  API/build/hosting policies завершились успешно.
- API: 1049 passed. Clean PostgreSQL17/actor-RLS: 70/70; отдельный Podman
  контейнер остановлен после проверки. Общая локальная база имеет старый конфликт
  migration112, поэтому local:verify заменён изолированной clean-chain проверкой.
- Chromium/WebKit: 43/43 итоговых сценария, 390/430 px и shared regression.
  Галерея: outputs/client-lime-20261004 в родительском workspace.
- Нативные сборки обновляются после финального merge; Xcode26.6 и уже запущенный
  iPhone17 simulator доступны. Android auth-smoke принимает тот же frontend флаг.
  Дополнительная правка упаковки передаёт ему два лицензированных YS Geo из тех же
  secrets и требует их checksum-проверку; иначе APK использовал бы fallback-шрифт.
- Production browser ограничен административной политикой CUA; отказ не обходится.
  Реальный OAuth budoha1 и физический iPhone/клавиатура не проверены.
- YAFIT-тикет этой задачи не создан: подключённый Tracker skill относится к
  корпоративному контуру, пригодный доступ к проектному YAFIT не подтверждён.

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
