# Fit: инструкция планового возврата Cloud.ru → Yandex Cloud

Статус16.10.2026: **проект процедуры, не разрешение на выполнение**.
Блокеры и доказательства — в [отчёте аудита](CLOUD_RETURN_AUDIT_20261016.md).
Текущий Cloud.ru не меняется. Плановый возврат без потери подтверждённых записей,
остановка записи ≤120 минут; аварийное переключение с недоступным источником
имеет другие RPO/RTO и в эту гарантию не входит.

## Предварительные условия и единый журнал

- Назначить одного оператора переключения, владельца данных и проверяющего;
  исключить параллельные release/migration/configure workflow в обоих облаках.
- Закрыть A01/A02/A04/A05/A06 из аудита. До этого только dry-run на synthetic
  данных; нынешние migration workflows не являются готовой обратной командой.
- Зафиксировать согласованные source/target, Git SHA API/frontend, полный список
  migrations с digest содержимого, версии PostgreSQL/extensions, роли/grants/RLS,
  конфигурационные имена и semantic flags без secret values.
- Сохранить обе исходные истории. Провести приватное сравнение всех переносимых
  таблиц по ключам/содержимому, включая app_private, sessions, receipts/outbox и
  таблицы связей. Baseline использовать только если он действительно сохранён.
  Уникальные старые Yandex записи и конфликты разрешает владелец данных до окна;
  готовый согласованный алгоритм объединения покрывается tests. Timestamps не
  основание автоматического last-write-wins. Неразрешённый конфликт — STOP.
- Журнал attempt содержит только время, SHA, безопасные totals/checksums,
  checkpoint/fence status, результаты gates и ссылки на закрытые доказательства.
  Имена, ключи объектов, сессии, URL с токенами и row-level diff туда не попадают.
- Доступ к export/import/keys только в закрытом automation runtime; production
  dump не скачивается на ноутбук/в CI artifacts. Нужны доступные encrypted backups
  обоих контуров и проверенный способ расшифровки независимо от основной VM.

Машина состояний: `PREPARED → BOTH_FENCED → FINAL_VERIFIED → ROUTED → TARGET_ACTIVE`.
При неизвестном результате остаёмся `BOTH_FENCED`. Смена DNS не меняет состояние
записи. Повтор попытки читает сохранённый checkpoint, а не начинает import/dispatch
вслепую. Один cloud/runtime получает право записи; фоновые отправки включаются
отдельно после проверки receipts и старых leases.

## 1. Подготовить Yandex Cloud

Проверить восстановление из независимой точки доступа: DNS/TLS, managed
PostgreSQL17, object storage, image registry, serverless/VM runtime, secrets/IAM
и доступность внешних Yandex ID/GPT/SpeechKit. Успешный ping одного API не
доказывает восстановление остальных сервисов.

Подготовить **новую изолированную** целевую БД и private media namespace/bucket;
старые Yandex DB/media не перезаписывать. Exact-SHA artifacts подготовить заранее,
автовыпуск/старые timers оставить выключенными. Проверить extension compatibility
(в реальном Cloud.ru dump встречаются pgaudit/pg_stat_statements), нужные grantee
roles, runtime без owner/BYPASSRLS, actor policies и encryption/key dependencies.
Не выкидывать grants/данные/extensions из архива для получения зелёного restore.

Проверить маршруты: web `/api`, native canonical API, старый technical API,
OAuth callbacks/deep links, CORS и оба hostnames. Предпочтение — стабильные
публичные имена, без массового обновления mobile bundle ради одного cloud switch.
Обнаруженные hardcoded endpoints включить в инвентарь; их существование блокирует
утверждение о едином writer, пока запрет на старой стороне не доказан.

## 2. Заранее перенести основную массу данных

Предварительно скопировать media с content SHA256/размером/type metadata в private
целевой namespace, сохранив mapping доменных ссылок. Никакой public ACL и
`allow-missing`. Повторный проход включает новые/изменённые/удалённые объекты и
проверку, что target не содержит воскресших удалённых объектов.

