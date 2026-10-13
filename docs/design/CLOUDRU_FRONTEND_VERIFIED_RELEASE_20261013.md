# Cloud.ru frontend: проверка кандидата и откат выпуска

Base main26470c99, после merge#1608. Владелец потребовал отдельный PR:
«нужно отдельный пр сделать», «ну делай». Прежняя локальная ветка сохранена;
bootstrap/API/HTTPS из#1608 не дублируются и не удаляются.

## Результат и границы

Исправить дефект#1608: current переключался до Nginx/HTTP smoke, при ошибке
не восстанавливался. Один HTML не доказывал MIME/WASM/fonts/cache/recovery.

1. Сохранить CI-gated current-main и default-off automatic deployment.
2. Проверить пакет/checksums/конфигурацию до изменения serving frontend.
3. Пробовать кандидата на loopback18083 без остановки stage18081.
4. Повторить smoke после promotion; при ошибке вернуть current/config/unit,
   сохранить старые releases и красный статус job.
5. API origin Cloud.ru; программа Assistant выключена по прямому решению
   «мы делаем без ИИ функций». Остальные product flags прежние.

Никаких DNS/NS/IAM/CA acceptance, публичных listeners, API rollout, DB
migrations/restore/maintenance, secret/production env writes. UI/native код
не меняется. Если public web proxy включён отдельно, promotion меняет его
frontend, хотя public nginx/DNS этим PR не изменяются.

## Acceptance

- Верный SHA/checksums/metadata; stale SHA, corruption, traversal, symlink и
  изменённый Nginx config отклоняются.
- Все bytes/MIME/cache/nosniff, включая WASM/fonts, проверяются на настоящем
  Nginx; SPA/OAuth callback=index, stale JS=recovery, missing CSS/WASM/fonts=404.
- Happy promotion и probe/syntax/reload/smoke failures; возврат previous
  pointer/config/unit. Первый failed install убирает только созданные файлы.
- Probe имеет собственные PID/log/temp и работает без root рядом со stage.
- Public ingress/API/DB/DNS не меняются тестами или кодом этого PR.

## Проверки и ограничения

Targeted hosting/workflow/rollback прошли; real local Podman Nginx1/1 проверил
оба loopback порта и non-root CLI. Полный npm run check exit0: frontend2659,
API1350/142standardDB skipped, hosting136, infra253, lint/typecheck/build passed.
Final targeted48/48; YAML/Node/Bash syntax и diff check passed. Exact-head CI
ещё гейт. Схема не менялась: clean-chain/local:verify отдельно не запускались.
VM workflows/production не запускались. Пользовательский untracked
CLOUD_RU_MIGRATION_RUNBOOK.md не читается/не изменяется.

ERR/INT/TERM обрабатываются, SIGKILL/потеря VM — нет. Failed rollback явно
сообщается. Retention candidates/backups требует отдельного решения.
Hosted fonts required2/2 без fallback; local build без лицензий не visual proof.
Локально fonts0/2; UI/WebKit/native сборки не запускались — UI/native без diff.
Frontend rollback не равен обратному переносу БД/media: после новых writes
нужны остановка всех writers и reverse-transfer, пока не реализованный/испытанный.
Старые Yandex ресурсы сохраняются.
