# Yandex-only Auth B1 — нативная регистрация

## Пользовательский результат

Новый тренер или спортсмен создаёт FIT-аккаунт через Yandex ID без временного
email, пароля и Supabase Auth. После OAuth приложение атомарно создаёт профиль в
Yandex PostgreSQL, фиксирует принятие текущих юридических документов и выдаёт
обычную read-write FIT-сессию.

## Acceptance cases

1. При отдельном default-off флаге регистрация предлагает Yandex ID как
   единственное primary-действие; email-регистрация остаётся доступным fallback
   на время перехода.
2. Имя, роль и часовой пояс передаются только в body после PKCE callback; PII,
   OAuth code, provider token, subject hash и FIT session не попадают в URL,
   логи или пользовательский текст.
3. Тренеру создаются `profiles` и `trainers`. Спортсмену создаётся только
   `profiles`; собственная карточка по-прежнему появляется лишь после его
   явного действия или принятия приглашения.
4. Identity, профиль, server-side read-write assignment и принятие документов
   создаются одной DB-функцией. Повтор того же callback не создаёт дубль.
5. Нативная регистрация не может включить существующий linked-профиль и обойти
   rollout. Такой Yandex ID получает отдельный конфликт старого аккаунта.
6. Ошибка OAuth/API не оставляет бесконечный loading. Пользователь видит
   понятную ошибку и может безопасно начать OAuth заново.
7. Регистрация доступна только при одновременных
   `VITE_YANDEX_NATIVE_REGISTRATION_ENABLED=true`,
   `VITE_YANDEX_APP_SESSION_ENABLED=true` и
   `VITE_YANDEX_MAIN_ROUTING_ENABLED=true` с валидной публичной OAuth/API
   конфигурацией, а stage endpoint — только при серверном
   `YANDEX_NATIVE_REGISTRATION_ENABLED=true`. Оба независимых выключателя
   требуют точного значения `true`.

## Проверка

- DB integration: trainer/client, юридическое принятие, assignment, повтор,
  конфликт с linked identity.
- API: валидация, OAuth failure, конфликт, mismatch и успешная сессия без
  утечки токенов/PII.
- Frontend: flag-off, форма обеих ролей, callback success/error/restart,
  390/430 px WebKit и отсутствие горизонтального overflow.
- Полный `npm run check`; локальная Yandex migration chain через PostgreSQL.

## Вне scope

- Восстановление и перенос старого email-аккаунта.
- Приглашение до/после регистрации.
- Удаление email-входа и единый экран Yandex-входа.
- Production rollout или изменение Vercel environment без отдельной команды.
