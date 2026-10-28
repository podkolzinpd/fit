#!/usr/bin/env bash
# Add only meeting locations to the existing API HTTPS virtual host.
set -euo pipefail
test "$(id -u)" = 0
test "$(hostname)" = fit-stage-app
systemctl is-active --quiet fit-jitsi.service
curl --fail --silent --max-time 5 http://127.0.0.1:18080/ready >/dev/null
test -s /opt/fit-jitsi/nginx-locations.conf
test -L /etc/nginx/sites-enabled/fit-public-api
openssl x509 -noout -checkend 604800 -in /etc/letsencrypt/live/api.fit-training.ru/fullchain.pem >/dev/null
site=/etc/nginx/sites-available/fit-public-api
backup=/opt/fit-jitsi/nginx-api-before-meetings.conf
if test -e "$backup"; then
  cmp -s "$site" "$backup" # A previous failed attempt must have restored the exact site.
else
  cp -p "$site" "$backup"
  chmod 600 "$backup"
fi
test ! -e /etc/nginx/conf.d/fit-jitsi-origins.conf
test ! -e /etc/nginx/snippets/fit-jitsi-locations.conf
rollback() {
  cp "$backup" "$site"
  chmod 644 "$site"
  rm -f /etc/nginx/conf.d/fit-jitsi-origins.conf /etc/nginx/snippets/fit-jitsi-locations.conf
  nginx -t && systemctl reload nginx || true
  systemctl disable --now coturn.service >/dev/null 2>&1 || true
}
trap rollback ERR
install -d -m 755 /etc/nginx/snippets
install -m 644 /opt/fit-jitsi/nginx-origins.conf /etc/nginx/conf.d/fit-jitsi-origins.conf
install -m 644 /opt/fit-jitsi/nginx-locations.conf /etc/nginx/snippets/fit-jitsi-locations.conf
python3 "$(dirname "$0")/patch_api_site.py" "$site"
nginx -t
systemctl reload nginx
ready=false
for attempt in $(seq 1 10); do
  status=$(curl --silent --noproxy '*' --max-time 10 --resolve api.fit-training.ru:443:127.0.0.1 \
    https://api.fit-training.ru/libs/lib-jitsi-meet.min.js -o /dev/null -w '%{http_code}')
  printf 'Meeting SDK HTTPS status: %s\n' "$status"
  if test "$status" = 200; then ready=true; break; fi
  sleep 1
done
test "$ready" = true
test "$(curl --silent --noproxy '*' --max-time 5 --resolve api.fit-training.ru:443:127.0.0.1 \
  -H 'Origin: https://untrusted.invalid' -o /dev/null -w '%{http_code}' \
  https://api.fit-training.ru/xmpp-websocket)" = 403
install -d -m 750 -o root -g turnserver /etc/fit-jitsi
install -m 640 -o root -g turnserver /opt/fit-jitsi/turnserver.conf /etc/turnserver.conf
for file in fullchain.pem privkey.pem; do
  install -m 640 -o root -g turnserver "/etc/letsencrypt/live/api.fit-training.ru/$file" "/etc/fit-jitsi/$file"
done
install -d -m 755 /etc/systemd/system/coturn.service.d
install -m 644 /opt/fit-jitsi/coturn-limits.conf /etc/systemd/system/coturn.service.d/fit-meetings.conf
install -m 700 /opt/fit-jitsi/renew-certificate /etc/letsencrypt/renewal-hooks/deploy/fit-meetings-turn
systemctl unmask coturn.service
systemctl daemon-reload
systemctl enable --now coturn.service
systemctl is-active --quiet coturn.service
timeout 10 openssl s_client -connect 10.70.10.4:5349 -servername api.fit-training.ru \
  -verify_hostname api.fit-training.ru -verify_return_error </dev/null >/dev/null 2>&1
curl --fail --silent --max-time 5 http://127.0.0.1:18080/ready >/dev/null
trap - ERR
echo 'Meeting HTTPS locations and authenticated TURN/TLS configured; API feature flag unchanged.'
