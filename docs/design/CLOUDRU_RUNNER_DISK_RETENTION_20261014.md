# Cloud.ru runner: ограниченная очистка диска

## Причина

14.10.2026 recovery workflow дважды остановился в `Set up job` до первого
пользовательского шага: runner вернул `No space left on device` при скачивании
`actions/setup-node`. VM использует один SSD 30 ГБ. API build сохраняет
immutable source и tagged Podman image для каждого SHA, frontend — отдельный
candidate; постоянной Cloud.ru retention до этой задачи не было. Очистка
Yandex Object Storage к этому диску не относится.

## Приёмка

1. Диагностика и аварийная очистка запускаются без `uses:` и скачивания Actions.
2. Один serial lock исключает одновременную очистку и deploy/release.
3. Inspect не меняет VM и показывает filesystem/inode, размеры build-каталогов
   и Podman usage без чтения секретов и содержимого backup.
4. Apply сохраняет работающий и подготовленный API, образы всех контейнеров и
   три последних API SHA; сохраняет текущий и три последних frontend candidate.
5. Удаление допускается только для exact managed release/candidate/image paths.
   БД, media, secrets, volumes, контейнеры и db-backups не затрагиваются.
6. Воспроизводимые Actions/Node caches и dangling images можно очистить только
   под тем же lock. Ручной apply требует точного подтверждения.
7. После очистки обязательны pointer/RUNNING_SHA readback, loopback API/frontend
   smoke и не менее 2 ГБ свободного места.
8. После первого ручного inspect и apply workflow работает ежедневно в 05:17
   МСК; сбой не должен скрываться или ослаблять проверки deploy.

## Статус проверки

Реализация подготовлена в отдельной ветке. До merge нужны targeted policy/Bash
tests, полный `npm run check`, зелёный CI и соблюдение очереди PR. После merge
нужны реальный inspect, проверка точных кандидатов, один manual apply и повторная
проверка production. Реальные удаления и освобождённый объём пока не доказаны.

