# Cloud.ru — подготовка HTTPS без переключения сайта

Владелец: «готовь», затем «+» для прямого выпуска на Cloud.ru, не нового
Yandex Certificate Manager. Base main66243ebf. Поток: infrastructure/identity-runtime.

## Неизменяемый scope

1. Подготовить HTTPS на Cloud.ru, пока без переключения сайта и открытия
   записи в новую БД.
2. Пароли, ключи и ручные настройки от владельца не требуются.
3. Если потребуется принять условия выдачи сертификата — показать отдельно.
4. После готовности HTTPS отдельно согласовать короткое окно переключения.
5. До этого сайт остаётся на Yandex.

## Реализация и acceptance

- Existing manual current-main-CI workflow получает отдельный sealed-режим.
  Он не вызывает старый public ingress job и не меняет
  A/NS/MX, OAuth, API runtime/DB/media/maintenance/autodeploy flags.
- Certbot certonly/DNS-01 создаёт новые ключи непосредственно на VM. Нет
  Yandex-CM создания/download, OIDC/IAM grant или передачи старых ключей.
  Непосредственно перед реальным выпуском требуется подтверждение условий
  Let’s Encrypt и узкого DNS scope. Без обоих подтверждений fail closed.
- Публичная authoritative зона пока Yandex: root/www ACME CNAME уже заняты
  старым CM. Для DNS-01 нужны временные TXT вместо этих двух CNAME и новый
  api TXT; после выпуска ИЛИ сбоя исходные CNAME должны быть восстановлены,
  удаляются только созданные TXT. Этот DNS scope запрошен отдельно; workflow
  сам DNS не меняет и не получает DNS credentials. A/NS/MX не меняются.
- Auth hook публикует только публичные challenge name/type/value. Он ждёт
  точный TXT и отсутствие CNAME на обоих authoritative серверах и двух
  recursive resolvers, ограниченное время; нет обхода проверки CA. PEM/keys
  не печатаются/не экспортируются в artifacts/state/local env. Keys0600/dir0700.
- Проверяются exact SAN/domain набор, локальные Certbot archive paths,
  root ownership/private-key permissions, сроки, hostname,
  соответствие key/cert и цепочка через настоящий TLS/OS trust store.
- Отдельный candidate на loopback18443 до установки; рабочий TLS443 отвечает
  только503/closed JSON для GET/HEAD/POST/PUT/PATCH/DELETE/OPTIONS. Нет
  upstream/proxy/app-session/DB чтений или записей. Источник root/www остаётся
  Yandex. Не переписывать уже активированный public ingress или чужой site.
- Atomic config installation, rollback при syntax/reload/TLS smoke failure;
  candidate/root secrets cleanup только собственных новых временных файлов.
  SIGKILL/power-loss не называются успешно обработанным rollback.
- Real local Podman Nginx+TLS test и targeted guard tests; полный npm check,
  exact-head CI/обычный merge. Activation/public cutover — не эта задача.

## Проверено локально / гейты

Root fpqsgmijaus25eog4poq и www fpq5poa77tbn3mcfq3ij действительно Issued.
Source authoritative ACME CNAME и копии в Cloud.ru zone совпадают. Root/www A
остаются158.160.171.31/158.160.184.183, публичного api A нет. Новый Yandex
managed request не создавался. Закрытые ключи Yandex не читались, IAM/DNS/CA
terms не менялись. User untracked runbook нетронут.

Guard/workflow tests40/40, real local Podman Nginx/OS-trusted synthetic CA:
503 на7 методах/3 доменах, key/SAN/expiry/permissions, reload/serving rollback,
отказ поверх active public ingress/broken symlink, SIGTERM во время probe;
mocked issuer CA/DNS consent, fail/cleanup/cancel/reuse — passed.
Совместная проверка воспроизвела curl60 на API сразу после reload: старые
workers ещё предъявляли root certificate. После reload допускается только
ограниченное5s ожидание transient curl7/60; проверка CA/hostname, exact503/body
и все7 методов сохранены, HTTP/body/other failures не повторяются и откатываются.
Финальный npm run check exit0: frontend2659, API1360/142 штатных DB skips,
infra261, hosting137, lint/typecheck/coverage/build passed. Git diff check passed.
Настоящий CA выпуск и live VM TLS ещё НЕ ПРОВЕРЕНЫ; CI/merge впереди.
Browser E2E scope не ослаблялся; infrastructure changes остаются full/unknown.

Старые сертификаты Yandex остаются рабочими во время временной DNS-проверки;
их автоматическое продление снова возможно после восстановления CNAME.
Новые DNS-01 сертификаты — только подготовка: автоматическое продление на VM
пока НЕ подтверждено. Перед cutover обязательно Certbot reconfigure на webroot
HTTP-01 и успешный renewal dry-run после разрешённого маршрута на VM; deploy
hook/reload и timer включаются только в том этапе. Не считать manual DNS hook
автоматическим DNS provisioning. Sealed workflow запрещён после открытия proxy.
Это не production-ready cutover; свежая БД/контроль writers/OAuth — отдельные гейты.

Перед живым запуском нужны доступ к live job log с публичными TXT значениями
и к authoritative DNS console, readback исходных CNAME/TTL, согласие на
https://letsencrypt.org/documents/LE-SA-v1.8-July-06-2026.pdf и подтверждённый
temporary-DNS scope. Без этого CA job не запускается. После каждой попытки
проверить восстановление CNAME/удаление только собственных TXT, включая failure
и отмену; stdout restore_required — требование оператору, не доказательство DNS cleanup.
