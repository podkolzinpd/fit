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
- Фоновая проверка при старте Android. Текущая тренировка/диктовка/форма не перезагружается; скачанный bundle применяется при новом запуске native Activity/WebView.
- Два RSA-SHA256 подтверждения: подписанный JSON-манифест и native-проверка ZIP. Отдельный OTA private key в ignored .env.android-ota, не ключ подписи APK. Только публичный ключ входит в исходники и APK.
- Подписанный manifest связывает app/platform/channel, hash native-контракта, точный versionCode, срок действия/sequence и content-addressed URL на fit-training.ru. Отказ при иной подписи, ABI/version, URL, expired/replayed manifest, повреждённом архиве.
- Native ready timeout20s возвращает **встроенную проверенную версию APK** и блокирует неудачный bundle. Это безопасный fallback; не обещаем переключение к произвольному предыдущему скачанному выпуску.
- ready вызывается после React commit внутри существующего AppErrorBoundary, независимо от ответа API/входа/сети. Web/iOS не скачивают Android OTA. Статический Web Push SW не кеширует ресурсы — его поведение сохраняется.
- Сеть недоступна, feed отсутствует/повреждён, download/signature отказали: остаётся текущая версия; только стабильный диагностический код без PII. Для ручного возврата: новый signed sequence с release:null, builtin активируется при следующем запуске.
- FIT_ANDROID_OTA_ENABLED по умолчанию false; тестовый native build включается явно. Канал alpha, публичного rollout нет. Native code4/version1.1.0.
- Existing UI/components/tokens/AppErrorBoundary сохраняются, новых экранов/primary-действий/палитры нет.
- Auth/API/domain/data/БД/LLM/SpeechKit/push/rollout allowlists не меняются. Production endpoint только Cloud.ru api.fit-training.ru; старый Yandex не используется.
- Публикация требует отдельного хранения OTA вне retention frontend releases, readonly HTTPS/CORS для https://localhost, atomic signed manifest last. Скрипт упаковки только создаёт offline artifact, не меняет сервер.

## Решение о запуске

Один module Promise хранит только результат запуска native bootstrap, без auth/product/server state. Это ограниченное архитектурное решение предотвращает повторные ready/download при React StrictMode; процессные и продуктовые состояния в этот singleton не добавляются. Приложение продолжает использовать существующие TanStack Query и provider contracts.

## Проверки (обновляются по факту)

- TypeScript/typecheck и целевой ESLint passed. Frontend2796/2796, infra321/321, calendar12/12, hosting171/171 прошли в полном check; API отсутствовал в свежей worktree, после reuse идентичного lock — lint/typecheck1441/1441+164 standard DBskip/build passed. Production web build и WebKit startup/auth offline/retry2/2 (390/430) passed.
- Криптография, version/ABI/expiry/replay, прерванная загрузка, blocked bundles, no reload:30/30 unit/component; Node packaging/ABI и SDK certificate-format regression3/3 passed.
- После явного согласия владельца Android SDK License принят, SDK установлен во временный каталог. Native OTA3/3 + existing1/1 Robolectric passed: реальные downloader/signature/extraction/SharedPreferences/Bridge/20s rollback и blocked ID. Только отсутствующий Chromium ServiceWorker provider и WebView package metadata — browser fixtures; это не physical-device acceptance. APK signing/GitHub artifact явно разрешены, RuStore/feed не публикуются.
- Первый check остановился на регистрации .d.mts в tsconfig; исправлено без ослабления lint. Следующий прошёл frontend/infra/hosting, остановился на отсутствовавших API dependencies; этап API повторён успешно. Финальный сквозной npm run check прошёл; maintenance recovery дополнительно проверен без запуска auth/data providers. NoClassDefFoundError устранён включением runtime Ionic contracts, не test-only заглушкой. Kotlin/Gradle generated cache исключён из ABI; существующий тест проверяет стабильность до/после .kotlin generation. Сквозной check повторно exit0; после final native/cache fix целевые Node2/2 и native4/4 passed. Полный CI runtime bc5465d5 /39285521854 success, включая полную browser/visual матрицу. Native/signed artifact final24c1087f /39288099934 success, artifact12205365975; последующие изменения касаются только release tooling/workflow, не приложения.
- RuStore: опубликованный раздел requirement-apps изучен19.10; явное правило про OTA/интерпретируемый JS не найдено. Это не подтверждение магазином механизма OTA и не прохождение модерации. Feed/store submission в этой задаче не выполнялись; отдельное production-включение требует команды владельца по обычному rollout-контракту.

## Матрица исходного плана

| Пункт | Результат | Доказательство | Статус |
| --- | --- | --- | --- |
|1|APK1.1.0 со встроенным fallback и плагином|native build/sign + install позже|Кандидат готов, телефон отложен|
|2|Фоновая загрузка, активация только при следующем старте|runner tests/native acceptance|Локально/CI passed, rollout off|
|3|RSA подписи/ABI/version и native timeout rollback|crypto tests/native acceptance|Локально/CI passed, телефон отложен|

## Release-кандидат и границы проверки

- Локальный signed APK1.1.0/code4: source bc5465d5795027c576b6b566e3e60876491de0cc, SHA256 640b7f25f38172cccdf07608a844599733718e05069cceb5d2532952054b0f67, ABI1b18e69d0c8ba4185654c0e1dbd2b81615acd97829ad6377e157c0626b306f92. Сохранён в android/app/build/ota-release-bc5465d5, не в Git.
- Сертификат сверён с настоящим artifact release1.0.2 из37781115572: тот же a933c356832d86e306408963056e3662094c3cd2cd7d779118dad86a79bb6978. Проверены apksigner, non-debuggable/code4, zipalign16KB, все212 встроенных web-файлов, public key/timeout/отсутствие server.url и Cloud appId.
- Первый GitHub candidate остановился на ошибочном предположении о префиксе отчёта: hosted SDK использует V3.0 Signer, локальный Signer #1. Новый parser сравнивает все certificate fingerprints; public-key fingerprint не принимается, неверный сертификат по-прежнему блокирует APK. Regression3/3 и настоящий старый report passed. Ключи не менялись.
- Настоящие production ZIP и reset manifest созданы **offline**, RSA/WebCrypto readback и ABI после debug/release build прошли. Локальная release сборка successful; Android Lint вывел Kotlin metadata diagnostics для существующего health plugin, использующего Kotlin2.4.10, при анализаторе2.2, task lintVitalRelease не падал. Проверки не отключались.
- Владелец выбрал «Проверю позже»: физическая установка/вход и end-to-end OTA на телефоне не проверены. Серверный feed, Nginx include, RuStore, production/allowlists не изменены; PR не создавался.

- Final GitHub source24c1087f68a5d37e6abf6a9204f73436c3810fa7, native/sign/upload workflow39288099934 **success**. Artifact12205365975 `fit-android-ota-signed-1.1.0`, retention14days; old certificate check, non-debuggable/code4 and16KB alignment passed. Full application runtime CIbc5465d5/39285521854 **success**; subsequent commits changed only Node release tooling/tests/workflow and these passed in final Android job (Node3/3 + real signing).
