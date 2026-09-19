# Fit — текущее состояние проекта
> Rolling snapshot для продолжения между сессиями, максимум 120 строк. После
> merge сведения заменяются; полная история хранится в Git, PR и Tracker.
Обновлено: 2026-09-19. База изменений: `ae46b2d2` (#1057). Frontend
остаётся на Vercel. Production-пользователи пока используют Supabase; Yandex
app-session, main routing и native registration не включены глобально.

## Активная цель

Полностью переключить production data plane на существующий Yandex Cloud
контур и оставить Yandex ID единственным способом входа. До окончания cutover
новые продуктовые функции используют общий доменный контракт и эквивалентные
Supabase/Yandex adapters без dual-write. Координация, потоки и гейты описаны в
`docs/YANDEX_CUTOVER_PLAYBOOK.md`.

## Последняя проверенная продуктовая точка

- Assistant доступен тренеру и клиенту через общий экран; клиент работает
  только со своей карточкой. Программы остаются за общим kill switch.
- Клиентская генерация четырёхнедельной программы работает через выбранный
  backend. Yandex API читает actor-scoped историю, цель, замеры и будущие
  занятия из PostgreSQL, использует короткие idempotent generation leases и
  вызывает тот же валидируемый YandexGPT generator вне DB-транзакции.
- Свои упражнения поддерживают мышцы, оборудование, описание и private JPEG до
  2 МБ. Yandex API и repository читают, создают и обновляют текстовую разметку
  с тем же provider-neutral контрактом; изменение фото всё ещё отклоняется, а
  объекты custom exercise media не входят в подтверждённый перенос.
- Публичные условия и политика показывают утверждённый текст. Общий legal
  contract сохраняет versioned acceptance и отменяемые account deletion
  requests через выбранный Supabase или Yandex backend. Yandex API использует
  actor-scoped RLS/RPC; UI не ветвится по имени провайдера.
- Независимый gate обязательной привязки Yandex ID включён глобально в
  production build без персонального allowlist: защищённые маршруты доступны
  только связанным профилям. Gate не меняет app-session, backend routing и
  rollout assignment; продуктовые данные продолжают идти через Supabase.
- Экран технических работ и блокировка product runtime подготовлены как
  `VITE_MAINTENANCE_MODE`, строго default-off в коде. На production флаг включён
  оператором 2026-09-19: при точном `true` любой маршрут заменяется до
  монтирования auth/query/data providers. Независимый owner-only Supabase write
  gate также переведён в `paused` и блокирует DML старых вкладок, RPC и
  background writers на 38 source-таблицах.

## Yandex Cloud — подтверждённая база

- Существующий Terraform stack `fit/stage` принят как production data plane:
  Managed PostgreSQL 17, один private host, диск 10 GB, API/migration
  containers, Lockbox и Object Storage. Backup retention — 14 дней, окно —
  `00:30 UTC`; отдельный production cluster не создаётся.
- Full-cohort current-snapshot apply от 2026-09-17 успешно проверил 32 таблицы:
  audit — 14 819 строк, apply — 14 805 вставок, повторный apply — 0. Запуск
  использовал `media_validation: allow-missing`, поэтому не является финальной
  cutover-репетицией.
- Текущий full-cohort manifest расширен до 35 таблиц: в snapshot входят
  `user_legal_acceptances`, `account_deletion_requests` и `favorite_workouts`.
  Новый import атомарно
  пересобирает переносимые таблицы из свежего snapshot вместо insert-only
  конфликта на изменившихся строках. Yandex identity/session/rollout строки
  профилей из snapshot временно сохраняются и восстанавливаются, а устаревшие
  linked-привязки профилей вне snapshot удаляются; наличие нативного
  Yandex-профиля блокирует операцию до удаления данных.
- Локальная двухпроходная репетиция 35 таблиц снова зелёная. Tenant migration
  включает transaction-local restore mode, поэтому исторические progress/goal
  строки не запускают побочное обновление `clients.updated_at`; обычные
  продуктовые записи по-прежнему обновляют source timestamp. Оба чистых прогона
  подтвердили одинаковые trainer, standalone-client и full-cohort fingerprints,
  повторный apply и финальный checksum; текущий full-cohort fixture содержит
  69 строк.
- Свежие read-only source audit и rollback-only Yandex target dry-run при
  `paused` write gate подтвердили одинаковый content fingerprint, все 35 таблиц
  и 16 192 строки: `favorite_workouts` — 1, legal acceptance — 128, deletion
  requests — 0. В dry-run зашифрованный snapshot занял 2 738 453 байта; target
  проверил 16 192 inserts и откатил транзакцию. Media policy — `allow-missing`;
  apply не запускался.
- Server-side rollout assignments для `linked-ready` профилей включены и
  проверены агрегированно. Обязательная привязка включена отдельно; frontend
  app-session, main-routing и native-registration switches остаются выключены.
- Нативная регистрация через Yandex ID и финальный Yandex-only auth flow
  реализованы за независимыми default-off frontend/server switches. Неизвестный
  Yandex ID получает одноразовый 10-минутный handoff: старые Supabase
  credentials могут связать только уже перенесённый rollout-ready UUID, а новый
  профиль создаётся только после отдельного явного выбора. Неверный пароль не
  создаёт пустой профиль. Оба server switch проложены в Terraform через
  default-false repository variables; production значения не включены.
- Защищённый `/invite#token=…&source=…` показывает публичный Supabase/Yandex
  preview, хранит bearer-token только в browser session и возвращает связанный
  либо новый аккаунт на явный claim; legacy `/join?code=…` теперь также
  переживает Yandex OAuth.
  При включённой app-session Yandex ID становится primary login action, email
  остаётся secondary fallback; production flags в этом PR не меняются.
- Yandex API покрывает основные profile/client/workout/Live/progress/chat/push
  read-write сценарии через `x-fit-session`. Ошибка выбранного Yandex backend
  не должна переключать отдельный запрос обратно на Supabase.
- Yandex Web Push producer, recoverable lease/retry, multi-device subscriptions
  и минутный private dispatcher развёрнуты. Финальный end-to-end smoke входит в
  cutover gate.
- Production parser работает через Yandex Cloud Function. Summary live smoke
  ранее получил HTTP 400 из-за формата тестового запроса; нужен повторный
  authenticated smoke текущего контракта.

## Открытые cutover blockers

1. Выполнить успешный media migration без `allow-missing` для chat,
   exercise и custom-exercise objects; подтвердить upload/sign/read/delete.
2. Добавить Yandex custom-exercise photo adapter.
3. Убрать обязательность Supabase env из production composition и проверить
   остальные прямые пути. Публичная анкета уже выбирает Supabase либо Yandex
   вместе с глобальным main routing без межпровайдерного fallback.
4. После свежего full-cohort apply проверить на stage linked trainer/client,
   recovery старого email-only профиля, новый Yandex-only аккаунт и приглашение;
   только затем по отдельной команде включить server/frontend cutover flags.
5. Провести backup restore drill во временный private cluster, повторить AI
   summary и push smoke.
6. После короткого freeze выполнить свежий full-cohort snapshot, media delta,
   validate и повторную атомарную пересборку с тем же checksum; только затем
   включать routing.

## Ближайший порядок

1. Вести параллельные потоки `identity-runtime`, `data-media`,
   `assistant-ops` и `product` по cutover playbook; назначить одного
   интеграционного владельца.
2. Сначала закрыть parity blockers и общие contract tests, затем провести одну
   полную локальную репетицию и стабилизационный CI checkpoint.
3. Отдельной согласованной задачей выполнить production cutover. После первой
   Yandex-записи rollback флагом без reverse migration небезопасен.
4. После согласованного окна стабильности отключить Supabase Auth/Data API/
   Storage/Edge Functions, удалить fallback-код и production secrets.

## Отложено

- DataLens и доставка `app_feedback` в Telegram/Tracker — до отдельного решения.
- HA replica — только по требованиям SLA; один host остаётся принятым риском.
- APNs и Android/FCM не входят в Web Push cutover.
