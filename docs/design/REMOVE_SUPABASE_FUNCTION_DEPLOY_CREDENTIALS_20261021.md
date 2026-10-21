# Supabase credentials в function deploy

Поток assistant-ops. База main7a1adf96 (#1758 merged); ветка
codex/remove-supabase-function-deploy-secrets. Более ранний активный PR1759
идёт первым при merge. Production build/version не устанавливалась;
remote apply/secret reads/изменение ресурсов не выполняются. UI/роли/темы/флаги
не меняются, пользовательский маршрут не затронут.

## Подтверждённая постановка (дословно)

Давай уберём Supabase credentials из deploy summary и Assistant и синхронизацию push transport в Supabase Vault. Сами функции, промпты и native-поведение сохраняем. Дождись зелёного CI.

## Проверка существующего

| Уже работает | Переиспользуем | Действительно меняем | Не проверено |
| --- | --- | --- | --- |
| Native handlers / LLM gateway | function packages | Supabase checks/mounts в summary/Assistant workflows | Remote invocation |
| Immutable mounts / candidate verification / rollback | existing release verifier | Ничего | Production rollout |
| Native push pipeline | sender / dispatch / VAPID keys | Удаление Vault sync step/script | Реальная доставка на устройство |
| Policy coverage | yandex-lockbox-mounts test | Negative credential/sync checks, native mounts retained | Remote secrets/IAM не инспектировались |

## Неизменяемая приёмка

1. Summary/Assistant workflows не требуют и не монтируют Supabase credentials.
   Native LLM keys, pinned version, function names/runtime/package и verifier/rollback сохраняются.
2. Push workflow не читает dispatch secret для Supabase Vault, не вызывает
   Management API; sync script и его три obsolete tests удалены из infra command.
   Native push/VAPID mounts и verifier/rollback сохраняются.
3. Исходники функций, prompts/native API behavior и media не меняются.
   Existing Lockbox names, remote secret values, IAM и старые Vault entries
   остаются прежними; отключение legacy producers не входит в задачу.
4. Применимые локальные проверки и весь обязательный CI зелёные до передачи PR.

## Доказательства

- Negative credential policy воспроизведён до изменений workflow.
- Existing policy test расширен без новых browser cases; три теста удалённого
  Vault writer заменены отсутствием writer/credentials в workflow. Native
  mount и rollback assertions сохранены/проверены. Protected inventory прежний.
- Targeted9/9: lockbox mounts, release verifier, external credential selection.
- Unreviewed workflow/package paths по scripts/e2e-scope.mjs требуют full;
  классификатор не меняется. Fullcheck exit0 (workers4): frontend2796/API1434+186conditionalDBskip/infra329/calendar12/hosting184/lint/typecheck/build/startup. CI ожидается.
- Workflow parity3/3; bash syntax18 run blocks passed. Runtime source trees и lockfiles без изменений.
- Не выполнялись production/paid LLM calls, remote deploy или secret rotation.
