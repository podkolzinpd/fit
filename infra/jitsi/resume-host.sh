#!/usr/bin/env bash
# Resume this task's prepared bundle without rotating or copying any credentials.
set -euo pipefail
test "$(id -u)" = 0
test "$(hostname)" = fit-stage-app
test -s /opt/fit-jitsi/.env
test -s /opt/fit-jitsi/compose.fit.yml
test -s /etc/systemd/system/fit-jitsi.service
test "$(df -Pk / | awk 'NR==2 {print $4}')" -ge 8388608
curl --fail --silent --max-time 5 http://127.0.0.1:18080/ready >/dev/null
trap 'systemctl disable --now fit-jitsi.service >/dev/null 2>&1 || true' ERR
systemctl enable --now fit-jitsi.service
bash "$(dirname "$0")/verify-host.sh"
trap - ERR
