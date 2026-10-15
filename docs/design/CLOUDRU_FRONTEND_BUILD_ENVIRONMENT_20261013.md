# Cloud.ru frontend: подключить штатное build environment

Владелец разрешил продолжить stage rollout после #1609. Base main447c283e.
При preflight обнаружено: repository secret metadata не содержит нужных
VITE_SUPABASE_URL/PUBLISHABLE_KEY и четырёх font parts; все шесть есть в
fit-frontend-candidate, который использует штатный Yandex hosted build.
Cloud.ru build job не указывал environment, поэтому получил бы пустые значения.
Значения секретов не читались, не копировались и не менялись.

## Acceptance и scope

1. Только hosted build подключается к existing fit-frontend-candidate.
2. Self-hosted prepare не получает environment/secrets; OIDC/production
   environment и права на облачные ресурсы не добавляются.
3. Exact-current-main green CI, required fonts, Cloud.ru API, no AI program,
   artifact integrity, private smoke и rollback сохраняются.
4. DNS/NS, public ingress, API configuration и DB/media не меняются этой правкой.

Targeted hosting/workflow41/41 passed; YAML и diff check passed. Полный
npm run check exit0: frontend2659/API1350+142standardDBskipped/hosting137/
infra253/lint/typecheck/build. Exact-head CI/merge/main CI/VM ещё гейты.
Это исправление rollout-конфигурации, не новый UI; WebKit/native/DB chain
локально не запускаются. Реальный frontend build на VM пока не подтверждён.
После merge нужен зелёный CI нового main, затем manual frontend preparation.
Пользовательский untracked CLOUD_RU_MIGRATION_RUNBOOK.md сохраняется.

## Новая post-merge фактура

Main447c283e/CI38456305705 green. Manual API release38460887601 success:
candidate health/ready/unauthorized, switch18080 и RUNNING_SHA readback
подтвердили exact447c283e. Public HTTPS/DNS не менялись, native auth E2E
этот smoke не доказывает. Media audit38460661553 только читал S3 inventory:
обе стороны2100objects/77256815bytes, pending0; содержимое файлов и свежесть БД
не подтверждены. Первоначальный SQL workflow запрещает повторный import в
nonempty target: до cutover нужен согласованный freeze/final snapshot, не
слепой повтор apply или ручное удаление target. Frontend environment fix всё
ещё должен пройти свой exact-head CI/merge и новый main CI перед VM запуском.

## Закрытая подготовка завершена — 14 октября

PR1610 прошёл весь CI38461484831 и штатно merged; main3f5bf3d8 прошёл
CI38466310247. Единственный manual frontend workflow38532114217 завершился
success: licensed fonts2/2,207verifiedfiles, real non-root candidate18083 и
serving18081 проверили bytes/MIME/cache/SPA/recovery/missing-assets. Current
promoted; guards сохранены, отказа/rollback в этом запуске не было. Ни public
nginx/DNS, ни API/БД/media этим frontend workflow не менялись. DNS readback
14октября: NS Yandex/root158.160.171.31, api A отсутствует; public ingress
workflows не запускались. Это закрытый static hosting smoke, не real OAuth
или authenticated user E2E. Frontend revision3f5bf3d8 работает с private
API447c283e; API source code между ними не менялся, environment/docs-only diff.

SQL-перенос уже состоялся13октября; необходимость повторного переноса не
доказана. До cutover нужно проверить актуальность относительно последующих
source writes. Если нужны новые данные, требуется отдельный согласованный
final snapshot/write control; blind apply на nonempty target запрещён.
Heartbeat cloud-ru-frontend-ci остановлен (PAUSED) после verified preparation,
по инструкции владельца. Следующий этап — только по отдельному решению.