Для БД первая версия процедуры использует **полный финальный согласованный
snapshot в период freeze**, а не самописный upsert/delta по updated_at. Предварительная
копия БД нужна для schema/extension/API rehearsal; она не становится финальной
без нового snapshot. Если уже согласованное разрешение исторических конфликтов
добавляет старые Yandex данные, оно детерминированно применяется к final candidate
с сохранением происхождения в закрытом журнале и проверкой ожидаемого результата.

Такой выбор проще постоянной репликации и корректно переносит удаления, но время
полного dump/transfer/restore входит в120мин. Если representative rehearsal не
укладывается с запасом, возврат блокируется; отдельная задача выбирает проверенную
инкрементальную синхронизацию. Не обещать ускорение от предварительной копии БД,
если механизм применения дельты ещё не существует.

До окна оценить final archive size, доступную память/диск, пропускную способность,
количество media changes и время каждого gate. Лимиты существующих CLI не
обходить. Перед попыткой потребовать свежую полную репетицию того же SHA/schema
и объёма не меньше ожидаемого production, без реальных персональных данных.

## 3. Закрыть запись в Cloud.ru

Отметить `freeze_started` монотонными часами — с момента первого ограничения
пользовательской записи. Начать измерение до drain, а не после создания snapshot.

- Закрыть mutations на всех текущих и старых API entrypoints, включая OAuth
  callback/session issuance и фоновую запись, с понятным maintenance/retry ответом.
  Один frontend build-time flag недостаточен. Не делать автоматический retry POST.
- Остановить background dispatch/reminders/session cleanup/feedback и возможные
  старые Yandex/Supabase writers. Дождаться или корректно завершить in-flight
  transactions/jobs, сохранив outcome/receipt. Неизвестная доставка не повторяется.
- Заблокировать business writer credentials и уже существующие connections на
  уровне БД по проверенному inventory. Maintenance owner остаётся только у
  оператора. SECURITY DEFINER functions, grants и прямые подключения проверяются
  отдельно; простой REVOKE таблицы не закрывает каждый реальный путь записи.
- Закрыть source object writes, включая ранее подписанные upload URLs: дождаться
  истечения их максимального TTL и завершения upload либо применить проверенный
  storage fence. Исходный secret/ACL не ротировать без отдельного решения.
- Подтвердить: новый и старый клиент, существующий pool и worker больше не могут
  подтвердить запись; target тоже fenced. Счётчики отсутствия изменений проверяются
  на полном checkpoint. Контрольный production POST сам требует отдельного
  разрешения и выделенной fixture; текущий аудит его не выполняет.

Если нельзя доказать freeze всех writers, snapshot не считать финальным.

## 4. Перенести финальное состояние

Создать финальный согласованный snapshot и закрытый manifest всех таблиц; сохранить
его encrypted в доступном private storage. Импортировать в новую final candidate
БД атомарно там, где поддерживает проверенная процедура. Target недоступен
пользовательскому runtime; не выполнять reset/reimport старой непустой базы.

Сверить source/final target: полный набор таблиц, число и содержимое строк по
детерминированному manifest, история/digests migrations, FK, grants/RLS, ownership,
functions/extensions и sequences. Системные timestamps/поля исключать только
по заранее утверждённому минимальному списку, не ради совпадения результата.
Согласованное объединение старой истории проверяется отдельно от source equality.

Завершить media delta и сверить content SHA256, metadata, domain references и
удаления с checkpoint БД; S3 ETag не универсальная checksum. Проверить сохранность
TTL/ссылок старого клиента: source media разрешено временно читать, записывать — нет.
Подписанные ссылки должны перевыпускаться через target adapter.

При timeout/обрыве архив не принимать частично. Проверить состояние attempt и
выполнить повтор в новом candidate по тем же checksums; сохранять исходные истории.
Outbox receipts, dedupe, cutoff и leased/uncertain исходы переносить без повторной
доставки. Не вызывать initial fresh-push campaign или повторную архивацию истории.

