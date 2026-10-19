#!/usr/bin/env bash
set -Eeuo pipefail
revision=${1:?}
attempt=${2:?}
test "$(id -u)" = 0
test "$(hostname)" = fit-stage-app
[[ "$revision" =~ ^[a-f0-9]{40}$ && "$attempt" =~ ^[0-9]+-[0-9]+$ ]]
test "$(cat /opt/fit/RUNNING_SHA)" = "$revision"
test "$(readlink -f /etc/nginx/sites-enabled/fit-public-api)" = /etc/nginx/sites-available/fit-public-api
next="/opt/fit/secrets/speech-next-$attempt.env"
test "$(stat -c '%u:%a' "$next")" = 0:600
backup="/opt/fit/speech-rollbacks/$attempt"
test ! -e "$backup"
install -d -m 700 "$backup"
files=(/opt/fit/SPEECH_RELEASE_SHA /opt/fit/secrets/speech.env
  /etc/systemd/system/fit-speechkit.service /usr/local/libexec/fit-cloudru-speechkit
  /etc/nginx/sites-available/fit-public-api)
for index in "${!files[@]}"; do
  path=${files[$index]}
  test ! -L "$path"
  if test -f "$path"; then cp -p -- "$path" "$backup/$index"; fi
done
was_active=false
if systemctl is-active --quiet fit-speechkit.service; then was_active=true; fi
diagnose_failed_relay() {
  echo 'Cloud.ru speech promotion diagnostics (no request data):' >&2
  systemctl show fit-speechkit.service \
    --property=LoadState --property=ActiveState --property=SubState --property=Result \
    --property=ExecMainCode --property=ExecMainStatus --property=NRestarts >&2 || true
  podman ps --all --filter name=fit-speechkit-cloudru --format '{{.Names}} {{.Status}}' >&2 || true
  ss --listening --tcp --numeric 'sport = :18084' >&2 || true
}
rollback() {
  trap - ERR INT TERM
  failed=false
  diagnose_failed_relay
  systemctl stop fit-speechkit.service 2>/dev/null || true
  for index in "${!files[@]}"; do
    path=${files[$index]}
    if test -f "$backup/$index"; then cp -p -- "$backup/$index" "$path" || failed=true
    else rm -f -- "$path" || failed=true
    fi
  done
  systemctl daemon-reload || failed=true
  if test "$was_active" = true; then systemctl start fit-speechkit.service || failed=true; fi
  nginx -t && systemctl reload nginx || failed=true
  if test "$failed" = true; then echo 'Cloud.ru speech rollback failed.' >&2; fi
  exit 1
}
trap rollback ERR INT TERM
install -d -m 755 /usr/local/libexec
install -m 755 infra/cloudru/fit-cloudru-speechkit /usr/local/libexec/fit-cloudru-speechkit
install -m 644 infra/cloudru/fit-speechkit.service /etc/systemd/system/fit-speechkit.service
mv -T -- "$next" /opt/fit/secrets/speech.env
printf '%s\n' "$revision" > /opt/fit/SPEECH_RELEASE_SHA
chmod 644 /opt/fit/SPEECH_RELEASE_SHA
systemctl daemon-reload
systemctl restart fit-speechkit.service
for number in {1..20}; do
  if curl --fail --silent --max-time 2 http://127.0.0.1:18084/health >/dev/null; then break; fi
  test "$number" -lt 20
  sleep 1
done
podman run --rm --network=host --read-only --cap-drop=ALL --security-opt=no-new-privileges \
  "localhost/fit-speechkit:$revision" node cloudru-smoke.mjs guard
install -m 644 infra/cloudru/nginx-public-api.conf /etc/nginx/sites-available/fit-public-api
nginx -t
systemctl reload nginx
curl --fail --silent --show-error --max-time 10 --resolve api.fit-training.ru:443:127.0.0.1 \
  https://api.fit-training.ru/ready >/dev/null
systemctl enable fit-speechkit.service
trap - ERR INT TERM
echo 'Cloud.ru authenticated SpeechKit relay and HTTPS ingress verified.'
