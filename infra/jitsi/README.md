# Видеовстречи Fit / YAFIT-669

Это контракт и подготовка собственного Jitsi; сервер пока не развёрнут этим PR.
Проверенная upstream release: docker-jitsi-meet stable-11248-2 (28.10.2026).
Не направлять production на meet.jit.si. Версию SDK сервировать из того же
проверенного выпуска, что и сервер. В Fit используется только lib-jitsi-meet,
без Jitsi Meet iframe, отдельного аккаунта и брендинга.

## Подготовленный комплект

`compose.upstream.yml` — неизменённый официальный compose stable-11248-2,
SHA256 `da7904e9efb376c08773ca8e6f75fc4079a2fe869703cd1fdd263bb3439b22c8`;
лицензия сохранена в LICENSE.upstream. Источник:
https://github.com/jitsi/docker-jitsi-meet/tree/stable-11248-2.
Параметры TURN сверены с https://github.com/coturn/coturn/blob/master/examples/etc/turnserver.conf.

`prepare.py` запускается **на целевой VM** после выделения IP:

```sh
sudo python3 prepare.py --output /opt/fit-jitsi --public-ip PUBLIC_IPV4 --private-ip PRIVATE_IPV4
```

Он создаёт защищённый каталог0700, отдельные случайные JWT/TURN/Jicofo/JVB
секреты, env0600, Nginx/Coturn config, systemd unit и certificate renewal hook.
Секреты не печатаются. Повторный запуск в существующий каталог запрещён,
чтобы не заменить действующие ключи. Комплект не активирует сервисы.
Локальная проверка: `python3 -B -m unittest discover -s infra/jitsi -p 'test_*.py'`.
Она проверяет границы ввода, согласованность секретов, права файлов и отказ
от перезаписи; это не проверка установленного Nginx/Podman/Coturn или медиа.

Целевой baseline — отдельная Ubuntu24.04 VM с Podman/podman-compose,
Nginx, certbot, coturn из официальных пакетов дистрибутива. Версии пакетов
записать при установке; совместимость compose проверить на этой VM.
API fragment создаётся с JITSI_ENABLED=false; не включать по факту рендера.

Порядок применения после выделения VM и проверки DNS:

1. Установить пакеты, создать `/var/www/fit-acme`, каталоги CONFIG из compose.
   Установить только nginx-http.conf; выполнить nginx -t и reload.
2. Получить сертификат certbot certonly --webroot для meet.fit-training.ru
   с webroot `/var/www/fit-acme`. Условия ACME/контакт согласовать при регистрации.
3. Установить renew-certificate как deploy hook certbot; выполнить его первый
   раз с RENEWED_LINEAGE=/etc/letsencrypt/live/meet.fit-training.ru.
   Hook копирует сертификат/key с root:turnserver0640 в /etc/fit-jitsi.
4. Установить nginx.conf и turnserver.conf (последний root:turnserver0640),
   проверить nginx -t. Проверить фактический coturn unit/config path и TLS.
   Включить fit-jitsi.service и coturn, перечитать listening sockets.
5. На security group разрешить80/TCP только для ACME,443/TCP,10000/UDP,
   5349/TCP и49160–49200/UDP. SSH только с административного /32 на время
   настройки. Не открывать3478,5222,5347,5280,8000,8080,8443,8888 наружу.
6. Проверить TLS/SDK CORS, origin filter, JWT admission и двух участников;
   затем forced TURN/TLS и реальные устройства. Только после приёмки переносить
   API fragment защищённым каналом в runtime env и включать штатным release.

Сейчас TURN/TLS рекламируется на5349/TCP, relay ограничен41UDP-портом и40
allocations. Это baseline проверки двух участников, не обещание ёмкости.
Сеть, разрешающая только443/TCP, потребует отдельного TURN endpoint/IP на443;
данный комплект не доказывает работу в такой сети. Private/loopback/multicast
TURN peers запрещены; доступ к внутренней сети Cloud.ru через relay закрыт.
NAT hairpin к публичному адресу JVB проверить фактической relay-передачей.
Веб-корень отдаёт404; наружу доступны SDK/libs и XMPP WebSocket.
Списки origins в Nginx проверить против текущего web/native production build.

## Требования до включения

