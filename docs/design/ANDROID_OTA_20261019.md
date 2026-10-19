# Android OTA — 19 октября 2026

Поток: identity-runtime, только native bootstrap/release tooling.
Базовый main: 008c20b707f671ca22fddcfe412e5acb3d4ab887.
Ветка: codex/android-ota. По последней прямой команде владельца PR пока не создаётся.
Tracker отложен в CURRENT_STATE; внешний тикет не создаётся.

## Согласованный пользовательский результат (исходный порядок)

1. Один раз выпускаем новый APK с механизмом обновления.
2. Дальше оформление, тексты и веб-логику обновляем без установки APK — например, при следующем запуске.
3. Проверяем подпись обновления и совместимость с оболочкой; при неудачном запуске возвращаем предыдущую рабочую версию.

Новый APK всё равно понадобится для изменений нативных плагинов, разрешений Android и самой оболочки.
Перед внедрением нужно отдельно проверить требования RuStore к таким обновлениям.

## Реализация и acceptance

- MIT @capawesome/capacitor-live-update 8.7.1 (notice включён в public/licenses), без аккаунта/телеметрии/Capawesome Cloud. Runtime io.ionic:liveupdateprovider:1.0.0 (MIT) включён явно: плагин ссылается на его exception types при class loading; notice сохранён. Только downloadBundle/setNextBundle/ready/reset.
- Фоновая проверка при старте Android. Текущая тренировка/диктовка/форма не перезагружается; скачанный bundle применяется при следующем native process launch.
- Два RSA-SHA256 подтверждения: подписанный JSON-манифест и native-проверка ZIP. Отдельный OTA private key в ignored .env.android-ota, не ключ подписи APK. Только публичный ключ входит в исходники и APK.
- Подписанный manifest связывает app/platform/channel, hash native-контракта, точный versionCode, срок действия/sequence и content-addressed URL на fit-training.ru. Отказ при иной подписи, ABI/version, URL, expired/replayed manifest, повреждённом архиве.
- Native ready timeout20s возвращает **встроенную проверенную версию APK** и блокирует неудачный bundle. Это безопасный fallback; не обещаем переключение к произвольному предыдущему скачанному выпуску.
- ready вызывается после React commit внутри существующего AppErrorBoundary, независимо от ответа API/входа/сети. Web/iOS не скачивают Android OTA. Статический Web Push SW не кеширует ресурсы — его поведение сохраняется.
- Сеть недоступна, feed отсутствует/повреждён, download/signature отказали: остаётся текущая версия; только стабильный диагностический код без PII. Для ручного возврата: новый signed sequence с release:null, builtin активируется при следующем запуске.
- FIT_ANDROID_OTA_ENABLED по умолчанию false; тестовый native build включается явно. Канал alpha, публичного rollout нет. Native code4/version1.1.0.
- Existing UI/components/tokens/AppErrorBoundary сохраняются, новых экранов/primary-действий/палитры нет.
- Auth/API/domain/data/БД/LLM/SpeechKit/push/rollout allowlists не меняются. Production endpoint только Cloud.ru api.fit-training.ru; старый Yandex не используется.
- Публикация требует отдельного хранения OTA вне retention frontend releases, readonly HTTPS/CORS для https://localhost, atomic signed manifest last. Скрипт упаковки только создаёт offline artifact, не меняет сервер.

## Проверки (обновляются по факту)

- TypeScript/typecheck и целевой ESLint passed. Frontend2796/2796, infra321/321, calendar12/12, hosting171/171 прошли в полном check; API отсутствовал в свежей worktree, после reuse идентичного lock — lint/typecheck1441/1441+164 standard DBskip/build passed. Production web build и WebKit startup/auth offline/retry2/2 (390/430) passed.
- Криптография, version/ABI/expiry/replay, прерванная загрузка, blocked bundles, no reload:30/30 unit/component; Node packaging/ABI2/2 passed.
- После явного согласия владельца Android SDK License принят, SDK установлен во временный каталог. Native OTA3/3 + existing1/1 Robolectric passed: реальные downloader/signature/extraction/SharedPreferences/Bridge/20s rollback и blocked ID. Только отсутствующий Chromium ServiceWorker provider и WebView package metadata — browser fixtures; это не physical-device acceptance. APK signing/GitHub artifact явно разрешены, RuStore/feed не публикуются.
- Первый check остановился на регистрации .d.mts в tsconfig; исправлено без ослабления lint. Следующий прошёл frontend/infra/hosting, остановился на отсутствовавших API dependencies; этап API повторён успешно. Финальный сквозной npm run check прошёл; maintenance recovery дополнительно проверен без запуска auth/data providers. NoClassDefFoundError устранён включением runtime Ionic contracts, не test-only заглушкой. Kotlin/Gradle generated cache исключён из ABI; существующий тест проверяет стабильность до/после .kotlin generation. Сквозной check повторно exit0; после final native/cache fix целевые Node2/2 и native4/4 passed. Signed candidate CI ещё гейт.
- RuStore: опубликованный раздел requirement-apps изучен19.10; явное правило про OTA/интерпретируемый JS не найдено. Разрешение магазина не доказано. Публикация feed и новый store APK — до уточнения не выполняются.

## Матрица исходного плана

| Пункт | Результат | Доказательство | Статус |
| --- | --- | --- | --- |
|1|APK1.1.0 со встроенным fallback и плагином|native build/install|В работе|
|2|Фоновая загрузка, активация только при следующем старте|runner tests/native acceptance|В работе|
|3|RSA подписи/ABI/version и native timeout rollback|crypto tests/native acceptance|В работе|
