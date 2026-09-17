# Yandex ID global login rollout

## Пользовательский результат

Любой посетитель видит вход через Yandex ID. Связанный и уже перенесённый
профиль открывает прежний интерфейс FIT через Yandex API. Непривязанный или ещё
не перенесённый профиль получает понятный путь восстановления: один раз войти
по email и паролю и привязать Yandex ID. Email-вход остаётся доступен на время
rollback-окна.

## Acceptance cases

- `VITE_YANDEX_APP_SESSION_ENABLED=true` показывает общий вход через Yandex ID
  без публичного UUID allowlist.
- Сервер выдаёт `x-fit-session` только связанному профилю с активным
  `yandex/read_write` assignment; frontend-флаг не является авторизацией.
- `VITE_YANDEX_MAIN_ROUTING_ENABLED=true` направляет любую уже выданную Yandex
  app-session на Yandex API без отдельного UUID allowlist.
- Несовпадение FIT-профиля и Yandex session по-прежнему блокирует вход и
  отзывает полученный token.
- Непривязанный или не включённый профиль не получает сессию и видит инструкцию
  войти по email и привязать Yandex ID.
- Email/password, регистрация и восстановление пароля остаются доступными.
- Временная ошибка и timeout дают retry/reset и не оставляют бесконечный
  loading.
- Один manual-only workflow умеет inspect/enable/disable для всех связанных
  профилей с существующим role-specific доменным корнем; в ответе только
  агрегированные счётчики без UUID.
- Массовый enable выполняется только после успешных full-cohort dry-run и
  pinned apply. Оба frontend kill switch включаются только после этого.

## Релизные границы

1. Доставить код и private migration runner без изменения production env.
2. Выполнить `full-cohort` audit, dry-run и apply с подтверждённым fingerprint.
3. Выполнить batch `inspect`, затем batch `enable` для `linked-ready` профилей.
4. Включить `VITE_YANDEX_APP_SESSION_ENABLED=true` и
   `VITE_YANDEX_MAIN_ROUTING_ENABLED=true`, удалить устаревшие UUID allowlist и
   выполнить новый Vercel deployment.
5. Smoke: Yandex-вход тренера и клиента, чтение главной, одна безопасная
   mutation, выход и email fallback.
6. На время наблюдения rollback: выключить оба frontend switch новым deployment
   и batch-disable assignments. После mutations в Yandex нельзя считать
   переключение одного флага синхронизацией данных обратно в Supabase.

## Вне scope

- Создание нового FIT-профиля только из Yandex ID без предварительной
  регистрации.
- Немедленное удаление Supabase Auth и email fallback.
- Изменение информационной архитектуры главных страниц.
- Автоматическая двусторонняя синхронизация Supabase и Yandex после cutover.
