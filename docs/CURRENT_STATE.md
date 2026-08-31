# Fit — текущее состояние проекта

> Rolling snapshot для продолжения между сессиями. Максимум 120 строк.
> После подтверждённого merge сведения заменяются, а не накапливаются:
> полная история хранится в Git, PR и Tracker.

Обновлено: 2026-08-31
Проверенный базовый `main`: `300b584` (`feat(yandex): add native pilot assistant turn (#719)`)
## Текущий release gate

- Foundation UI Identity v1 принята. Задачи 8–28 — клиентский, тренерский,
  полный auth scope, Assistant, accessibility и visual release gate —
  завершены последовательно.
- Foundation UI Identity v1 становится единственным production UI: runtime-
  режимы `on / preview / off`, персональный preview, dark pilot и route-level
  old/new branches удалены в retirement-ветке.
- Историческая `public.user_feature_flags` больше не читается приложением и
  закрыта для frontend-ролей. Физический drop выполняется отдельным ручным
  destructive-окном согласно migration policy репозитория.

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
  Строки мобильного каталога не сжимаются и прокручиваются внутри sheet; новый
  клиент из пустых «Тренировок» и «Прогресса» попадает в форму своего профиля.
- Голосовой/текстовый разбор понимает числа словами, дробный вес, интервальный
  бег и связки; неоднозначность открывает проверку. Сохранённые тренировки —
  компактная хроника с копированием и удалением в меню.
- ИИ-сводка и production-разбор — через Yandex Cloud Functions, локальный разбор
  — в Supabase. Tracker sync `app_feedback` остановлен; команда читает через
  `analytics.app_feedback` и Telegram (`notify-app-feedback-telegram`).
- Assistant trainer-only защищён `TrainerOnly`; durable turns/actions и narrow
  RPC сохраняют owner/RLS. Новые turn'ы создают workout draft, прежние карточки
  остаются читаемыми; исходная диктовка сохраняется при уточнении клиента.
- PWA, беговой MVP, локальный каталог и Web Push работают: `workout_reminder`
  и `workout_scheduled`; transport secrets — из Yandex Lockbox без вывода в repo/CI.
- Client и Trainer Progress используют одну короткую историю подтверждённого
  периода: лучший результат, тренировки, `X/Y` недель, улучшенные упражнения,
  карта тела, сравнение, связь с целью и ближайший план. Тренер видит plan/fact,
  сигналы и публикацию; выполнение плана не выдаётся за прогресс к цели.
- Верх Progress закреплён в порядке `Период → Главное сейчас → Цель → Карта
  тела → Сравнение → Измерения → Регулярность → Результаты → Следующий шаг →
  Подробный анализ`. Карта тела компактная: фигура ограничена 210 px,
  переключатели — 184/160 px, вывод остаётся сразу под картой. LLM-текст
  допускается только при совпадении предмета и рассчитанных чисел, иначе
  используется deterministic fallback.
- Измерения вынесены в самостоятельный аналитический блок: приоритетный
  показатель, график периода, начало/конец, min/max, связь с целью, freshness
  и sufficiency. Вес, стандартные и пользовательские показатели поддерживаются;
  добавление, история, исправление и настройка остаются в нижнем блоке управления.
- «Следующий шаг» — отдельное компактное предложение после результатов. Код
  формирует семь допустимых типов действия, а ИИ может выбрать один только при
  совпадении смысла и чисел. Выбор, замена и скрытие ничего не сохраняют;
  переход появляется после явного выбора.
- Trainer Progress добавляет после следующего шага отдельный свёрнутый блок:
  максимум три сигнала с фактом и вопросом. Клиент его не получает.
- «Подробный анализ» закрыт по умолчанию и содержит три плоских раздела только
  с дополнительными LLM-выводами. Числа сверяются с рассчитанными метриками и
  данными цели; повторы, служебный текст, советы и внутренние замечания клиента
  не достигают. Сигналы и публикация остаются отдельными поверхностями.
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
- Ограниченный Yandex ID pilot и доменная цепочка представлены в `000001–000027`:
  `000026` добавляет actor-scoped Assistant state, `000027` — безопасное linking
  FIT-профиля с Yandex ID и read-write app-session только через явный
  `yandex`/`read_write` rollout assignment. Assistant, session digests и push
  secrets не выставляются через `ops_readonly`.
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
- `codex/yandex-session-linking` добавляет foundation для полноценной Yandex ID
  session и безопасного linking: `POST /v1/auth/yandex/session`,
  `POST /v1/auth/yandex/link`, `app_private.yandex_app_sessions`,
  `public.link_yandex_identity` и typed frontend methods. Production UI,
  `auth-context` и sticky routing не переключались.
- Проверено локально: `npm --prefix services/api run check`,
  `TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55432/fit_actor_test npm --prefix services/api run test:db`,
  `npm run db:reset`, `npm run db:test`, `npm run migrations:check`,
  `npm run check`.
## Ближайший порядок
1. Подключить UI linking/обычной Yandex ID session за default-off rollout.
2. Подключить основной Assistant UI к Yandex API через sticky tenant routing
   после явного session/linking контракта.
3. После export/import tooling провести две репетиции cutover.
## Отложено
- `YAFIT-333/334` отложены; `YAFIT-335/337` завершены. `YAFIT-245` не начинать без решения; `YAFIT-234` отложен; `YAFIT-235` — Webvisor. Новые виды спорта, питание, social/wearables и ИИ-блоки — после P0/P1 и пилота.