## 5. Проверить целевой контур и переключить трафик

Перед пользовательским routing запустить exact-SHA API против final target,
проверить readiness, auth/session resolution и безопасные domain reads.
Synthetic write/rollback probes выполнять только в отдельной fixture/транзакции
по заранее утверждённому сценарию, не смешивая их с реальными пользователями.
Сохранённые sessions либо валидируются с тем же actor/role, либо требуют обычного
повторного входа; нельзя молча создавать новый профиль вместо существующего.

Переключить все согласованные DNS/proxy/upstream paths. TTL учесть заранее, но
не считать его гарантией очистки всех клиентских кешей. Старые API listeners
должны оставаться fenced даже если DNS уже указывает в Yandex. Проверить через
независимые резолверы root/www/api и legacy entrypoints, web/native TLS/CORS,
полные frontend bytes и фактический API release/DB target. Не делать fallback
на старую базу при ошибке target.

Если gates не выполнены к100-й минуте, начать отмену: остаётся20мин резерва на
возврат маршрутов/открытие прежней стороны. Если измеренное время отмены больше,
точку abort перенести раньше по результатам rehearsal. До попытки не разрешается
принимать120мин без запаса на отмену.

## 6. Открыть запись только в Yandex Cloud

После всех gates открыть target business writes и отметить `target_opened`.
Время от freeze_started до подтверждения доступности записи должно быть≤120мин.
Cloud.ru DB/API/media writers остаются fenced, вне зависимости от DNS cache.
Проверить реальные роли и новые записи/reload по отдельному разрешённому сценарию.

Включить ровно один dispatcher после проверки receipts/leases и отсутствия старого
sender. Сначала наблюдать небольшие batches новых событий; uncertain/historical
не отправлять повторно. Запустить backup/ops monitoring целевого контура, проверить
alert/recovery path и доступность резервных копий. Начальное усиленное наблюдение —
24часа; оно не закрывает retention/rollback window автоматически.

Исходные DB/media/snapshots не удалять и не превращать в обычный writable резерв.
Срок хранения определяет владелец данных в A03 с учётом бюджета; без решения
удаление запрещено. Не считать сохранённый Cloud.ru актуальной копией Yandex writes.

## Отмена и возврат после первой записи

| Момент | Действие |
| --- | --- |
| До первой target business write | Target оставить fenced; восстановить маршруты к Cloud.ru; убедиться, что target workers не запускались; открыть source и его единственный dispatcher. Проверить все cached/native paths; сохранить failed candidate для закрытой диагностики |
| После первой target business write | Обе стороны закрыть, сохранить новые Yandex данные, выполнить отдельный проверенный обратный перенос с reconciliation и manifests. Только после него открыть Cloud.ru. DNS-only rollback запрещён |
| Неизвестен outcome записи/доставки | Оставить обе стороны fenced; выяснить outcome через durable operation/receipt. Повтор без проверки не выполнять |

## Локальная репетиция и её ограничения

```bash
podman machine start
node scripts/rehearse-cloud-return.mjs
```

Требуется уже доступный локальный image `docker.io/library/postgres:17`.
Скрипт использует два одноразовых кластера без сети, портов, host mounts и
production env. Только синтетические integer IDs и файлы; cleanup удаляет лишь
контейнеры, созданные этой попыткой. Image ID включается в JSON результата.

23 проверки покрывают разные риски: запрет старого/резервного writer, stale
precopy, отмену до открытия, прерванный архив, атомарность и повтор final restore,
изменения/удаления, schema history, FK/RLS, local-file checksums/deletion,
сохранение старой target history и outbox outcome, первый новый write и опасность
DNS-only rollback. Это не новая декартова browser/theme матрица.

**Ограничения:** synthetic REVOKE не реализует production fence; local files не
проверяют S3/IAM/signed URLs; скрипт не запускает реальный API и долгоживущий pool,
не разрешает настоящие исторические конфликты и не измеряет production transfer.
Текущий результат — проверка механики. Полная приёмка A06 остаётся открытой.
