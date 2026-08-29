# Fit — текущее состояние проекта

> Rolling snapshot для продолжения между сессиями. Максимум 120 строк.
> После подтверждённого merge сведения заменяются, а не накапливаются:
> полная история хранится в Git, PR и Tracker.

Обновлено: 2026-08-29
Проверенный базовый `main`: `a492e04` (`Task 25: migrate auth flow and enable monochrome rollout (#672)`)

## Активное изменение

- Foundation UI Identity v1 принята. Задачи 8–25 — клиентский, тренерский и
  полный auth scope — merged и задеплоены в production.
- Глобальный rollout новой identity работает через
  `VITE_MONOCHROME_ROLLOUT_MODE`: `on` (default для всех), `preview` (прежний
  server-managed `monochrome_preview` по `user_id`) и `off` (legacy UI для всех
  одним переключателем и redeploy).
- Legacy components, CSS и `public.user_feature_flags` пока не удаляются.
  Email не участвует во frontend, routing или UI rollout conditions.
- Активна задача 26: trainer-only Assistant переводится на UI Identity v1 без
  изменения pilot-доступа, orchestration, matching, fallback, repositories,
  routes и product logic.

## Последняя проверенная продуктовая точка

- Главные страницы обеих ролей сохраняют voice-first действие и ввод текстом.
  Клиентская главная показывает ближайшее назначение, состоявшуюся неделю и не
  более одного вторичного акцента: ответ тренера, рекорд или цель.
- На экранах создания тренировки недоступные разбор и сохранение нейтральны;
  коралловый primary появляется только после заполнения обязательных данных.
- В Live статус не повторяется в каждом упражнении; обычный таймер нейтрален,
  активный отдых выделен, а `＋ Подход` не конкурирует с главным действием.
- Прошлый план можно завершить через предзаполненную форму факта без перехода в
  Live и без дубликата; отмена оставляет план неизменным. Тренер может сохранить
  завершённую тренировку на выбранную дату, включая будущую.
- Yandex stage поддерживает non-Live lifecycle: создание и исправление факта,
  результат прошлого назначения, cancel/reschedule, комментарий клиента и
  author-scoped soft-delete с optimistic version и tenant-проверками.
- Единый мобильный viewport-контракт восстанавливает полную высоту Trainer,
  Client и авторизации после закрытия клавиатуры даже при resize WebKit.
  Создание тренировки — каталог «Силовая»/«Бег», недавние упражнения, фильтры.
- Голосовой/текстовый разбор понимает числа словами, дробный вес, порядок
  метрик, интервальный бег и связки; неоднозначность открывает проверку.
- Сохранённые тренировки — компактная хроника с раскрытием подходов и кнопкой
  истории; копирование и удаление в меню.
- ИИ-сводка и production-разбор — через Yandex Cloud Functions, локальный разбор
  — в Supabase. Tracker sync `app_feedback` остановлен; команда читает через
  `analytics.app_feedback` и Telegram (`notify-app-feedback-telegram`).
- Assistant pilot trainer-only: `/assistant` защищён `TrainerOnly`; turns имеют
  `turnId`, history/action state durable, записи — узкими RPC с owner/RLS.
  Новые turn'ы сейчас создают только черновик тренировки; сохранённые карточки
  client/program/schedule/summary из предыдущего rollout остаются читаемыми.
  Исходная диктовка сохраняется при уточнении клиента. Пустая сессия показывает
  реальные возможности без записи; последовательные фрагменты собраны в одну
  раскрываемую строку.
- PWA предлагает понятную установку на домашний экран. Ручной беговой MVP и
  локальный public-domain каталог упражнений работают без внешнего медиасервиса.
- Web Push пользователям: сценарий `workout_reminder` — клиенту в 9:00 по его
  таймзоне про тренировку сегодня. Producer/dispatcher/finalize в Postgres,
  шифрование и отправка — Cloud Function `fit-send-push-notifications`
  (VAPID). Тумблер в профиле клиента; чек-лист нового сценария — в `AGENTS.md`.
- Client и Trainer Progress используют одну короткую историю подтверждённого
  периода: лучший результат, тренировки, `X/Y` недель, улучшенные упражнения,
  карта тела, сравнение с периодом, связь с целью, ближайший план и один
  фактический вывод; выполнение плана не выдаётся за прогресс к цели. Полная
  динамика и до двух ориентиров — в нижнем листе. Тренер видит plan/fact,
  внутренние сигналы, редактор и статус публикации. Фигуры не наследуются;
  выбранный период нейтрален и не конкурирует с primary CTA коралловой заливкой.
