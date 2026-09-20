# Fit — текущее состояние проекта
> Rolling snapshot для продолжения между сессиями, максимум 120 строк; полная история хранится в Git, PR и Tracker.
Обновлено: 2026-09-20. База изменений: `b50d5183` (#1085). Frontend остаётся на Vercel, а production data plane — принятый Yandex Cloud stage stack.
Yandex ID является единственным production-входом; app-session, main routing и native registration включены глобально.

## Активная цель

Стабилизировать Yandex-only production после переключения и затем вывести
Supabase из эксплуатации. До закрытия rollback-окна сохраняется общий доменный
контракт без dual-write; гейты описаны в `docs/YANDEX_CUTOVER_PLAYBOOK.md`.

## Последняя проверенная продуктовая точка

- Assistant доступен обеим ролям; клиент работает только со своей карточкой, программы остаются за общим kill switch.
- Клиентская генерация четырёхнедельной программы работает через выбранный
  backend. Yandex API читает actor-scoped историю, цель, замеры и будущие
  занятия из PostgreSQL, использует короткие idempotent generation leases и
  вызывает тот же валидируемый YandexGPT generator вне DB-транзакции.
- Свои упражнения поддерживают текстовые metadata в обоих backend; изменение
  private JPEG всё ещё отклоняется, объекты не входят в подтверждённый перенос.
- Legal acceptance и отменяемые deletion requests работают через выбранный
  backend с actor-scoped Yandex RLS/RPC и provider-neutral UI.
- Production auth показывает только действие «Продолжить с Yandex ID»; старые
  email/password/reset routes возвращаются на единый вход. Связанный профиль с
  `yandex/read_write` assignment получает Yandex app-session и весь основной UI
  выбирает Yandex API без request-level fallback. Неизвестный Yandex ID получает
  recovery/new-account handoff. Recovery domain-ready профиля одной транзакцией
  создаёт identity, `yandex/read_write` и первую app-session; при любой ошибке
  всё откатывается. Reload не сбрасывает активные Yandex requests.
- `VITE_MAINTENANCE_MODE` выключен после выпуска и production-проверки
  обновлённого Yandex ID экрана. Owner-only Supabase write gate остаётся в
  `paused`: он блокирует DML старых вкладок, RPC и background writers на 38
  source-таблицах.

## Yandex Cloud — подтверждённая база

- Существующий Terraform stack `fit/stage` принят как production data plane:
  Managed PostgreSQL 17, один private host, диск 10 GB, API/migration
  containers, Lockbox и Object Storage. Backup retention — 14 дней, окно —
  `00:30 UTC`; отдельный production cluster не создаётся.
- Текущий full-cohort manifest расширен до 35 таблиц: в snapshot входят
  `user_legal_acceptances`, `account_deletion_requests` и `favorite_workouts`.
  Import атомарно пересобирает их из свежего snapshot, сохраняя актуальные
  Yandex identity/session/rollout строки; устаревшие linked-привязки удаляются,
  а наличие нативного Yandex-профиля блокирует destructive rebuild.
- Локальная двухпроходная репетиция 35 таблиц снова зелёная. Tenant migration
  включает transaction-local restore mode, поэтому исторические progress/goal
  строки не обновляют `clients.updated_at`. Оба чистых прогона подтвердили
  одинаковые role/full-cohort fingerprints, repeat apply и checksum.
- Свежий current-snapshot cutover cycle при `paused` write gate завершён для
  всех 35 таблиц и 16 192 строк: source audit, target dry-run с rollback, первый
  apply и повторная полная пересборка подтвердили fingerprint
  `d59e1f1b9adb4361`.
  Оба apply проверили по 16 192 inserts; `favorite_workouts` — 1, legal
  acceptance — 128, deletion requests — 0. Media policy — `allow-missing`.
- Server-side rollout assignments для `linked-ready` профилей включены и
  проверены агрегированно. Server switches
  `YC_STAGE_YANDEX_NATIVE_REGISTRATION_ENABLED` и
  `YC_STAGE_YANDEX_ONLY_AUTH_ENABLED` включены; deploy `35467406265` прошёл
  migrations, runtime identity, health и readiness без rollback.
- Нативная регистрация через Yandex ID и финальный Yandex-only auth flow
  включены независимыми frontend/server switches. Неизвестный
  Yandex ID получает одноразовый 10-минутный handoff: старые Supabase
  credentials могут связать только уже перенесённый rollout-ready UUID, а новый
  профиль создаётся только после отдельного явного выбора. Неверный пароль не
  создаёт пустой профиль. Новая регистрация создаёт данные только в Yandex
  PostgreSQL.
- Для reviewed test-profile corrections добавлен приватный stage workflow
  отвязки Yandex identity по non-reversible tenant fingerprint. Он удаляет
  `app_private.auth_identities` provider `yandex` и отзывает активные
  `app_private.yandex_app_sessions` в одной транзакции без вывода raw UUID или
  provider subject в логи.
- Защищённый `/invite#token=…&source=…` показывает публичный Supabase/Yandex
  preview, хранит bearer-token только в browser session и возвращает связанный
  либо новый аккаунт на явный claim; legacy `/join?code=…` теперь также
  переживает Yandex OAuth.
  Production OAuth smoke подтвердил PKCE-переход на `oauth.yandex.ru`, а
  защищённый маршрут и старый password-recovery route возвращаются на единый
  Yandex ID экран без email/password формы.
- Yandex API покрывает основные read-write сценарии без fallback; каталог тренеров отдаёт только опубликованные данные по три карточки, а Supabase adapter приводит legacy RPC к тому же компактному DTO.
- Yandex Web Push pipeline и production parser развёрнуты; нужны authenticated
  end-to-end smoke push и текущего summary-контракта.
- Для 670 упражнений Vital Gym Pro завершён OIDC/private-runner перенос 2 010
  объектов (71 514 430 байт) по exact manifest. Первый apply загрузил и
  проверил все 2 010 объектов; повторный apply ничего не перезаписал
  (`uploaded=0`, `skipped=2010`). Финальный read-only audit подтвердил
  `verified=2010`, `missing=0`, `mismatched=0` и fingerprint
  `3f47c2c64d7d3a50`; signed-URL smoke и версионирование прошли. Main routing
  не включён, проверенные копии в Supabase сохранены.

## Открытые post-cutover задачи и риски

1. Выполнить успешный media migration без `allow-missing` для оставшихся chat
   и custom-exercise objects; Vital Gym Pro уже перенесён и полностью проверен.
2. Добавить Yandex custom-exercise photo adapter.
3. Убрать обязательность Supabase env и legacy bridge из production composition.
   Публичная анкета уже выбирает Supabase либо Yandex вместе с main routing без
   межпровайдерного fallback.
4. Провести ручной E2E matrix с реальными тестовыми identities: linked trainer,
   linked client, recovery старого email-only профиля, новый Yandex-only аккаунт
   и оба invitation path. Автоматизированы серверные контракты, production auth
   DOM, PKCE redirect и unauthenticated guards; реальный OAuth callback в этом
   cutover-сеансе не выполнялся.
5. Провести backup restore drill, повторить authenticated AI summary и push
   smoke. До завершения observation window Supabase не удалять: write gate
   остаётся paused, а обратной миграции Yandex writes нет.

## Ближайший порядок

1. Наблюдать Yandex auth/API errors и выполнить ручной E2E matrix тестовыми
   trainer/client accounts; при инциденте возвращать maintenance и делать
   forward-fix, а не включать Supabase UI поверх появившихся Yandex writes.
2. Закрыть media/custom-photo и AI/push/backup задачи.
3. После согласованного окна стабильности отключить Supabase Auth/Data API/
   Storage/Edge Functions, удалить fallback-код и production secrets.

## Отложено

- DataLens/Telegram/Tracker отложены; HA replica нужна только по SLA; APNs и Android/FCM не входят в Web Push cutover.
