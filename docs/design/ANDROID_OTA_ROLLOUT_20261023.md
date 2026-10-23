# Android APK и публикация OTA — 23 октября 2026

## Запрос владельца

«Давай делай свежий APK и включай OTA, чтобы обновления интерфейса уже приезжали в приложение».
Владелец разрешил подписанный APK, использование существующих ключей, публикацию alpha-feed и автоматические совместимые web-обновления. RuStore submission не запрошен.

## Исходный acceptance-контракт

1. Один раз выпускаем новый APK с механизмом обновления.
2. Дальше оформление, тексты и веб-логику обновляем без установки APK — например, при следующем запуске.
3. Проверяем подпись обновления и совместимость с оболочкой; при неудачном запуске возвращаем предыдущую рабочую версию.

Фактический безопасный fallback текущего SDK — встроенная версия APK. Нативные/lock-зависимости и разрешения требуют нового APK.

## Сверка существующего

| Уже работает | Переиспользуем | Меняем | Не проверено |
| --- | --- | --- | --- |
| PR1726/main a1d3740b: native downloader, verifier, staged startup и20s fallback | LiveUpdate, AppErrorBoundary, RSA trust root, исходный APK certificate, Cloud.ru runner | Main-only release workflow, APK1.1.1/code5, atomic signed feed publication и автоматический выпуск после web | Новый APK на физическом Android и настоящий cold-start OTA; старое видео не доказывает новую сборку |

Baseline: main3f4c4047; OTA-адрес старой ABI отвечает404. Видео владельца: веб-каталог с новыми карточками/контролами, APK со старым каталогом. APK19.10 старше текущего web main. Продуктовые flags/allowlists сохраняются побуквенно из web workflow (кроме canonical native API origin); новый UI не создаётся.

## Выпуск и проверки

- Новый workflow допускает только current-main с полным успешным CI. Автоматический запуск — только после successful Prepare Cloud.ru frontend и FIT_ANDROID_OTA_AUTODEPLOY_ENABLED=true; manual также умеет signed reset.
- Отдельный protected-environment secret FIT_ANDROID_OTA_PRIVATE_KEY; временный0600 файл удаляется, приватный ключ не входит в артефакты. APK подписывается исходным keystore; certificate/non-debuggable/16KB/code5 проверяются.
- Publisher перепроверяет RSA manifest/ZIP, commit/ABI/nativeBuild/provenance/expiry/sequence, сохраняет immutable ZIP, проверяет публичное скачивание до atomic manifest. Nginx меняется узкой вставкой с backup/test/reload/rollback; API/DB/product flags прежние.
- Последующие compatible main web-releases публикуются автоматически. Native/locked dependency change создаёт другую ABI и требует нового APK; старый feed не получает несовместимый bundle.
- Не подменять physical-device evidence unit/Robolectric-проверкой. Установка нового APK владельцем и повторный холодный запуск нужны для финальной телефонной приёмки.

## Матрица

| Пункт | Результат | Проверка | Статус |
| --- | --- | --- | --- |
|1|Свежий подписанный APK1.1.1/code5|Native/sign/cert/alignment и установка|Сборка проверена; физический телефон НЕ ПРОВЕРЕНО|
|2|Доступный alpha-feed, автоматический compatible web release|HTTPS readback/CI/native runner и cold-start на телефоне|Feed опубликован; автоматический путь проверяется; физический cold-start НЕ ПРОВЕРЕНО|
|3|RSA/ABI/expiry/sequence и builtin fallback|Targeted/publisher/native regression, reset support|Автопроверки passed; физический fallback НЕ ПРОВЕРЕНО|

При новой ABI автоматическая публикация останавливается с `OTA_NATIVE_APK_REQUIRED`;
требуется manual `make_apk=true`, native tests и фактическая подпись нового APK.
Это не выдаётся за доставленное обновление старым оболочкам.

## Локальная приёмка до PR

