#!/usr/bin/env bash
# Prepare bounded, isolated services. No nginx ingress, firewall or API activation.
set -euo pipefail
test "$(id -u)" = 0
test "$(hostname)" = fit-stage-app
test "$(. /etc/os-release; printf '%s:%s' "$ID" "$VERSION_ID")" = ubuntu:24.04
test ! -e /opt/fit-jitsi
test ! -e /etc/systemd/system/fit-jitsi.service
test ! -e /etc/systemd/system/fit-jitsi.slice
test ! -e /etc/turnserver.conf.fit-backup
test "$(awk '/MemAvailable:/ {print $2}' /proc/meminfo)" -ge 2500000
test "$(df -Pk / | awk 'NR==2 {print $4}')" -ge 8388608
curl --fail --silent --max-time 5 http://127.0.0.1:18080/ready >/dev/null
for port in 8000 8443 8080 8888 10000 3478 5349; do
  if ss -H -lntu | awk -v port="$port" '{n=split($5,a,":"); if(a[n]==port) found=1} END {exit !found}'; then
    echo "Required meeting port $port is already used; refusing preparation." >&2
    exit 1
  fi
done
# Package installation must not start an unconfigured TURN listener.
test ! -e /etc/systemd/system/coturn.service
systemctl mask coturn.service
apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y podman-compose coturn
python3 "$(dirname "$0")/prepare.py" --output /opt/fit-jitsi \
  --public-ip 87.242.117.210 --private-ip 10.70.10.4 --domain api.fit-training.ru
for path in web prosody/config prosody/prosody-plugins-custom jicofo jvb; do
  install -d -m 755 "/opt/fit-jitsi/config/$path"
done
for path in storage/prosody storage/transcripts storage/web tmp/web-load-test; do
  install -d -m 700 -o 1000 -g 1000 "/opt/fit-jitsi/config/$path"
done
for path in web prosody/config jicofo jvb; do
  install -d -m 755 "/opt/fit-jitsi/config/$path/custom-ca"
done
install -m 644 /opt/fit-jitsi/fit-jitsi.slice /etc/systemd/system/fit-jitsi.slice
install -m 644 /opt/fit-jitsi/fit-jitsi.service /etc/systemd/system/fit-jitsi.service
systemctl daemon-reload
trap 'systemctl disable --now fit-jitsi.service >/dev/null 2>&1 || true' ERR
cd /opt/fit-jitsi
# Never print interpolated compose config: it includes the JWT and service secrets.
podman-compose -p fit-jitsi -f compose.yml -f compose.fit.yml pull >/dev/null
systemctl enable --now fit-jitsi.service
bash "$(dirname "$0")/verify-host.sh"
trap - ERR
