# Эксплуатация Fit V2

## Локальная разработка

Обычный запуск выполняется командой `npm run dev`: она запускает локальный Supabase и только затем frontend. Безопасные локальные URL и publishable key хранятся в committed-файле `.env.development`.

Development-сборка программно отклоняет любой Supabase URL, кроме `localhost` и `127.0.0.1`. Production URL и publishable key задаются только в Vercel. Их запрещено копировать в `.env.local`, `.env.development` или другие локальные env-файлы. Для сброса локальных данных используйте `npm run db:reset`.

## Перенос одного tenant в Yandex PostgreSQL

CLI `npm run tenant:migrate` подготавливает и проверяет перенос одного
изолированного trainer cohort. Он не меняет frontend routing, rollout assignment
или cloud resources. До двух отдельных репетиций и согласованного окна его
нельзя считать разрешением production cutover.

Секреты передаются только через окружение и не добавляются в аргументы, `.env`,
репозиторий или логи:

```text
FIT_TENANT_SOURCE_DATABASE_URL=<source PostgreSQL URL>
FIT_TENANT_TARGET_DATABASE_URL=<target PostgreSQL URL>
FIT_TENANT_MIGRATION_PASSPHRASE=<at least 20 characters>
FIT_TENANT_SOURCE_SSL_ROOT_CERT=<source CA file, required for remote>
FIT_TENANT_TARGET_SSL_ROOT_CERT=<target CA file, required for remote>
```

Базовая последовательность сначала выполняется только на локальных базах в
Podman:

```text
npm run tenant:migrate -- export --trainer-id <trainer-auth-uuid> --out <artifact.fit>
npm run tenant:migrate -- import --in <artifact.fit>
npm run tenant:migrate -- import --in <artifact.fit> --apply
npm run tenant:migrate -- validate --in <artifact.fit>
```

Первый `import` — обязательный dry-run: он открывает транзакцию, проверяет все
FK/unique/check constraints и checksums, затем делает rollback. `--apply`
фиксирует данные только после полной проверки. Повторный apply безопасен и
должен показать `inserted=0`. Существующие отличающиеся строки не
перезаписываются: операция завершается ошибкой и целиком откатывается.

Артефакт зашифрован AES-256-GCM, создаётся с правами `0600` и не
перезаписывается. Он всё равно считается чувствительным backup-файлом: хранить
его следует только в согласованном защищённом месте, а после закрытия rollback-
окна удалить по отдельной процедуре. В выводе допустимы только имена таблиц,
количества и необратимый fingerprint tenant-а.

Удалённое чтение или подключение заблокировано без одновременных
`--allow-remote` и:

```text
FIT_TENANT_REMOTE_CONFIRMATION=I_UNDERSTAND_REMOTE_DATABASE_ACCESS
```

Для remote `--apply` дополнительно требуется:

```text
FIT_TENANT_REMOTE_APPLY_CONFIRMATION=APPLY_TENANT_TO_YANDEX_POSTGRES
```

Эти значения — предохранители, не секреты и не замена явному подтверждению
оператора. Перед production export отдельно сверяются cohort, отсутствие общих
trainer-связей и pending push, freeze writes, target, backup и rollback plan.
Точные границы manifest и ограничения описаны в
`docs/design/YANDEX_TENANT_MIGRATION_TOOLING.md`.

## GitHub Secrets

В repository secrets должны быть настроены:

- `SUPABASE_ACCESS_TOKEN` — personal access token Supabase CLI;
- `SUPABASE_DB_PASSWORD` — пароль новой БД;
- `SUPABASE_PROJECT_ID` — `xwfuzfkuhblswpdludbc`.

После merge миграции применяет `.github/workflows/deploy-database.yml`. Запуск SQL через Dashboard запрещён. Publishable key может находиться в frontend deployment environment; service role и DB password — никогда.

