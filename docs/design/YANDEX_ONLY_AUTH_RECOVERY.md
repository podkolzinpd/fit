# Yandex-only Auth — вход, восстановление и новый профиль

## Пользовательский результат

После отдельного cutover-флага на экране входа остаётся одно основное действие:
`Продолжить с Yandex ID`. Уже связанный профиль сразу получает Yandex
read-write сессию. Для неизвестного Yandex ID приложение предлагает два явных
пути: один раз подтвердить прежний FIT-аккаунт или создать чистый профиль сразу
в Yandex Cloud.

## Acceptance cases

1. `VITE_YANDEX_ONLY_AUTH_ENABLED` default-off и эффективен только вместе с
   app-session, main routing, native registration и валидной публичной
   OAuth/API-конфигурацией. При выключенном флаге текущий email-flow не меняется.
2. При включённом флаге `/auth` не показывает email login, email registration и
   password reset. Прямая навигация на старые auth callback/reset routes
   возвращает на единый экран.
3. После PKCE неизвестный Yandex subject получает одноразовый opaque handoff на
   10 минут. В Yandex PostgreSQL хранится только SHA-256; token, subject hash,
   OAuth token, email и пароль не попадают в URL и логи. Один handoff допускает
   не более пяти попыток проверки старых credentials; новый OAuth делает
   недействительным предыдущий активный handoff того же Yandex subject.
4. Старый аккаунт подтверждается password grant Supabase Auth только на сервере.
   Полученный access token не возвращается browser и не сохраняется. Привязка
   использует точный auth UUID и разрешена только если профиль, роль и trainer
   root уже присутствуют в свежем Yandex snapshot, а read-write assignment
   включён.
5. Ошибка старых credentials не создаёт пустой профиль автоматически.
   Пользователь явно повторяет ввод или возвращается и выбирает создание нового
   аккаунта.
6. Новый профиль создаётся из того же handoff атомарно с identity, ролью,
   legal acceptance и read-write assignment. Повторно использованный или
   истёкший handoff fail closed.
7. Связанный, но не rollout-ready Yandex ID не получает recovery handoff и не
   может создать дубликат. Он видит явное состояние «данные ещё не готовы».
8. После Yandex-only cutover stale Supabase browser session не выбирает
   Supabase actor/backend. После успешной Yandex session старая Supabase session
   удаляется существующим retirement-механизмом.
9. Приглашение сохраняется через OAuth; новый invited account получает
   фиксированную роль клиента и возвращается к явному claim.

## Rollout

Код доставляется без включения флагов. Серверный API требует точного
`YANDEX_ONLY_AUTH_ENABLED=true`; native account creation дополнительно требует
`YANDEX_NATIVE_REGISTRATION_ENABLED=true`. Terraform получает оба значения из
default-false repository variables. Frontend включается только отдельным Vercel
deployment после полного snapshot/apply, повторной checksum-проверки и smoke
обеих ролей.

После первой product mutation через Yandex выключение frontend-флага само по
себе не является безопасным rollback: действует общий cutover playbook.

## Проверка

- API/unit: unknown/linked-not-ready, invalid credentials, recovery success,
  explicit native registration, flag-off endpoints и отсутствие PII в ответе.
- DB integration: hash-at-rest, migrated profile/role/assignment checks,
  one-time consumption и identity conflict.
- Frontend: dependency-aware flag, единственный Yandex entry, оба setup-path,
  stale Supabase session fail-closed.
- WebKit: 390/430 px, light/dark-compatible Fit primitives, отсутствие
  горизонтального overflow и закрытый direct password-reset route.