- Карточка спортсмена у тренера — один нейтральный вход в планирование,
  равноправные переходы в историю/прогресс, действие «Добавить этапы». Выбор
  фигуры/схемы — настройка аккаунта тренера, не смешивается с выбором клиента.
- Расписание тренера — компактная мобильная иерархия: месяц, календарь, неделя
  с понедельника, дата с числом тренировок, действие «Запланировать». События
  показывают время/клиента/состав/статус; шкала фокусируется на ближайшей или
  текущей тренировке, а планы без времени остаются видны отдельным блоком над
  прокручиваемой шкалой.
- Ассистент сохраняет тренировку только после подтверждения черновика.
- Клиент может безопасно отключить текущего тренера в профиле: серверная
  операция атомарна, повтор идемпотентен, самостоятельная история, назначения,
  замеры и цели сохраняются. Серверное переподключение после явного отключения
  использует тот же атомарный merge и не допускает двух активных тренеров.

## Инфраструктура и Yandex Cloud

- Локальная разработка и проверки используют только Podman. Docker не нужен.
- Stage содержит Managed PostgreSQL 17 и Serverless Containers. Миграции
  доставляются автоматически через GitHub OIDC, private runner и forward-only
  policy; `fit_api` не имеет прямых INSERT/UPDATE/DELETE grants на domain tables.
- Ограниченный Yandex ID pilot, clients, memberships, invitations, custom
  exercises, workout lifecycle и post-workout работают на stage (миграции
  `000001–000020`). Run `33154423400` доставил revision `796f958`: миграции,
  runtime DB preflight, exact read/write smoke и независимый summary list зелёные;
  rollback не потребовался.
- Native AI использует metadata IAM token без статического ключа; точную роль
  один раз выдаёт `fit-stage-api` администратор, а OIDC не меняет folder IAM.
- Yandex OAuth использует PKCE и публичный Client ID. OAuth Client secret не
  нужен browser-контракту; Supabase-сессия при пилотном входе не создаётся.
- Стабильный branch-scoped Vercel Preview синхронизируется с каждым verified
  `main` без force-push; callback URL и CORS origin не меняются. Все остальные
  ветки исключены из Vercel Git deployments.
- Callback показывает pilot profile, clients, connections и training data, но
  pilot UI read-only. Client/custom-exercise и Planned/Live writes — только
  через stage API, production routing не затрагивают.
- Реальный invite → join → leave/remove smoke на двух Yandex ID — внешняя
  stage-проверка; локальный lifecycle и RLS-матрица зелёные. Production остаётся
  на Supabase; полный cutover не выполнен.

## Проверки активной ветки

- Task 25: PR `#672`, merge `a492e048`, production deploy `6157521504`; весь CI,
  Chromium/WebKit auth lifecycle и Linux/Darwin visual matrix зелёные.
- Task 26 targeted unit: AppLayout + assistant domain — 134/134.
- Task 26 mobile Chromium и iPhone/WebKit layout/state suites — 12/12 каждая.
  Визуально проверены conversation/error/success/composer и workout draft на
  390, 430 и 1440 px в light/dark.
- Task 26 full project check зелёный: 123 app files / 966 tests, 225 API tests,
  typecheck, lint, coverage, DB types, iOS permissions, infra policy и build.
- Встроенный localhost browser заблокирован admin-enforced policy до загрузки;
  стандартный Playwright runtime используется для реальной проверки.
- Общий audit Home → Live → Progress прошёл без stabilization-задачи: едины
  typography, spacing, radii, surfaces, actions, navigation и light/dark;
  coral/purple и эффект простой перекраски отсутствуют.

## Ближайший порядок

1. Завершить задачу 26 Assistant отдельным PR без изменения orchestration.
2. Выполнить задачу 27: полный theme/accessibility parity audit.
3. Выполнить задачу 28: общий visual regression, WebKit/iOS и production smoke.

## Отложено

- `YAFIT-333/334` отложены; `YAFIT-335/337` завершены. `YAFIT-245` не начинать без решения; `YAFIT-234` отложен; `YAFIT-235` — Webvisor.
- Новые виды спорта, питание, social/wearables и ИИ-блоки — после P0/P1 и пилота.