- Полный npm run check exit0: frontend2819/API1445+188штатныхDBskip, lint/typecheck/политики/build/startup passed. Существующие API dependencies переиспользованы только при идентичном lock; symlink удалён.
- OTA/maintenance36/36, publisher/crypto/ABI/certificate10/10, WebKit startup/auth offline-retry2/2 passed.
- Native SDK35 Robolectric: OTA3+existing1; Gradle testDebugUnitTest BUILD SUCCESSFUL, новый code5. Никаких production API/DB данных в локальной проверке нет.
- YAML и actionlint passed; real Nginx routing gate добавлен в Android PR job и release job. Локально Nginx отсутствует, Podman socket connection refused; это не выдано за выполненную Nginx-проверку.
- Перед новой ABI автоматический выпуск явно падает OTA_NATIVE_APK_REQUIRED; существующая ABI допускает compatible interface release. Дисковый резерв2GiB сохраняется.
- Автоматический review отдельно заблокировал передачу OTA private key в конкретный GitHub environment secret; подтверждение запрошено у владельца. Сам ключ не передан, защита не обходилась. APK использует уже разрешённый исходный signing key и загружается отдельно до OTA-подписи.

Владелец отдельно подтвердил сохранение OTA private key в FIT_ANDROID_OTA_PRIVATE_KEY
окружения fit-frontend-candidate репозитория podkolzinpd/fit. Secret сохранён; проверено
только наличие имени, значение не читалось и не выводилось.
Nginx integration запускает daemon с inherited stderr и bounded start timeout:
перехваченный pipe нельзя удерживать открытым дочерним daemon-процессом.

Перед публикацией publisher проверяет `/health` canonical API: status ok и exact
source revision. Новый интерфейс не выпускается вперёд своего backend. После merge
нужно дождаться штатного API/frontend выпуска этого main; новая API-схема не добавляется.

## Приоритет выпуска — прямое решение владельца23.10

