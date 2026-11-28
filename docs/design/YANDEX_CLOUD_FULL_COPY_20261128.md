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