1. Выделенный Linux-хост/VM для Prosody, Jicofo, Videobridge и web/static.
   Не размещать без проверки ресурсов рядом с production PostgreSQL/API.
   Оценка стартового размера для проверки: 4vCPU/8GiB; нагрузочную ёмкость
   определить двумя реальными участниками и затем параллельными встречами.
2. DNS/TLS для https://meet.fit-training.ru (пока предложенный адрес).
   Внешние порты:443/TCP (web/XMPP WebSocket),10000/UDP (JVB media).
   Prosody5222/5347, Jicofo и административные/metrics порты — только private.
   TCP80 нужен только если выбран HTTP ACME challenge.
3. Настроить TURN/TLS для сетей без UDP и проверить реальный relay. TURN не
   должен быть открытым relay. Подобрать ограниченный relay port range,
   согласовать его сетевой охват отдельно; не открывать все порты VM.
4. JWT обязателен для всех участников: ENABLE_AUTH=1, AUTH_TYPE=jwt,
   ENABLE_GUESTS=0, JWT_ALLOW_EMPTY=0; JWT_APP_ID=fit;
   JWT_ACCEPTED_ISSUERS=fit, JWT_ACCEPTED_AUDIENCES=jitsi.
   Включить проверку room claim (без wildcard) и domain claim на выбранном
   внутреннем XMPP domain. JWT сам по себе не задаёт moderator role.
5. Одинаковый случайный секрет >=32байт на API/Jitsi, через защищённые env
   mounts. Не помещать секреты в compose, Git, frontend, URL, workflow output
   или browser storage. Пользовательский JWT выдаётся на5min, на одну комнату;
   существующий разговор не прерывается только из-за истечения join-токена.
6. Статика /libs/lib-jitsi-meet.min.js — CORS для приложения и native WebView;
   публичная статика может отдавать Access-Control-Allow-Origin:*. WebSocket
   /xmpp-websocket — разрешённые app origins и обязательная JWT авторизация.
7. Проверить JVB advertised IP/NAT, XMPP connection/reconnection, TURN,
   отсутствие PII/tokens в access/error/analytics logs. Сторонняя аналитика off.

## API runtime configuration

Добавить в защищённый API env только после приёмки сервера:

```
JITSI_ENABLED=true
JITSI_ORIGIN=https://meet.fit-training.ru
JITSI_XMPP_DOMAIN=meet.jitsi
JITSI_MUC_DOMAIN=muc.meet.jitsi
JITSI_APP_ID=fit
```

JITSI_JWT_SECRET задаётся отдельно в защищённом env; его значение здесь не
приводится. Точные XMPP/MUC names должны совпадать с выбранной инсталляцией,
не выводиться из публичного DNS. Отсутствующий JITSI_ENABLED оставляет функцию
недоступной. Неполный enabled-config останавливает запуск API, не включает fallback.
Существующий Cloud.ru release использует api.env; новый секрет не копировать
в GitHub frontend build env. Контракт API: GET/POST
/v1/chat/conversations/:conversationId/meeting. POST action:
prepare/joined/heartbeat/leave, tabId UUID; кроме prepare нужен meetingId.

## Приёмка перед выпуском

- clean PostgreSQL17 chain, role fit_api, исходные участники, чужой actor,
  блокировка и отключённая связь; один root lock при конкурентном prepare;
- preview не создаёт сообщение/комнату; joined после CONFERENCE_JOINED;
- один notice на(meeting,user), включая вторую вкладку; обычные unread/push;
- heartbeat20s, lease75s: краткий сетевой обрыв допускает возврат, явный
  последний выход закрывает встречу. Без общего участника новая встреча новая;
- два независимых клиента: фактический двусторонний звук/видео, mute,
  camera on/off/switch, Wi-Fi↔mobile, TURN relay при запрещённом UDP;
- Safari/WebKit и физический iPhone/Android WebView отдельно. Скриншоты и
  SDK double не доказывают реальное media или background/native поведение;
- блокировка прекращает app heartbeat и захват на следующей проверке.
  Мгновенное принудительное отключение уже подключённой модифицированной
  программы требует серверного kick/revocation канала; этот PR его не доказывает.

Rollout/production activation не делать до этих проверок. Backout: disable
JITSI_ENABLED, перезапуск штатным release; additive БД сохраняет историю.