Foundation UI Identity v1 является единственным production UI. Отдельного
rollout-переключателя, пользовательского preview allowlist и rollback-режима у
frontend больше нет. Историческая таблица `public.user_feature_flags` закрыта
для `anon` и `authenticated`; её физическое удаление выполняется только через
отдельное согласованное окно destructive migration.

Изменения `summarize-client-training` после merge выкатывает отдельный
`.github/workflows/deploy-summary-function.yml`. Он публикует только эту Edge
Function через Supabase API, не использует Docker и получает project id и access
token только из GitHub Secrets. `verify_jwt=false` сохраняется намеренно:
функция самостоятельно проверяет пользователя и его роль по bearer token.

Workflow не использует GitHub Environment: для приватного репозитория на GitHub Free эта возможность недоступна. Переход на environment secrets выполняется отдельно после подключения подходящего тарифа.

## Frontend hosting

Production и PR previews разворачиваются в Vercel через GitHub integration:

- repository: `podkolzinpd/fit`;
- framework preset: Vite;
- production branch: `main`;
- build command: `npm run build`;
- output directory: `dist`.

В Vercel для Production и Preview задаются только публичные frontend-переменные:

```text
VITE_SUPABASE_URL=https://xwfuzfkuhblswpdludbc.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<publishable key>
```

`SUPABASE_DB_PASSWORD`, `SUPABASE_ACCESS_TOKEN`, service-role key и OAuth Client Secret в Vercel не добавляются. После первого production deploy его канонический URL фиксируется в Supabase Auth URL Configuration:

Закрытый пилот Apple Health управляется build-time переменными Vercel:

```text
VITE_WEARABLES_ENABLED=true
VITE_WEARABLES_PILOT_USER_IDS=<auth-user-uuid-1>,<auth-user-uuid-2>
```

По умолчанию и при пустом allowlist интеграция скрыта. Изменение списка требует
нового deployment. UUID попадают во frontend bundle, поэтому этот механизм
служит только для rollout интерфейса и не является границей авторизации.

Ассистент в production доступен всем тренерам. Build-time переменная
Vercel остаётся мгновенным kill switch:

```text
VITE_ASSISTANT_NAV_ENABLED=true
```

По умолчанию production rollout включён; точное `false` скрывает вкладку и закрывает
маршрут для всех тренеров после нового deployment. `VITE_ASSISTANT_NAV_PILOT_USER_IDS`
и `VITE_ASSISTANT_NAV_PILOT_EMAILS` сохраняются только для изолированной local/preview-разработки
и в production игнорируются. Роль защищает `TrainerOnly`, данные и мутации — существующие
RLS/ownership-проверки.

Закрытый пилот приветствия в шапке «Сегодня»/«Кабинет» управляется build-time
переменными Vercel:

```text
VITE_TODAY_GREETING_ENABLED=true
VITE_TODAY_GREETING_PILOT_USER_IDS=<auth-user-uuid-1>,<auth-user-uuid-2>
```

Механизм default-off: по умолчанию, при пустом allowlist или любом значении
флага кроме точного `true` заголовок вкладки остаётся прежним («Сегодня»),
а строка приветствия — отдельным элементом ниже, как раньше. Изменение списка
требует нового deployment. UUID попадают во frontend bundle, поэтому этот
механизм служит только для rollout интерфейса и не является границей
авторизации: данные и мутации защищаются существующими RLS/ownership-
проверками.

Закрытый пилот привязки существующего FIT-аккаунта к Yandex ID использует
общие публичные настройки Yandex ID и две независимые build-time переменные:

```text
VITE_YANDEX_ID_PILOT_ENABLED=true
VITE_YANDEX_OAUTH_CLIENT_ID=<public Yandex OAuth client id>
VITE_YANDEX_API_BASE_URL=<https Yandex stage API base URL>
VITE_YANDEX_SESSION_LINKING_ENABLED=true
VITE_YANDEX_SESSION_LINKING_PILOT_USER_IDS=<auth-user-uuid-1>,<auth-user-uuid-2>
```

