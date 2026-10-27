# Проверка сотрудника Яндекса через Staff

Поток: identity-runtime. База: main 57423a94 от 27.10.2026.

Результат: после проверенного OAuth-входа собственный профиль получает
`yandexEmployee: { status: employee | not_employee | unknown, checkedAt }`.
Существующие роли, тренерские связи, права и каталог не меняются.

## Проверка существующего

- Переиспользуем YandexIdentityClient: OAuth token проверен на нужное приложение,
  внешние login и psuid получены непосредственно от провайдера.
- В main нет Staff integration или признака employee; login сейчас хешируется.
- Подтверждено через документацию Staff: `yandex.login_lower` — привязанный
  внешний аккаунт, подтверждённый владельцем через login-linker. Это не
  произвольный personal_emails и не внутренний staff login.
- Staff v4 доступен локально: синтетический запрос дал корректный пустой result
  с has_more=false. Персональные профили не выгружались.
- Подключение из production Cloud.ru и положительный реальный аккаунт не проверены.
- UI baseline не нужен: пользовательский интерфейс не меняется.

## Реализуемый контракт

1. Использовать только provider-verified login после проверки OAuth client_id;
   никогда не принимать email/login или employee flag из пользовательского запроса.
2. Проверять точное совпадение yandex.login_lower, affiliation=yandex,
   is_dismissed=false, is_robot=false, is_agent=false, is_deleted=false.
   Подстроки, guessed домены и поиск по имени не используются.
3. Один полный однозначный результат — employee; корректный полный пустой
   результат — not_employee. Ошибка, timeout, недостаточные права, неправильный
   формат, неоднозначность — unknown без перезаписи старого результата.
4. Staff timeout 1.5 секунды; сбой проверки или сохранения не ломает Yandex login.
5. Сохранять только subject SHA256, boolean и время начала проверки.
   Запись возможна до регистрации, чтобы текущий handoff не терял подтверждение.
   Поздний ответ более старого запроса не перезаписывает новый.
6. Читать только собственный статус по auth.uid() и auth_identities. Прямого
   доступа fit_api к таблице нет. Факт не назначает административные права.
7. Подтверждение действительно 24 часа. После этого status=unknown, checkedAt
   остаётся видимым. Обновление — при следующем полном OAuth-входе; восстановление
   сохранённой app-session не запрашивает Staff. Фоновое обновление/принудительная
   переавторизация в UI в эту задачу не входят.
8. Старые доказательства старше 7 дней удаляются при следующей успешной записи.
   Исходные login, email, UID Staff, анкеты и токены не сохраняются и не логируются.
9. Default-off: FIT_STAFF_EMPLOYEE_ENABLED=true и отдельный FIT_STAFF_OAUTH_TOKEN.
   Личный токен Стефании не копируется в сервис, frontend, repository или CI.

## Проверки

- Unit/API: точный login, другое OAuth-приложение, другие email,
  dismissed/robot/agent/external, потеря полей, неоднозначный ответ, Staff403/503,
  invalid JSON, injection, error сохранения, flag-off.
- Чистая PostgreSQL17 chain, собственный/чужой actor, запрет прямого table access,
  stale и out-of-order evidence, Down/Up новой migration.
- Перед включением: выделенный runtime доступ и сеть Cloud.ru → Staff;
  положительный smoke согласованным тестовым аккаунтом, отрицательный и отказ.
  Не включать production автоматически в рамках этого PR.

## Источники

- https://wiki.yandex-team.ru/staff/vodstvo/external-login
- https://staff-api.yandex-team.ru/v4/persons?_doc=1
- https://wiki.yandex-team.ru/staff/api


## Результат локальной проверки

- API check: lint, typecheck, 1541 passed / 200 conditional DB skips, build.
- Отдельная чистая PostgreSQL17: test:db 189 passed / 2 conditional skips;
  новая chain158, actor isolation и Down/Up подтверждены.
- Migration policy и git diff --check прошли.
- local:verify остановился на старой локальной цепочке: append_live_round
  already exists with same argument types. Существующая база не сбрасывалась.
  Это не ошибка новой migration158; независимая чистая chain158 прошла.
- Production credentials/network/реальный положительный аккаунт не проверены.
