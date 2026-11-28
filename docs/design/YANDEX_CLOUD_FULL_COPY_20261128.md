# Полная копия Fit в Yandex Cloud — 28.11.2026

**Итог: standby подготовлен и принят.** Рабочий DNS остаётся на Cloud.ru;
cutover разрешается только отдельной командой владельца. Приёмка46154567520,
DataLens46154687472, после перезагрузки46155103326 — success.

Поручение владельца: полностью скопировать действующий Fit, включая БД,
архитектуру с ВМ и остальные сервисы, в каталог `b1gt7dfqg9sht9slnno5`.
Владелец отдельно подтвердил автономное выполнение всей задачи.

Источник: действующая Cloud.ru production, main/API/frontend
`2874d3dfbe7ed9f2bb6ee670d47c2df48192df83`. Исходные ресурсы не переключаются.
Операционный поток этой задачи выполняется из отдельной ветки; её dispatch
ограничен точным ref и не изменяет scheduled workflow на main.

## Итерация 1 — 28.11.2026 — Codex / OpenAI

Проверены текущие main, канонические контракты, штатные capacity/inventory runs.
Cloud.ru VM: 2 vCPU, 3915 MiB RAM, диск64GB; API, SpeechKit и четыре Jitsi
контейнера. Frontend опубликован на той же ревизии, что API. PostgreSQL17.10,
106714803bytes,113 прикладных таблиц; расширения pg_stat_statements,pgaudit,plpgsql.

Целевой каталог прочитан через консоль и CLI: до работы не было VM/PG;
существующие сеть, четыре подсети, старый media bucket и два аккаунта сохранены.
Квота SSD10GB мешала копии64GB. Заявка `atdag4ldlhk4birgjmk7` одобрена,
итог64GiB в ru-central1-a; support PD574812. Квота действительно позволила
создать VM, не только отмечена ответом ассистента.

Созданы отдельная SG, VM `fhm0ju8244ctffsq4lvd` /89.169.148.38 /10.128.0.11
(2CPU,4GB,64GBSSD), PG `c9q5ic9v0500c217e71n` (17,2CPU,4GB,20GBSSD,
private address, deletion protection), private bucket
`fit-copy-media-b1gt7dfqg9sht9slnno5`, runtime SA. SSH открыт только source
и оператору; public только необходимые web/media ports. Hostkey прочитан
из аутентифицированного serial output и закреплён для SSH.

Прямой SSH оператора недоступен; штатный self-hosted runner source успешно
подключился к target с закреплённым ключом и проверил bootstrap/62GB filesystem.
Новый временный операторский ключ и target credentials переданы через Actions
secrets; значения не публикуются и в git не хранятся.

Дальше: передать текущие runtime/site/images, получить согласованный snapshot
БД с числом строк каждой таблицы, восстановить и сверить target; скопировать
каждый media object с проверкой SHA256, настроить независимые origins/TLS,
проверить API/frontend/voice/Jitsi и фоновые службы. Копия не должна рассылать
уведомления по скопированным production push-подпискам или очередям.
OAuth callback и независимость внешних интеграций должны быть проверены отдельно.

## Уточнение владельца — 28.11.2026

Копия должна принять существующий fit-training.ru, но переключение допускается
ТОЛЬКО по отдельной команде владельца. Сейчас готовится standby: прежние
web/API domains, существующий OAuth client и его callbacks, тот же UI и данные.
DNS, source writes и боевой background не переключаются. Проверки target
выполняются с явным --resolve на IP target при проверке прежнего TLS hostname.
Перед будущим cutover обязательно обновить snapshot/media после согласованной
паузы единственного writer и сверить rollback checkpoint. Текущая standby-копия
не является непрерывной репликой изменяемой production-базы.

## Итерация 2 — 28.11.2026 — Codex / OpenAI

Runtime-файлы, Android OTA и все шесть действующих container images переданы
успешно46151620105. DB snapshot17:03:37МСК:113таблиц,134053строки;
SHA256dump source/target одинаковый1f6fbcdd4c839e9246f6be0c4f6fd542a92078840634cae11a782cd329036a08.
Restore46152733405 успешен. Первая сверка46152790732 подтвердила все таблицы
по числу строк и digest, затем остановилась на ошибочном ожидании прямого
UPDATE уfit_api. Миграция000008 явно оставляет толькоSELECT и защищённыеRPC.
Исправлено ожидание проверки; права в target не расширялись.

PG extensions pgaudit/pg_stat_statements включены через managed API, pgaudit
shared library подключена. Внешний IP89.169.148.38 зарезервирован и защищён.
AI/SpeechKit credentials созданы в target folder с двумя точными execute scopes;
прежний OAuth clientfdc7e12c472b475690fbb387d8698663 остаётся прежним.

## Итерация 3 — 28.11.2026 — Codex / OpenAI

