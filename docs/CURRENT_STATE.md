# Fit — текущее состояние проекта
> Rolling snapshot для продолжения между сессиями, максимум 120 строк. После
> merge сведения заменяются; полная история хранится в Git, PR и Tracker.

Обновлено: 2026-09-19. База изменений: `0ac03e0e` (#1048). Frontend
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
- #1025 разрешил клиенту запускать собственную генерацию программы и добавил
  Supabase jobs. Эквивалентной Yandex migration/API execution path пока нет —
  это cutover blocker, а не готовая backend parity.
- Свои упражнения поддерживают мышцы, оборудование, описание и private JPEG до
  2 МБ. Yandex migration сохраняет metadata, но Yandex repository всё ещё
  отклоняет изменение фото; объекты custom exercise media не входят в
  подтверждённый перенос.
- Публичные условия и политика показывают утверждённый текст. Supabase хранит
  versioned legal acceptance и account deletion requests; Yandex native
  registration фиксирует legal acceptance только для нового аккаунта.
- Независимый gate обязательной привязки Yandex ID включён глобально в
  production build без персонального allowlist: защищённые маршруты доступны
  только связанным профилям. Gate не меняет app-session, backend routing и
  rollout assignment; продуктовые данные продолжают идти через Supabase.
- Экран технических работ и блокировка product runtime подготовлены как
  `VITE_MAINTENANCE_MODE`, строго default-off. Флаг не включён: при точном
  `true` любой маршрут заменяется до монтирования auth/query/data providers.

## Yandex Cloud — подтверждённая база

- Существующий Terraform stack `fit/stage` принят как production data plane:
  Managed PostgreSQL 17, один private host, диск 10 GB, API/migration
  containers, Lockbox и Object Storage. Backup retention — 14 дней, окно —
  `00:30 UTC`; отдельный production cluster не создаётся.
- Full-cohort current-snapshot apply от 2026-09-17 успешно проверил 32 таблицы:
  audit — 14 819 строк, apply — 14 805 вставок, повторный apply — 0. Запуск
  использовал `media_validation: allow-missing`, поэтому не является финальной
  cutover-репетицией.
- Текущий full-cohort manifest расширен до 34 таблиц: в snapshot входят
  `user_legal_acceptances` и `account_deletion_requests`. Новый import атомарно
  пересобирает переносимые таблицы из свежего snapshot вместо insert-only
  конфликта на изменившихся строках. Yandex identity/session/rollout строки
  профилей из snapshot временно сохраняются и восстанавливаются, а устаревшие
  linked-привязки профилей вне snapshot удаляются; наличие нативного
  Yandex-профиля блокирует операцию до удаления данных.
- Свежий read-only export подтвердил 34 таблицы и 16 110 строк, включая 124
  legal acceptance и 0 deletion requests. JSON envelope вырос до 3 484 918
  байт и не дошёл до target. Remote v3 теперь передаёт ciphertext бинарно без
  Base64/JSON overhead при прежнем пределе 3 400 000 байт; apply не запускался.
- Server-side rollout assignments для `linked-ready` профилей включены и
  проверены агрегированно. Обязательная привязка включена отдельно; frontend
  app-session, main-routing и native-registration switches остаются выключены.
- Нативная регистрация через Yandex ID, атомарное создание профиля/роли,
  assignment и legal acceptance находятся в `main`; frontend и server flags
  default-off. `YANDEX_NATIVE_REGISTRATION_ENABLED` ещё не проложен в
  deployment environment.
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
2. Добавить Yandex custom-exercise photo adapter и эквивалентный client
   Assistant program jobs/generation path.
3. Данные legal acceptance и account deletion requests уже входят в 34-table
   tenant catalog; остаётся перевести legal/deletion UI на общий Yandex
   repository/API-контракт.
4. Убрать обязательность Supabase env и runtime fallback из production
   composition; сделать публичный профиль и остальные прямые пути Yandex-first.
5. Проложить server/frontend native-registration flags, проверить linked и
   новый Yandex-only аккаунт, затем определить обработку оставшихся email-only
   пользователей.
6. Провести backup restore drill во временный private cluster, повторить AI
   summary и push smoke.
7. После короткого freeze выполнить свежий full-cohort snapshot, media delta,
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
