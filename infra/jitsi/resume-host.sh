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
systemctl stop fit-jitsi.service
python3 - <<'PY'
from pathlib import Path
path = Path('/etc/systemd/system/fit-jitsi.service')
text = path.read_text()
if 'EnvironmentFile=/opt/fit-jitsi/.env' not in text:
    assert text.count('WorkingDirectory=/opt/fit-jitsi') == 1
    text = text.replace('WorkingDirectory=/opt/fit-jitsi', 'WorkingDirectory=/opt/fit-jitsi\nEnvironmentFile=/opt/fit-jitsi/.env')
old = 'ExecStart=/usr/bin/podman-compose -p fit-jitsi'
new = 'ExecStart=/usr/bin/podman-compose --podman-run-args=--cgroup-parent=fit-jitsi.slice -p fit-jitsi'
assert text.count(old) == 1 or text.count(new) == 1
path.write_text(text.replace(old, new))
PY
systemctl daemon-reload
systemctl enable --now fit-jitsi.service
bash "$(dirname "$0")/verify-host.sh"
trap - ERR
