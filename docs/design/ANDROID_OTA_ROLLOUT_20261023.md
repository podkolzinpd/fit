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
|1|Свежий подписанный APK1.1.1/code5|Native/sign/cert/alignment и установка|Подготовка|
|2|Доступный alpha-feed, автоматический compatible web release|HTTPS readback/CI/native runner и cold-start на телефоне|Подготовка|
|3|RSA/ABI/expiry/sequence и builtin fallback|Targeted/publisher/native regression, reset support|Подготовка|

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