Механизм default-off: карточка привязки скрыта, пока
`VITE_YANDEX_SESSION_LINKING_ENABLED` не равно точному `true`, allowlist пуст
или текущий `actor.userId` отсутствует в
`VITE_YANDEX_SESSION_LINKING_PILOT_USER_IDS`. Изменение списка требует нового
deployment. UUID и публичный OAuth Client ID видны во frontend bundle, поэтому
allowlist не является границей авторизации: callback передаёт текущую
Supabase-сессию в stage API, а данные и мутации защищаются backend
ownership/RLS-проверками. OAuth Client Secret в Vite/Vercel frontend variables
не добавляется.

Полноценная browser-сессия после Yandex ID использует те же публичные
`VITE_YANDEX_OAUTH_CLIENT_ID` и `VITE_YANDEX_API_BASE_URL`, но имеет собственный
default-off rollout:

```text
VITE_YANDEX_APP_SESSION_ENABLED=true
VITE_YANDEX_APP_SESSION_PILOT_USER_IDS=<auth-user-uuid-1>,<auth-user-uuid-2>
```

Без точного `true`, при пустом allowlist или для профиля вне списка сессия не
сохраняется. До завершения OAuth внутренний UUID профиля неизвестен, поэтому
кнопка входа защищена глобальным kill switch, а настоящая серверная граница —
`profile_rollout_assignments` со значениями `provider=yandex` и
`access_mode=read_write`. Frontend повторно проверяет UUID после callback и при
каждом восстановлении. Изменение флага или списка требует нового deployment.

Opaque session token хранится в browser localStorage только для восстановления
после перезагрузки, передаётся API в `x-fit-session`, не попадает в URL, UI,
логи или аналитику и отзывается через API при выходе. Как и UUID allowlist, он
доступен исполняемому frontend JavaScript, поэтому защита от доступа к данным
остаётся на backend ownership/tenant-проверках.

Sticky routing основного Trainer Assistant имеет отдельный default-off rollout:

```text
VITE_YANDEX_ASSISTANT_ROUTING_ENABLED=true
VITE_YANDEX_ASSISTANT_ROUTING_PILOT_USER_IDS=<one-auth-user-uuid>
```

Общий `VITE_ASSISTANT_NAV_ENABLED=false` остаётся глобальным kill switch:
sticky-флаг выбирает backend и не может сам открыть скрытую вкладку
или прямой маршрут.

Флаг включается только при точном `true`; пустой/отсутствующий allowlist или
профиль вне него сохраняет прежний Supabase Assistant. Для первой репетиции в
списке должен быть ровно один заранее перенесённый тестовый trainer UUID. Этот
же UUID обязан входить в `VITE_YANDEX_APP_SESSION_PILOT_USER_IDS`, иметь
действующую `read_write` app-session и серверное назначение `provider=yandex`,
`access_mode=read_write`. UUID виден во frontend bundle и не
является авторизацией: Yandex API повторно разрешает actor через opaque session,
ownership и tenant-проверки.

После выбора backend все зависимости Assistant — история, turns/actions,
упражнения, разбор тренировки и сводки — используют только `x-fit-session` и
Yandex API. Ошибка Yandex показывается пользователю; автоматического fallback
на Supabase для отдельного запроса нет, чтобы один сценарий не создал записи в
двух БД. Несовпадение UUID текущего FIT actor и Yandex app-session блокирует
загрузку данных. Остальные вкладки и все пользователи вне rollout продолжают
работать через Supabase.

Изменение обеих build-time переменных требует нового deployment. Безопасный
rollback — установить `VITE_YANDEX_ASSISTANT_ROUTING_ENABLED=false` (или убрать
pilot UUID) и выполнить новый deployment; данные между backend автоматически
не синхронизируются, поэтому переключение допускается только после проверки
export/import и отсутствия незавершённых mutations.

Светлая и тёмная палитры Foundation UI Identity v1 доступны всем пользователям
и выбираются обычной настройкой темы в профиле. Отдельных Figma/dark pilot
переменных и allowlist нет. Обновлённый поиск клиентов также является штатным
интерфейсом и появляется по продуктовой логике списка.

