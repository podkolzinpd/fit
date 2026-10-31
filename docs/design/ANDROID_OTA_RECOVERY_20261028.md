# Android OTA: восстановление выпуска — 28.10.2026

## Пользовательский результат

На телефоне с APK1.1.1 остаётся старый интерфейс. Требуется восстановить
доставку актуального интерфейса без удаления пользовательских данных.
Не считать публикацию на сервере подтверждением применения на телефоне.

## Проверенные факты

- Main a612842a; CI40680091536 success.
- Автоматические OTA40673503744/40685008293 остановились на
  OTA_NATIVE_APK_REQUIRED: добавлены camera plugin и Android permissions.
- Старый канал ABIa544771e доступен: source c88f2c21, ZIP15070530bytes;
  полная загрузка, SHA256 и обе RSA-подписи проверены28.10.
- APK93427f90 действительно содержит enabled OTA и правильный trust root.
- Main сохранял versionCode5/name1.1.1 после native-изменений. SDK8.7.1
  сбрасывает сохранённый OTA path только при смене versionCode.
- Ручной выпуск40691870129 остановлен до публикации: нельзя выпускать
  изменённый shell с прежним versionCode.
- Причина неприменения старого совместимого OTA на телефоне НЕ УСТАНОВЛЕНА.
  Запрошена проверка после полной остановки Android-приложения.

## Приёмка

| ID | Результат | Проверка | Статус |
| --- | --- | --- | --- |
| R1 | Новый native shell имеет1.1.2/code6 и прежнюю подпись | Gradle, workflow APK metadata/certificate | подготовлено |
| R2 | Изменённый ABI нельзя впервые опубликовать с прежним/меньшим code | publisher regression:5/4 rejected,6 accepted; compatible channel preserved | локально15/15 |
| R3 | Подписанный APK и совместимый feed опубликованы из зелёного main | release artifact, manifest/ZIP/crypto/readback | не проверено |
| R4 | Телефон получает новый интерфейс, повторное совместимое OTA применяется после cold start | установка поверх, открытие, полная остановка/повторный запуск | не проверено |

R2 проверяет подписанные существующие alpha manifests; signed reset без release
не содержит номера native build и не служит его историческим реестром.
Подписи, ABI isolation, anti-replay, rollback, активные тренировки и данные
не ослабляются. Backend/БД/пилоты/магазины вне изменения.

## Локальные проверки

- `node --test scripts/publish-android-ota.test.mjs scripts/android-ota-contract.test.mjs`:
  15/15, включая настоящий loopback TLS. Sandbox EPERM устранён разрешением
  локального listen, assertions не менялись.
- `VITEST_MAX_WORKERS=4 npm run check`: exit0; frontend2898,
  API1537passed/205conditionalDBskip, infra354, hosting196, build/startup.
- `node scripts/check-workflow-docs.mjs`, `git diff --check`: passed.
- UI/схема/данные не меняются. Физический Android и новый native build ещё
  не проверены; native tests/подпись/metadata обязательны в release workflow.

## Итерация2 — 30.10.2026 — Codex / OpenAI

Задача: обновить PR1855 от main, устранить конфликты и выпустить новую версию.
Расхождение: GitHub показывал BEHIND/MERGEABLE, ручных конфликтов нет;
merge main ea454134 выполнен штатно, код OTA/native versioning не изменён.
Сохранены новые feature flags из main. Старый PR CI40693790135 упал до
WebKit assertions: порт54322 уже занят на disposable runner.
Решение: повторная проверка объединённой ветки и обычный выпуск после green CI;
обход обязательных проверок и выпуск APK с прежним code5 отвергнуты.
Проверка: OTA15/15 и workflow-docs/diff-check passed; frontend2932/2932,
lint/typecheck passed. Полный локальный check остановился на неизменённом
CI-test375/376: дочерний bash на этом Mac переписывает PATH при запуске,
поэтому вместо fixture sysctl вызывается системный macOS sysctl, где нет
Linux oid net.ipv4.ip_local_reserved_ports. Системные настройки не менялись.
Тест/CI не ослаблены; Linux repository-quality остаётся обязательным gate.
Остальные check-стадии проверяются отдельно; CI/release ещё не завершены.
Открыто: реальное применение на телефоне по-прежнему не подтверждено.
Дальше: green CI, merge, main CI, подписанный APK1.1.2/code6 и новый feed.