Проверка46152984414 прошла:113таблиц/134053строки, общий digest
79a18af469458966db18bce19f72820193b39e2124d32b60fd302dc48fcf42c2,
RLS уprofiles/workouts/workout_sets, ownerfit_owner, SELECT уfit_api и отсутствие
прямого UPDATE сохранены. Media46152797288:2326objects/89311624bytes,
каждый object прочитан обратно и SHA256 совпал; общий manifest
7dbe3e5e1f5664dfdecc53bcd4d16c9ac10526d5821d9712d520e6ab70aab0a8.
У этого же combined run последующий source archive остановился на отсутствии
gh в production; media-этап успешен и не повторялся.

Certificates46153213773 переданы напрямую между VM, без вывода private keys.
Первый runtime46153251935 получил503ready из-за отсутствующей managed-service
permission наfit уfit_api. Это не SQL/RLS: разрешение подключения к точной БД
выдано черезYandex API, отдельно fit_datalens. Runtime46153532330 прошёл:
все семь units active, ready и meeting SDK проверены, чужой Origin получает403.
FrontendFilesRelocated=0: опубликованный frontend не переписывался.

Native backup вtarget завершён17:10:53МСК:backup
c9q5ic9v0500c217e71n:mdb58lm37q6sn0efqbu5,23602005bytes.
Долгий GitHub archive run46153291587 отменён только после готовности
проверенного альтернативного архива. Точный git archive исходногоmain
сохранён в отдельном приватном backup bucket:286845198bytes, SHA256
dbda11620ba3838319ed125c937aec6aded32d162a2935260b4b085a91632b3a.
Подписанный download URL и credentials не публикуются.

Source/target OAuthClientID, web/API hostnames сохраняются. Target certbot
renewal state копируется, но timer выключен доcutover, чтобы не выполнять
HTTP-01 challenges против DNS, который всё ещё указывает наsource.
DataLens proxy сохраняет точный allowlist, upstream меняется только наtargetPG;
действующие DataLens connections не переключаются.

## Итерация 4 — 28.11.2026 — Codex / OpenAI

Архив исходногоmain прочитан обратно из приватного Yandex Storage и извлечён
в target; его SHA256 совпал. Опубликованный frontend248/248 совпал побайтно,
source/target locale C/C, timezoneUTC. SQL data digest, RLS и grants прежние.

Полная приёмка46154567520 успешна:10/10 HTTPS-проверок с принудительным
targetIP при прежних hostnames; API release2874d3df,401 безсессии, ready200,
publiccatalog200, JitsiSDK200. SpeechKit upstream и authguard, targetAI,
TURN/TLS успешны. Source DNS всех трёх имён сохранился87.242.117.210.

Предыдущие два замечания приёмки исправлены по фактической конфигурации:
TURN слушает privateIP, поэтому проверка направлена на10.128.0.11 вместо
loopback. API получил исходные container flags APP_ENV,PORT,FIT_RELEASE_ID;
это параметры запуска исходного release workflow, не новое приложение.

DataLens46154687472: TLS через55432, fit_datalens, read-only запрос к
analytics.trainer_overview успешен; certbot timer выключен доcutover.

Перезагружена только targetVM. Смена bootID подтверждена46154832329;
независимая строгая проверка46155103326 подтвердила каждый из7units и6containers,
HTTPS/DB readiness/release и TURN/TLS. Проверка не полагается на агрегатный
systemctl is-active нескольких units, который успешен при любом активном.

Оригинальный source main и production release остались2874d3df. Existing media
bucket fit-chat-media-b1gt7dfq сохранён; оба новых bucket находятся в точном
folderb1gt7dfqg9sht9slnno5. Секретные значения в git/отчёты не включались.

Граница приёмки: реальные OAuth/device/media-call проверки после смены DNS
не выполнялись. Перед cutover нужны свежий snapshot, writer control и перенос
CI/CD/внешних подключений; source продолжает принимать новые данные.

## Итерация 5 — 28.11.2026 — Codex / OpenAI

Владелец дал отдельную команду пробовать production cutover, включая DNS и
приёмку основного адреса. Это заменяет прежний запрет переключения только для
данного перехода; исходная площадка и резервные копии сохраняются.

Preflight: origin/main и deployed target release остаются2874d3df; targetVM
RUNNING, PostgreSQL RUNNING/ALIVE, deletion protection включён. HTTPS с явным
targetIP возвращает ready и правильный release. Все три publicA пока87.242.117.210.
Повторная приёмка46171171077 подтвердила248frontendfiles, затем остановилась
на table_mismatch с исходным snapshot. После создания синтетической карточки
в UI точное совпадение с прежним snapshot не предполагается; причина полного
расхождения ещё не разобрана. Проверка не ослаблена. Перед cutover обязателен
свежий source snapshot и новая полная сверка, без переноса QA-данных обратно.

Блокер DNS: текущий браузер Cloud.ru перенаправлен на форму входа, активной
сессии нет. В GitHub нет выделенной DNS credential. До подтверждения доступа
к DNS source writes/background и publicDNS не меняются, downtime не начинается.
Следующий шаг: обычный вход владельца в Cloud.ru, проверка точной зоны,
подготовка синхронизации/единственного writer и production release маршрута.

