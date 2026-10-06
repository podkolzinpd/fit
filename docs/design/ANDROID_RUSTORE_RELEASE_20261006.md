# Android release для RuStore — 2026-10-06

## Результат

Подписанный APK `com.coachspace.fit`, versionCode 1 / versionName 1.0.
Источник зафиксирован на main e17ed22c860f99f19825bb3c7f93ad4e2ecc235d.
Публикация в магазине и PR не выполняются.

## Проверка

Manual-only rustore-release job собирает assembleRelease с production-config,
выравнивает APK, подписывает постоянным RSA-ключом и проверяет подпись,
выравнивание, package/version и отсутствие debuggable. Артефакт включает APK,
SHA256SUMS, отчёт подписи и source commit. При отсутствии signing secrets job
останавливается и не публикует неподписанный файл как release.

## Хранение ключа

Владелец явно разрешил создание и хранение ключа. Создан RSA4096 encrypted
PKCS12 на Mac вне Git, пароль в macOS Keychain; копия ключа и пароль сохранены
в environment secrets fit-frontend-candidate только для signing step. Ключ нельзя потерять
или заменить при следующем выпуске; нужна отдельная резервная копия владельца.

## Установка и ограничения

Debug APK и release APK имеют разные подписи: release не установится поверх
debug. Перед удалением debug завершить активную тренировку и дождаться
синхронизации; локальные несохранённые черновики при удалении могут пропасть.
Возврат из Yandex OAuth в debug-приложение владелец подтвердил на Android;
release-вход, диктовка и сценарий тренировки требуют проверки на устройстве.
Сборка GitHub Actions 37448377447 завершена успешно: assembleRelease,
zipalign16KB, apksigner verify v2/v3, package/version/non-debuggable проверены.
Скачанный APK дополнительно проверен SHA256 и совпадением сертификата с
локальным release-ключом. Артефакт 11404153316: fit-rustore-signed-release-1.0.
Файл fit-1.0-release.apk, 20 167 743 байта. Точный исходный main имел зелёный
CI; приложение не менялось, новый полный npm run check локально не запускался.
Проверка release на физическом телефоне и публикация в RuStore не выполнены.
