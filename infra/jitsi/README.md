# Видеовстречи Fit / YAFIT-669

Согласовано размещение на существующей VM fit-stage-app (28.10.2026).
Новая VM не создаётся. Замер [40680981611](https://github.com/podkolzinpd/fit/actions/runs/40680981611):
2vCPU/4GiB, MemAvailable3110MiB, свободно35GiB, OOM за7дней0.
Суточный график Cloud.ru: обычно CPU1–4%, короткие пики около50%.
Это исходный запас, не измеренная ёмкость видеовстреч.

## Изоляция и версия

Официальный compose stable-11248-2 сохранён без изменений, вместе с лицензией.
SHA256: da7904e9efb376c08773ca8e6f75fc4079a2fe869703cd1fdd263bb3439b22c8.
Источник: https://github.com/jitsi/docker-jitsi-meet/tree/stable-11248-2.
Конфигурация: https://jitsi.github.io/handbook/docs/devops-guide/devops-guide-docker/.
TURN: https://github.com/coturn/coturn/blob/master/examples/etc/turnserver.conf.
Не использовать meet.jit.si или плавающий latest; SDK — из того же выпуска.
В Fit применяется lib-jitsi-meet со своим UI, без интерфейса/брендинга Jitsi.

fit-jitsi.slice ограничивает все meeting-сервисы суммарно одним CPU и2GiB,
MemoryHigh1800MiB, без swap. Контейнеры: web128MiB, Prosody256MiB,
Jicofo512MiB (heap256MiB), JVB1024MiB (heap640MiB). Coturn128MiB/10%CPU
в той же slice. CPU/IO weight20. Фактические limits и cgroup parent проверяются
после запуска; при ошибке запускаются rollback/остановка только meeting-сервисов.
Параллельные deploy/inspect сериализованы group cloudru-stage-vm.
В Ubuntu Compose1.0.6 cgroup_parent из YAML игнорируется: unit явно передаёт
--podman-run-args=--cgroup-parent=fit-jitsi.slice. EnvironmentFile передаёт
protected env сервису; один dotenv не заполняет bare environment list в этой
версии. Обе настройки и фактическое наличие JWT/service credentials проверены.

Подготовка не изменяет API env, его контейнер, маршруты или PostgreSQL.
Каталог /opt/fit-jitsi0700; отдельные случайные JWT/TURN/Jicofo/JVB secrets,
защищённые файлы0600, отсутствие секретов в stdout/artifacts/Git/frontend.
Рендер в существующий каталог запрещён. Resume сохраняет исходные ключи.
Сервисный вывод compose подавлен, поскольку он может содержать env-команды;
контейнерные логи отключены. Для диагностики читать только статусы/агрегаты.

## Порядок настройки

1. `prepare` проверяет hostname, Ubuntu24.04, свободную память/диск/порты и
   доступность Fit API. Устанавливает podman-compose/coturn из Ubuntu packages,
   маскируя Coturn до настройки; создаёт конфиги/сервисы и проверяет SDK loopback.
2. `resume` возобновляет только подготовленный комплект без смены credentials.
3. `ingress` добавляет include с /libs/, /xmpp-websocket и /colibri-ws/ в
   существующий HTTPS vhost api.fit-training.ru. Исходные API/STT routes
   сохраняются. nginx -t, TLS/SDK, запрещённый Origin и API ready проверяются;
   при ошибке возвращается исходный vhost и останавливается Coturn.
4. TURN использует действующий сертификат api.fit-training.ru; новые DNS и
   ACME account/terms не нужны. Deploy hook обновляет защищённую копию для TURN
   при продлении существующего сертификата. Cookie/PII/JWT URL не логируются.
5. После проверки серверных конфигов — точечные входящие правила security group:
   10000/UDP (JVB),5349/TCP (TURN/TLS),49160–49200/UDP (relay).80/443 уже открыты.
   Не открывать SSH,3478,5222,5347,5280,8000,8080,8443,8888.
6. Проверить JWT admission и двустороннее реальное media; затем включить API
   через защищённый fragment и штатный runtime release. До приёмки off.

Workflow configure-cloudru-jitsi.yml имеет prepare/resume/ingress; для его
первичного вызова из ветки существующий inspect-cloudru-operations.yml
принимает prepare_jitsi=true и jitsi_phase. Остальные application diagnostics
в таком запуске пропускаются. Только явный manual dispatch меняет сервер.
Никаких runtime secrets в GitHub job inputs или outputs.
Дополнительные bounded modes: diagnose (статусы и очищенные ошибки только новых
контейнеров), auth (синтетические комнаты, пять JWT checks), proxy (обновление
только managed snippets без ключей). SDK передаётся с proxy_buffering off:
проверка всего compressed response и реальный Chromium preview обязательны,
HTTP200/HEAD не доказывают, что большой script загрузился полностью.

28.10: verified cgroups, HTTPS/TURN TLS, пять JWT probes, Chromium preview и
двусторонние audio/video с синтетическими устройствами. Два независимых клиента
получили19 decoded video frames и входящее audio в normal UDP и forced TURN/TLS;
в forced mode проверены actual iceTransportPolicy=relay и relayProtocol=tls.
Mute/unmute обоих треков прошли. QA credentials40692134007; safe output
содержит только счётчики/типы transport, без JWT/адресов участников.
Замер40692320786: MemAvailable2715MiB, OOM0; одна встреча, не capacity limit.
Три media rules открыты с отдельного разрешения пользователя и прочитаны обратно.
Проверка физических телефонов явно перенесена пользователем после включения.

## Допуск к комнатам и ограничения TURN

ENABLE_AUTH=1, AUTH_TYPE=jwt, ENABLE_GUESTS=0, JWT_ALLOW_EMPTY=0;
issuer fit, audience jitsi, JWT_ENABLE_DOMAIN_VERIFICATION=true,
token_verification проверяет room claim без wildcard. Секрет >=32байт,
короткий токен5мин на отдельную комнату fit-UUID. JWT не задаёт moderator role.
XMPP domain meet.jitsi, MUC muc.meet.jitsi — внутренние имена, не публичный DNS.
Публичные SDK/libs используют ACAO:*; WS принимает только перечисленные web/native
origins и требует JWT на XMPP. Блокировка Origin не заменяет JWT авторизацию.

TURN REST credentials временные, общий TURN secret только у Prosody/Coturn.
TLS5349, relay41UDP-порт,40allocations — baseline для проверки двух участников.
Private/loopback/link-local/multicast peers запрещены. NAT hairpin к публичному
JVB IP проверить реальным relay. Сеть только с443/TCP потребует отдельного TURN
endpoint/IP на443; данный комплект такую сеть не покрывает.

## API runtime configuration

Защищённый api.env.fragment создаётся с JITSI_ENABLED=false:

```
JITSI_ENABLED=false
JITSI_ORIGIN=https://api.fit-training.ru
JITSI_XMPP_DOMAIN=meet.jitsi
JITSI_MUC_DOMAIN=muc.meet.jitsi
JITSI_APP_ID=fit
```

api-status читает только configured/runtime flag, image и RUNNING_SHA.
api-stage переносит JITSI_JWT_SECRET внутри VM без вывода значения, flag=false;
api-enable/api-disable меняют только эти шесть meeting keys. Перед записью
проверяются target, credential continuity и права root-owned0600; исходный
API env сохраняется в /opt/fit-jitsi/api-before-meetings.env, запись атомарная.
Остальные значения сохраняются; owner credentials не копируются. Эти действия
не перезапускают API: затем нужен штатный release текущего main с зелёным CI.
Неполный enabled-config останавливает запуск API.
Контракт: GET/POST /v1/chat/conversations/:conversationId/meeting;
prepare/joined/heartbeat/leave, tabId UUID; кроме prepare нужен meetingId.

## Приёмка

Offline: `python3 -B -m unittest discover -s infra/jitsi -p 'test_*.py'`;
bash syntax и YAML parsing. Проверяются credential continuity, запрет overwrite,
права файлов, input boundaries, сохранность API/STT ingress и resource limits.
Это не доказательство installed Podman/Nginx/Coturn или WebRTC.

До включения: фактические cgroups; default/no-token/wrong-room/expired JWT
rejection; два независимых клиента с video/audio/mute/camera on-off/switch;
forced TURN с policy=relay; замер ресурсов при
реальном видео. По решению пользователя28.10 физические камеры/switch,
Wi-Fi↔mobile и восстановление на телефонах проверяются сразу после включения.
Нагрузку нескольких встреч и соседний deployment нельзя выводить из одного теста. Начальный тест — одна встреча на двоих,
число одновременных встреч пока не принято. iPhone/Android — отдельно от WebKit.
При нехватке ресурсов stop meeting services, сохранить работоспособность Fit.

Блокировка в приложении прекращает heartbeat/захват на следующей проверке;
немедленный kick модифицированного клиента требует отдельного server revocation.
Backout: disable JITSI_ENABLED штатным release, остановить fit-jitsi/coturn,
вернуть сохранённый Nginx vhost, убрать только meeting rules. История БД сохраняется.