- Site URL: `https://<production-domain>`;
- Redirect URLs: `https://<production-domain>/auth/callback` и `https://<production-domain>/auth/reset`;
- локальные `http://localhost:5173/auth/callback` и `http://localhost:5173/auth/reset` остаются разрешёнными для разработки.

OAuth на произвольных preview-доменах по умолчанию не разрешается. Если позднее подключается custom domain, Supabase и Google OAuth настраиваются на него до переключения трафика.

## MVP email registration

До подключения собственного домена и production SMTP подтверждение email при регистрации отключено. В Supabase Dashboard в `Authentication → Sign In / Providers → Email` настройка **Confirm email** должна быть выключена. Локальный Supabase повторяет это поведение через `auth.email.enable_confirmations = false`.

Регистрация собирает только имя, email и пароль; фамилия не запрашивается и не передаётся в Auth metadata. Поле `profiles.last_name` остаётся nullable для обратной совместимости и будущего добровольного заполнения профиля.

Password reset остаётся доступным технически, но не считается production-ready до подключения собственного домена и SMTP. После подключения SMTP решение об обязательном email confirmation оформляется отдельным изменением продукта и тестов.

## Приглашения клиентов

Тренер создаёт одноразовый 12-символьный код в карточке клиента и передаёт его
вне Fit. Код действует семь дней, хранится в БД только как SHA-256 и после
принятия атомарно связывает уже аутентифицированный аккаунт с карточкой. Новый
код той же роли отзывает предыдущий активный код; создатель может отозвать его
раньше вручную.

Email, Supabase service role и отправка письма в этом сценарии не используются.
Для production Supabase и Yandex stage действует один продуктовый контракт,
поэтому отдельная Edge Function `invite-client` и
`CLIENT_INVITE_REDIRECT_URL` больше не нужны.

## YandexGPT

`summarize-client-training` использует отдельный service account с ролью
`ai.languageModels.user` и API-ключом scope
`yc.ai.languageModels.execute`. В Supabase Edge Function secrets задаются:

```text
YANDEX_CLOUD_API_KEY=<server-only key>
YANDEX_CLOUD_FOLDER_ID=<folder id>
YANDEX_CLOUD_MODEL_ID=yandexgpt
```

Ключ нельзя добавлять в Vite/Vercel frontend variables. Функция отправляет в
Yandex Cloud только агрегаты завершённых тренировок и сохраняет usage модели
для контроля стоимости.

Stage API для Assistant turn (`POST /v1/assistant/turn`) принимает ровно один
opaque credential: read-only `x-fit-pilot-session` для изолированного pilot UI
или read-write `x-fit-session` для sticky-routed основного Assistant. Оба вместе
отклоняются. Actor-context задаётся PostgreSQL-транзакцией; отдельный Supabase
JWT, OAuth Client secret или новый YandexGPT secret endpoint-у не нужны.

## Google OAuth

Создайте отдельный Google Web OAuth client для V2 и добавьте redirect URI:

```text
https://xwfuzfkuhblswpdludbc.supabase.co/auth/v1/callback
http://127.0.0.1:54321/auth/v1/callback
```

В Supabase Auth включите Google provider и сохраните Client ID/Secret там. Secret не передаётся frontend. Для локального Supabase используйте переменные `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` и `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET`, затем включите provider в локальном `config.toml` только в личной конфигурации.

Frontend redirect для разработки: `http://localhost:5173/auth/callback`. Production frontend URL добавляется в allow-list Supabase после выбора hosting.

## Release gates

- GitHub branch protection для `main`: PR only, обязательные `app`, `database`, `e2e`.
- Зелёный CI и воспроизводимый `supabase db reset`.
- Закрытые пункты `FEATURE_PARITY.md` и visual comparison с baseline V1.
- Реальный Google OAuth smoke на production-like URL.
- Только после этого команда переходит в V2; архивирование V1 выполняется отдельным подтверждённым действием.