Владелец явно разрешил выпустить APK/OTA PR1789 раньше активных PR1787/1788
после зелёного CI нашего PR. Это исключение только из порядка выпуска; обязательные
гейты сохранены. Финальная интеграция обновлена от main70b86892 (#1784).
Не включённые сейчас compatible UI-изменения придут штатным OTA после их
собственного одобренного main/frontend выпуска.

Финальная интеграция f58a4446 от main70b86892: полный npm run check exit0,
frontend2821/API1445+188штатныхDBskip/infra341/hosting191/build/startup passed.
Native/source gate и real Nginx дополнительно прошли Android run39935663494
(предыдущий head e3350cba); новые upstream изменения относятся к browser Wake Lock.
Для итогового PR head остаётся обязательным его собственный green CI.


## Фактический выпуск и исправление loopback — 23.10

PR1789 merged main296422e3; полный CI39941826272 attempt2 success,
Android39941826284 success. Штатные API39947781580/frontend39947781521
success. Release39949288482 собрал и подписал APK1.1.1/code5 исходным
сертификатом; artifact12500296137. OTA artifact12499872235 подписан.
Публикация остановилась до установки ZIP/Nginx/manifest: Node fetch canonical
API из самой VM получил connect timeout (hairpin public IP). Это не активация OTA.

Узкое продолжение использует loopback HTTPS для API/OTA readback на той же VM:
canonical Host/SNI, rejectUnauthorized=true, только два разрешённых origin/path,
без redirects и с bounded body. Это тот же маршрут Nginx с действительным TLS,
как существующий curl --resolve в штатном frontend release. Внешняя проверка
feed и ZIP дополнительно выполняется с клиентского origin после публикации.
Native ABI/ключи/флаги/продуктовый интерфейс не меняются. Реальный локальный TLS
тест проверяет доступ с правильным hostname и отказ неправильному сертификату.

Loopback follow-up: targeted9/9 и полный npm run check exit0: frontend2821,
API1445+188штатныхDBskip, hosting193, infra341, lint/typecheck/build passed.
Native ABI сохранилась a544771e; новая физическая установка не проверена.

Интеграция mainb4f2d757 (#1788) без конфликтов; повторный полный npm run check exit0: frontend2821/API1445+188штатныхDBskip/hosting193/infra341/build. Native ABI и ключи прежние; свежий CI интегрированного head обязателен.


## Публикация после loopback исправления

PR1790/main3b31960a: full CI39963404387 attempt2 success,
Android39963404380 success; API39967296832 и frontend39967296936 success.
Release39967422365 собрал APK1.1.1/code5 и signed OTA из того же main.
Независимо проверены APK certificate/16KB/non-debuggable/SHA256/marker/trust root.
APK SHA256 b40bcb82d909d501109934abe4dce760c026840416a8a2e4546f1f075690bb15.
Оба publish attempt остановились на archive readback непосредственно после
reload, Nginx восстановлен, metadata не активирована. Точный HTTP status старый
publisher не сохранил; нельзя считать reload race единственной доказанной причиной.

Следующее узкое исправление закрывает два проверяемых механизма: явные755/644
только внутри public OTA tree независимо от runner umask (родители/секреты не
меняются), и bounded10s ожидание exact ZIP после async reload перед metadata.
HTTP status сохраняется в технической ошибке без тела ответа. Постоянный mismatch
заканчивается rollback; подпись/sequence/source/ABI gates остаются. Добавлены
регрессии strict umask, stale200→exact ZIP, bounded403/mismatch, настоящий Nginx
reload из старого frontend в OTA location. APK/native ABI не меняются.

Readiness follow-up: полный npm run check exit0 (2821frontend/1445API+188штатныхDBskip/hosting195/infra341/build), targeted11/11; ABIa544771e прежняя. Podman machine start сообщает success, но inspect сразу stopped и socket refused, поэтому local real Nginx НЕ ПРОВЕРЕНО. Реальный reload является обязательным Android/release CI gate.


## Первая успешная публикация — 23.10.2026

- PR1791/main93427f904f0cec6f161e99e6ad3fcdc4d639fc16: CI39977471077,
  Android39977471291 success. API39980518144/frontend39980518166 success.
- Release39982202146 success, все source/build/publish gates зелёные. Реальный
  Nginx reload прошёл в PR Android39970296581 и release. Локальная Podman-проверка
  по-прежнему не заявляется выполненной.
- [Подписанный APK1.1.1/code5](https://github.com/podkolzinpd/fit/actions/runs/39982202146/artifacts/12514825178),
  SHA256 `ea4a2a6818f3e534da5c8451884aa0bcdc3f582d7d824025e3ff1231dd6ea720`.
  Исходный certificate, non-debuggable,16KB alignment, embedded marker и trust root
  независимо сверены. APK source93427f90, ABI не менялась.
- Публичный [alpha manifest](https://fit-training.ru/mobile-updates/android/alpha/a544771ede963038579c11c26b46b4e5392b172cc7430896d7c9ea36503dcfb0/latest.json)
  и ZIP вернули200 в настоящем Chromium с origin `https://localhost`.
  Manifest RSA, ZIP RSA/checksum, source/ABI, no-store и неизвестный404 путь passed.
  Bundle `8f7ec9589da7f3120ec81c8d10ac6aa4511712722c80ecbd5d811de9aac2bbe0`,
  sequence1792771105508, archive15022521bytes.
- После этого установлен и прочитан `FIT_ANDROID_OTA_AUTODEPLOY_ENABLED=true`.
  Следующие совместимые main/frontend выпуски используют этот же native ABI;
  изменившиеся native/lock dependencies по-прежнему требуют нового APK.
- Эта отдельная docs-квитанция фиксирует новую существенную post-merge фактуру
  первой активации и служит проверкой реального автоматического OTA-пути без
  нового APK. До её выпуска автоматический workflow end-to-end НЕ ПРОВЕРЕНО;
  результат сохраняется в описании PR-квитанции после его завершения.
- Владелец отложил проверку телефона. Установка, настоящий cold-start и fallback
  на физическом Android НЕ ПРОВЕРЕНО. Автоматические проверки это не заменяют.
