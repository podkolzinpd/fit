# Подключение ИИ-агента к Fit V2

Эта инструкция позволяет выдать ИИ-агенту доступ к приватному репозиторию,
подготовить локальное окружение и проверить, что оно готово к работе. Агенту не
нужны production-секреты, доступ к Vercel или hosted Supabase.

## Ожидаемый результат

Настройка завершена, если агент:

- видит приватный репозиторий `podkolzinpd/fit`;
- работает в отдельной ветке и может открыть pull request;
- установил зависимости из lock-файла;
- запускает локальные Supabase и frontend командой `npm run dev`;
- успешно выполняет `npm run check`;
- не сохранил токен GitHub или production-секреты в репозитории.

## 1. Что делает владелец репозитория

1. Узнайте GitHub-аккаунт, под которым будет работать агент. Предпочтителен
   отдельный machine user: его доступ можно отозвать независимо от личного
   аккаунта разработчика.
2. В GitHub откройте репозиторий `podkolzinpd/fit`, затем
   `Settings → Collaborators → Add people` и пригласите этот аккаунт.
3. Выдайте роль **Write**. Её достаточно для веток и pull request. Роль Admin,
   доступ к billing и изменение repository secrets агенту не нужны.
4. Убедитесь, что для `main` запрещён прямой push и изменения проходят через PR
   с обязательными проверками `app`, `database` и `e2e`.
5. Попросите владельца machine user принять приглашение. До принятия приглашения
   `gh repo view` и клонирование приватного репозитория будут возвращать ошибку.

Если используется организация с SAML SSO, владелец организации должен также
разрешить этому аккаунту доступ, а учётные данные агента должны быть отдельно
авторизованы для SSO.

## 2. Безопасная авторизация агента

Предпочтительный вариант — GitHub CLI. Авторизацию нужно выполнять в терминале
среды агента, а не передавать токен в промпте, чате, issue или файле проекта.

```bash
gh auth login --hostname github.com --git-protocol https --web
gh auth status --hostname github.com
gh repo view podkolzinpd/fit
```

Команда покажет одноразовый код и официальный адрес GitHub. Владелец machine
user подтверждает вход в браузере. GitHub CLI хранит учётные данные в системном
хранилище, если оно доступно.

Для полностью изолированной автоматической среды допустим fine-grained personal
access token с ограничением только на репозиторий `podkolzinpd/fit` и сроком
действия. Минимально нужны repository permissions:

- **Contents: Read and write** — чтение репозитория и push рабочих веток;
- **Pull requests: Read and write** — создание и обновление PR;
- **Metadata: Read-only** — добавляется GitHub автоматически;
- **Actions: Read-only** — только если агент должен смотреть результаты CI.

Токен передают через секрет-хранилище среды. Его нельзя вставлять в URL remote,
записывать в `.env*`, конфиги проекта или команды, сохраняемые в shell history.
Авторизация из уже безопасно заданной переменной выглядит так:

```bash
printf '%s' "$GH_TOKEN" | gh auth login --hostname github.com --with-token
```

Не запрашивайте `repo:admin`, управление secrets, удаление репозитория или доступ
ко всем репозиториям, если отдельная задача явно этого не требует.

## 3. Клонирование и рабочая ветка

```bash
gh repo clone podkolzinpd/fit
cd fit
git remote -v
git status --short --branch
git switch main
git pull --ff-only
git switch -c codex/<краткое-название-задачи>
```

Агент должен проверить, что `origin` указывает на
`https://github.com/podkolzinpd/fit.git` или эквивалентный SSH URL. Работать
напрямую в `main` нельзя.

Если репозиторий уже предоставлен агенту как готовая workspace, повторное
клонирование не требуется. Достаточно проверить `remote`, текущую ветку и
доступ через `gh repo view podkolzinpd/fit`.

## 4. Локальные инструменты

Нужны:

- Node.js и npm версий, совместимых с `package.json` и `package-lock.json`;
- Docker Desktop, Colima или другой Docker-совместимый runtime;
- Git и GitHub CLI;
- свободные локальные порты Supabase и порт `5173`.

Проверка:

```bash
node --version
npm --version
docker version
docker info
git --version
gh --version
```

Supabase CLI отдельно глобально устанавливать не нужно: проект использует
версию из `devDependencies` через npm scripts.

## 5. Установка и запуск Fit V2

Перед любыми изменениями агент полностью читает:

```text
AGENTS.md
docs/FIT_WORKFLOW.md
docs/CURRENT_STATE.md
```

`ARCHITECTURE.md`, `FEATURE_PARITY.md`, `docs/PRODUCT_WIKI.md` и материалы из
`docs/design/` читаются только релевантными текущей задаче разделами. После
подтверждённого merge агент сам обновляет rolling snapshot в
`docs/CURRENT_STATE.md`, не накапливая в нём историю.

Затем устанавливает точные зависимости из lock-файла и запускает проект:

```bash
npm ci
npm run dev
```

`npm run dev` поднимает локальный Supabase, а затем Vite на
`http://localhost:5173`. Безопасные локальные значения уже находятся в
закоммиченном `.env.development`.

Для пересоздания и проверки локальной базы:

```bash
npm run db:reset
npm run db:test
```

После сброса базы доступны только локальные демонстрационные аккаунты:

- тренер: `trainer@fit.local` / `FitLocal123!`;
- клиент: `client@fit.local` / `FitLocal123!`.

## 6. Секреты и внешние сервисы

Агенту для обычной разработки **не выдаются**:

- `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD` и service-role key;
- production Supabase URL и ключи;
- GitHub repository secrets;
- Vercel credentials;
- Google OAuth secret;
- Yandex Cloud API key.

Нельзя заменять `.env.development` production-конфигурацией. Локальная сборка
намеренно принимает только `localhost` и `127.0.0.1`. Если отдельная задача
действительно требует внешнего секрета, владелец выдаёт его через секрет-хранилище
среды с минимальными правами и сроком действия; агент не печатает его в логах.

Файлы `.env`, `.env.local` и другие локальные env-файлы не коммитятся. Перед
push агент проверяет:

```bash
git status --short
git diff --check
git diff --cached
```

## 7. Проверка готовности и первый PR

Полная локальная проверка:

```bash
npm run check
```

Для изменений БД дополнительно обязательны:

```bash
npm run db:reset
npm run db:test
```

После изменения агент отправляет только рабочую ветку и создаёт PR:

```bash
git push -u origin HEAD
gh pr create --fill
gh pr checks --watch
```

В описании PR агент перечисляет пользовательский результат, выполненные
проверки, изменения БД и документации, а также известные ограничения. Сбой
авторизации исправляется перевыдачей или повторной авторизацией учётных данных,
а не публикацией токена в чате.

## 8. Отзыв доступа

После окончания работы владелец удаляет collaborator или отзывает fine-grained
token. В среде агента выполняется:

```bash
gh auth logout --hostname github.com
```

Если токен мог попасть в лог, prompt, commit или artifact, его нужно немедленно
отозвать в GitHub и создать новый; простого удаления строки из файла недостаточно.