## Итерация 6 — 28.11.2026 — Codex / OpenAI — production cutover

Владелец вошёл в Cloud.ru и подтвердил продолжение. Дополнительно уточнил:
нужно полностью отказаться от Cloud.ru, включая authoritative DNS, а смену NS
в Beget выполнит владелец регистрационного аккаунта по подготовленному тексту.
Решение YC-PROD-20261128 заменяет standby-only границу этой задачи.

Автовыкладки Cloud.ru API/frontend/stage и Android OTA приостановлены точными
GitHub variables. Source background timer отключён, дополнительное условие
запрещает его запуск без ALLOW_SOURCE_WRITES. Source API явно остановлен при
прежнем unless-stopped, speech и source certbot timer остановлены. Старая БД
не удалялась, её credentials и исторические backups сохранены.

Свежий консистентный snapshot20:42МСК:113таблиц/134056строк, dumpSHA256
1075699cc504964a6fdaf37e9187cb3ba83b3c17dbbafc6484434b7e7d264617
совпал source/target. Standby до замены сохранён отдельным private dump.
Транзакционный clean restore и полная сверка всех таблиц успешны46171886752;
общий data digest1a8955d0b0d0abc16f401947cc9a4bd19c7f2538f1f868041c1f1f80e2766060.
RLS/owner/select-only fit_api и localeC/C сохранены. Media2326/89311624
повторно прочитаны с проверкой каждого SHA256, прежний общий manifest совпал.
Target API поднят после завершения переноса; QA-карточка из standby заменена
истинным source snapshot, её данные в production не переносились.

Неуспешные попытки:46171673358 остановился на неподдерживаемом Podman update
--restart до остановки API; команда удалена, используется прежний unless-stopped.
46171745093 остановился на DB preflight; точная причина первого DB исключения
не установлена. Добавлен drain сохранённых pool backends и безопасный SQLSTATE;
следующий run восстановил и сверил БД успешно. Проверки не отключались.

Source HTTPS ingress заменён только для Fit на TLS-verifying reverse proxy
к89.169.148.38, включая WebSocket/uploads. При первом включении обнаружена
недостаточная глубина проверки цепочки сертификата; verify_depth4 и ожидание
reload исправили маршрут.46172357279 успешно проверил старый IP с остановленным
source API. Обслуживание было временно прервано примерно20:40–20:48МСК.
После TARGET_WRITES_ENABLED обратный DNS switch без переноса новых данных
запрещён; это не обратимая смена старого snapshot на текущую production БД.

В Cloud.ru DNS zonec3700123-0613-4865-bb80-1c6b9affeb47 через UI изменены
три A-записи @/www/api на89.169.148.38 с прежнимTTL300. Read-back UI и прямые
ответы обоих Cloud.ru authority подтвердили изменение. Первоначальный
auto-review rejection из-за502/503 разрешён после успешной независимой проверки
обоих IP; смена DNS проведена только после восстановления доступности.

Public acceptance20:51МСК:10/10HTTPS/API/401/JitsiSDK и DNS трёх доменов
успешны. Native PG backup завершён20:47:19МСК:
c9q5ic9v0500c217e71n:mdbgc1e5ncmgja10he9i,25207923bytes.
46172570933 включил только target background и certbot, подтвердив source
API stopped и source timer disabled.46172750379 проверил8activeunits,
перевёл private target config в production и установил PRODUCTION_ACTIVE.
Старые standby export/restore/configure теперь fail-closed до любых remote
config writes, чтобы случайно не перезаписать действующую production.

Создана защищённая public DNS zone dnsanhiqgd4ljgoh8msg в точном target folder.
Все13recordsets из исходной зоны сохранены по назначению: новые authority
NS/SOA, триAна89.169.148.38, исходныеCNAME/MX/TXT и TTL. Прямые ответы
ns1.yandexcloud.net/ns2.yandexcloud.net и list-records проверены, почтовые
MX/SPF Beget сохранены. Делегация у Beget пока evo-cns01/evo-cns02.cloud.ru;
владельцу передан текст заменить их наns1.yandexcloud.net/ns2.yandexcloud.net.

Открыто: полный shutdown Cloud.ru НЕ выполнен. Текущий gh-доступ имеет push,
admin=false; управление repository runners возвращает403. Поэтому перенос
release/ops runner, scheduled host-monitor export и эксплуатационных jobs
ещё не завершён. Не менять архитектуру выпуска ради обхода GitHub ACL.
Нужен администратор podkolzinpd/fit для регистрации нового runner. Остаются
проверка внешних DataLens/старых IP consumers, сохранение нужных старых backup
archives, полная authenticated OAuth/workout/media/voice/AI приёмка и окно
отката. Cloud.ru compute/DB/storage/DNS нельзя удалять до закрытия этих пунктов.
Следующий шаг: смена NS владельцем Beget параллельно подготовке нового runner,
дальше перенос/проверка эксплуатационных jobs и контролируемый вывод source.
