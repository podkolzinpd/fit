# Fit — текущее состояние проекта

> Rolling snapshot для продолжения между сессиями. Максимум 120 строк.
> После подтверждённого merge сведения заменяются, а не накапливаются:
> полная история хранится в Git, PR и Tracker.

Обновлено: 2026-08-29
Проверенный базовый `main`: `6e344d6` (`Task 27: enforce monochrome accessibility parity (#674)`)

## Текущий release gate

- Foundation UI Identity v1 принята. Задачи 8–28 — клиентский, тренерский,
  полный auth scope, Assistant, accessibility и visual release gate —
  завершены последовательно.
- Глобальный rollout новой identity работает через
  `VITE_MONOCHROME_ROLLOUT_MODE`: `on` (default для всех), `preview` (прежний
  server-managed `monochrome_preview` по `user_id`) и `off` (legacy UI для всех
  одним переключателем и redeploy).
- Legacy components, CSS и `public.user_feature_flags` пока не удаляются.
  Email не участвует во frontend, routing или UI rollout conditions.
- Task 28 не меняет product bundle: она стабилизирует только E2E navigation,
  фиксирует финальную 390/430/1440 и WebKit/iOS matrix и release evidence.
- Ручной видимый production smoke остаётся follow-up: встроенный браузер
  заблокирован admin-enforced policy; контроль не обходился.

## Последняя проверенная продуктовая точка

- Главные страницы обеих ролей сохраняют voice-first действие и ввод текстом;
  Client Home показывает ближайшее назначение, состоявшуюся неделю и максимум
  один вторичный акцент. Live разделяет нейтральный таймер и активный отдых.
- Создание, Live и завершение прошлого плана сохраняют прежнюю логику без
  дубликатов. Yandex stage поддерживает non-Live lifecycle, cancel/reschedule,
  комментарий и author-scoped soft-delete с optimistic/tenant checks.
- Единый мобильный viewport-контракт восстанавливает полную высоту Trainer,
  Client и авторизации после закрытия клавиатуры даже при resize WebKit.
  Создание тренировки — каталог «Силовая»/«Бег», недавние упражнения, фильтры.
- Голосовой/текстовый разбор понимает числа словами, дробный вес, интервальный
  бег и связки; неоднозначность открывает проверку. Сохранённые тренировки —
  компактная хроника с копированием и удалением в меню.
- ИИ-сводка и production-разбор — через Yandex Cloud Functions, локальный разбор
  — в Supabase. Tracker sync `app_feedback` остановлен; команда читает через
  `analytics.app_feedback` и Telegram (`notify-app-feedback-telegram`).
- Assistant trainer-only защищён `TrainerOnly`; durable turns/actions и narrow
  RPC сохраняют owner/RLS. Новые turn'ы создают workout draft, прежние карточки
  остаются читаемыми; исходная диктовка сохраняется при уточнении клиента.
- PWA, ручной беговой MVP и локальный public-domain каталог работают. Web Push
  `workout_reminder` отправляется клиенту в 9:00 его timezone через Postgres
  producer/dispatcher/finalize и VAPID Cloud Function.
- Client и Trainer Progress используют одну короткую историю подтверждённого
  периода: лучший результат, тренировки, `X/Y` недель, улучшенные упражнения,
  карта тела, сравнение с периодом, связь с целью и ближайший план. Тренер видит
  plan/fact, внутренние сигналы, редактор и статус публикации; выполнение плана
  не выдаётся за прогресс к цели.
- Карточка спортсмена у тренера — один нейтральный вход в планирование,
  равноправные переходы в историю/прогресс, действие «Добавить этапы». Выбор
  фигуры/схемы — настройка аккаунта тренера, не смешивается с выбором клиента.
- Расписание показывает месяц, неделю, события и планы без времени; Assistant
  сохраняет тренировку только после подтверждения черновика.
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

- YAFIT-414 / Progress 1.1: свободный текст цели дополнен необязательным ручным
  критерием `weight/waist/chest/hips`; старые цели не интерпретируются по тексту.
  Общая форма Trainer/Client и карточка Progress различают «Не настроено»,
  «Нужны данные», «Настроено» и «Нужно проверить». Численный статус, динамика,
  freshness и LLM остаются за пределами 1.1.
- Tasks 25–26: PR `#672/#673`, auth и Assistant задеплоены; app/API, Chromium,
  WebKit и Linux/Darwin visual matrix зелёные на 390/430/1440 в light/dark.
  Yandex stage preview sync `33263066435` также зелёный.
- Task 27: WCAG AA token pairs, screen-reader names, 44 px targets,
  focus-visible и reduced motion добавлены в общий автоматический контракт.
- Task 27: PR `#674`, merge `6e344d6`, production Vercel deployment
  `6158408571` success; весь обязательный CI зелёный.
- Task 28 final matrix: 72 applicable visual scenarios, 18 intentional
  role/viewport skips, 73 Chromium behavior scenarios и оба WebKit shard
  зелёные. В репозитории 346 согласованных Linux/Darwin snapshots для
  390/430/1440.
- Встроенный localhost browser заблокирован admin-enforced policy до загрузки;
  стандартный Playwright runtime используется для реальной проверки.
- Общий audit Home → Live → Progress прошёл без stabilization-задачи: едины
  typography, spacing, radii, surfaces, actions, navigation и light/dark;
  coral/purple и эффект простой перекраски отсутствуют.

## Ближайший порядок

1. Выполнить короткий ручной visual smoke production под Client и Trainer test
   accounts, когда browser policy снова разрешит доступ.
2. Сохранять rollout `on`; при серьёзной проблеме установить
   `VITE_MONOCHROME_ROLLOUT_MODE=off` и redeploy.
3. Не удалять legacy UI, `preview` и feature flag минимум один стабильный
   релизный цикл; cleanup выполнять отдельной задачей.

## Отложено

- `YAFIT-333/334` отложены; `YAFIT-335/337` завершены. `YAFIT-245` не начинать без решения; `YAFIT-234` отложен; `YAFIT-235` — Webvisor.
- Новые виды спорта, питание, social/wearables и ИИ-блоки — после P0/P1 и пилота.
