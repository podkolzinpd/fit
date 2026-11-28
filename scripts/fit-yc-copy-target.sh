#!/usr/bin/env bash
set -euo pipefail
test "$(id -u)" = 0
test "$(hostname)" = fit-stage-app
test -f /var/lib/fit-copy-bootstrap-ready
test "$(curl -fsS --max-time 5 http://169.254.169.254/computeMetadata/v1/instance/id -H Metadata-Flavor:Google)" = fhm0ju8244ctffsq4lvd
case "${1:?}" in
  inspect-target)
    printf 'target_stage=inventory\n'
    podman ps -a --format '{{.Names}} {{.Image}} {{.Status}}'
    ls /opt/fit-copy
    df -h /
    ;;
  *) echo 'target_phase_not_implemented'; exit 2;;
esac
