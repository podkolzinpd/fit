# Yandex-only Auth B2 — приглашение через OAuth

## Поток

`identity-runtime`

## Пользовательский результат

Незарегистрированный или вышедший пользователь открывает защищённую ссылку
`/invite?token=…`, видит отправителя и назначенную роль, входит либо создаёт
аккаунт через Yandex ID и возвращается к тому же приглашению. Старый
`/join?code=…` остаётся совместимым fallback. Ни один auth-поток не создаёт
связь без отдельного подтверждения пользователя.

## Acceptance cases

1. Публичный `/invite?token=<12 символов>.<64 hex>` получает безопасный preview
   через выбранный Supabase/Yandex transport и показывает отправителя, роль,
   срок и active/claimed/revoked/expired состояния. Bearer-token передаётся
   только в POST body, не выводится в логи и пользовательские тексты.
2. Валидный `/invite?token=…` или legacy `/join?code=<12 символов>` сохраняется
   в browser session перед Yandex OAuth, email login/registration и password
   recovery. После callback связанный или новый пользователь возвращается на
   исходный маршрут; bearer-token не добавляется в Yandex OAuth URL.
3. На `/invite` claim выполняется только после отдельного нажатия
   «Подключиться». Feature использует provider-neutral repository, а выбранный
   Supabase/Yandex adapter вызывает соответствующий RPC/API.
4. Ошибка OAuth/API и безопасный restart сохраняют приглашение. Успешный
   переход потребляет сохранённый контекст один раз; новый вход без приглашения
   очищает устаревший контекст.
5. В session storage принимается только точный внутренний `/invite` с одним
   валидным bearer-token либо legacy `/join` с одним 12-значным кодом. Внешний
   URL, другой маршрут, дополнительные параметры и fragment не могут стать
   redirect target.
6. При включённой Yandex app-session конфигурации вход через Yandex ID является
   единственным primary-действием login-состояния. Email/password остаются
   видимым secondary fallback для ещё не привязанных старых аккаунтов. При
   выключенном флаге прежний email-first экран не меняется.
7. Нативная регистрация получает целевую роль из проверенного preview, но
   по-прежнему показывает её пользователю и запрашивает имя,
   фиксирует юридическое согласие и не создаёт client card сама. Неверная роль,
   истёкшая, отозванная или использованная ссылка показываются отдельным
   `/invite` state и не откатывают уже созданный аккаунт; legacy-код сохраняет
   прежние `/join` состояния.
8. Поток проверяется unit/component тестами и WebKit на 390/430 px без
   горизонтального overflow для входа и регистрации.

## Матрица проверки

| Пункт | Видимый результат | Проверка | Статус |
| --- | --- | --- | --- |
| 1 | Защищённая ссылка показывает preview без входа | Supabase/Yandex repository + page tests | Готово |
| 2 | OAuth/email recovery возвращают на исходное приглашение | auth helper + callback component tests | Готово |
| 3 | Связь создаётся только после отдельного подтверждения | page component + legacy JoinPage E2E | Готово |
| 4 | Retry сохраняет, успех и новый flow очищают контекст | unit/component tests | Готово |
| 5 | Нельзя сохранить внешний или произвольный redirect | helper unit tests | Готово |
| 6 | Yandex ID — primary, email — secondary, flag-off без изменений | component + WebKit | Готово |
| 7 | Role/claimed/revoked/expired/invalid states явные | page/repository tests | Готово |
| 8 | `/invite` и регистрация на 390/430 px без overflow | WebKit screenshots/smoke | Готово |

## Границы

- Новых миграций и server API нет: PR использует контракт из #1037.
- Создание, отправка, QR и отмена защищённых ссылок остаются следующим PR.
- Автоматический claim без явного нажатия не добавляется.
- Production environment, rollout assignments и Vercel flags не меняются.
- Supabase runtime, email recovery и email UI не удаляются до отдельного
  cutover PR и окна стабилизации.
