# Видеовстречи Fit / YAFIT-669

Это контракт подготовки собственного Jitsi; сервер пока не развёрнут этим PR.
Проверенная upstream release: docker-jitsi-meet stable-11248-2 (28.10.2026).
Не направлять production на meet.jit.si. Версию SDK сервировать из того же
проверенного выпуска, что и сервер. В Fit используется только lib-jitsi-meet,
без Jitsi Meet iframe, отдельного аккаунта и брендинга.

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
