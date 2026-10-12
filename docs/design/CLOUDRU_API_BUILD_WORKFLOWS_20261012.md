# Cloud.ru stage — разделение bootstrap и сборки API

Поток: assistant-ops. База: main39b57320; перед проверкой включён
main7fc90793 после PR1570. UI/API-контракт, Yandex production, migrations,
runtime secrets, IAM, DNS и запуск API-контейнера не меняются.
Пользовательский `CLOUD_RU_MIGRATION_RUNBOOK.md` не изменяется.

## Подтверждённая постановка владельца

Bootstrap завершён успешно: runner `fit-cloudru-stage` зарегистрирован и
работает как systemd-сервис. Registration secret и временное SSH-правило уже
удалены. Нужно исправить deployment workflows:

`.github/workflows/deploy-cloudru-stage.yml` оставить только для аварийного bootstrap:

- запуск только через `workflow_dispatch`;
- убрать trigger `push`;
- переименовать в `Bootstrap Cloud.ru stage runner`;
- он по-прежнему может временно требовать `CLOUDRU_RUNNER_REGISTRATION_TOKEN`.

Добавить отдельный workflow для обычных обновлений API:

- trigger: `push` в `main` при изменениях `services/api/**`;
- также оставить `workflow_dispatch`;
- `runs-on: [self-hosted, cloudru-stage]`;
- `permissions: contents: read`;
- не использовать SSH, приватный ключ или registration token;
- собирать образ локально на VM через Podman;
- записывать `$GITHUB_SHA` в `/opt/fit/DEPLOYED_SHA`;
- обновлять ссылку `/opt/fit/current`;
- пока не запускать API-контейнер — runtime secrets и migration dry-run ещё не проверены.

Сохранить предохранитель:

```yaml
if: github.event_name == 'workflow_dispatch' || vars.CLOUDRU_STAGE_AUTODEPLOY_ENABLED == 'true'
```

Сейчас `CLOUDRU_STAGE_AUTODEPLOY_ENABLED=false`. Сначала новый workflow нужно
один раз успешно запустить вручную. Только после этого менять переменную на `true`.

Для deploy-job использовать:

```yaml
runs-on: [self-hosted, cloudru-stage]
concurrency:
  group: cloudru-stage-vm
  cancel-in-progress: false
```

Добавить проверку перед сборкой:

```bash
test "$(hostname)" = "fit-stage-app"
sudo systemctl is-active --quiet \
  actions.runner.podkolzinpd-fit.fit-cloudru-stage.service
sudo podman info >/dev/null
```

Runner получает задания через исходящее HTTPS-соединение с GitHub. Постоянно
открывать входящий SSH для обновлений не требуется.

Итоговая схема: merge в main → GitHub ставит job runner’у с label cloudru-stage
→ runner на VM забирает код и собирает новую ревизию локально. Пока автодеплой
выключен, работает только ручной запуск.

## Acceptance и фактура

| Пункт постановки | Результат | Проверка / статус |
| --- | --- | --- |
| Bootstrap manual-only | Сохранён прежний путь аварийного восстановления, без push | Workflow contract test passed |
| Отдельные trigger/runner/permissions/guard/lock | Новый `deploy-cloudru-api-stage.yml`, default-off, main-only source | Contract tests passed; GH runner online/idle, flag=false readback |
| Проверки VM до сборки | Hostname/service/Podman, дополнительно repository/main/SHA | Isolated shell tests reject wrong ref/host/service/Podman/checkout |
| Podman build + SHA/current | Versioned archive, отдельный каталог попытки, image exists до записи, atomic file/symlink replacement | Isolated happy path passed; failed build/missing image сохраняют оба прежних указателя |
| Нет SSH/token/runtime/migrations | Нет ссылок на secrets/SSH, контейнер и migrations не запускаются | Contract + Bash/YAML syntax tests passed |
| Первый ручной запуск → enable | После зелёного PR CI и штатного merge — manual на main при false; только success позволяет true | Ещё не выполнено; не включать до этого гейта |

Локально после main7fc90793: workflow25/25, Bash/YAML, diff-check и полный
`npm run check` passed (API1327/1327 и штатно skipped142 DB cases, build).
Schema/runtime/UI не меняются, DB reset/ручной apply и локальная mobile/visual
приёмка здесь не требуются; обязательные CI-гейты не обходятся. Local fonts0/2
отсутствуют, licensed-font CI не отключается. Exact-head CI, merge и первая
реальная сборка на VM ещё гейты. Readback через GitHub подтвердил online runner с label cloudru-stage и
false; systemd/Podman на VM пока подтверждены владельцем, не этой локальной проверкой.
Не считать prepared SHA работающим API. Yandex data plane и мобильные сборки
этой инфраструктурной задачей не меняются.
