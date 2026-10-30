#!/usr/bin/env bash
set -euo pipefail
test "$(id -u)" = 0
test "$(hostname)" = fit-stage-app
echo 'Checking aggregate resource limits'
systemctl show fit-jitsi.slice --property=MemoryMax --property=CPUQuotaPerSecUSec
test "$(systemctl show fit-jitsi.slice --property=MemoryMax --value)" = 2147483648
test "$(systemctl show fit-jitsi.slice --property=CPUQuotaPerSecUSec --value)" = 1s
for service in web prosody jicofo jvb; do
  echo "Checking $service container isolation"
  container=$(podman ps --filter 'label=io.podman.compose.project=fit-jitsi' \
    --filter "label=com.docker.compose.service=$service" --format '{{.ID}}')
  test -n "$container"
  parent=$(podman inspect "$container" --format '{{.HostConfig.CgroupParent}}')
  test "$(basename "$parent")" = fit-jitsi.slice
  limit=$(podman inspect "$container" --format '{{.HostConfig.Memory}}')
  test "$limit" -gt 0
  printf '%s: memory limit %s bytes; parent fit-jitsi.slice\n' "$service" "$limit"
done
echo 'Checking JWT and internal credentials are configured (values suppressed)'
prosody=$(podman ps --filter 'label=io.podman.compose.project=fit-jitsi' --filter 'label=com.docker.compose.service=prosody' --format '{{.ID}}')
podman exec "$prosody" /bin/sh -c 'test "$ENABLE_AUTH" = 1 && test "$AUTH_TYPE" = jwt && test "$ENABLE_GUESTS" = 0 && test "$JWT_ALLOW_EMPTY" = 0 && test -n "$JWT_APP_SECRET"'
for service in jicofo jvb; do
  container=$(podman ps --filter 'label=io.podman.compose.project=fit-jitsi' --filter "label=com.docker.compose.service=$service" --format '{{.ID}}')
  if test "$service" = jicofo; then
    podman exec "$container" /bin/sh -c 'test -n "$JICOFO_AUTH_PASSWORD"'
  else
    podman exec "$container" /bin/sh -c 'test -n "$JVB_AUTH_PASSWORD"'
  fi
done
for attempt in $(seq 1 30); do
  if curl --fail --silent --max-time 5 http://127.0.0.1:8000/libs/lib-jitsi-meet.min.js -o /dev/null; then
    curl --fail --silent --max-time 5 http://127.0.0.1:18080/ready >/dev/null
    echo 'Jitsi SDK ready on loopback; Fit API ready.'
    exit 0
  fi
  sleep 2
done
echo 'Jitsi loopback SDK did not become ready.' >&2
exit 1
