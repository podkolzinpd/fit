# Полная копия Fit в Yandex Cloud — 28.11.2026

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
