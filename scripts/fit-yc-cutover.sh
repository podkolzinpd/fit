#!/usr/bin/env bash
# Owner-authorized Cloud.ru -> exact Yandex standby transition, 2026-11-28.
set -euo pipefail
test "$GITHUB_REPOSITORY" = podkolzinpd/fit
test "$GITHUB_REF" = refs/heads/codex/fit-yc-copy-20261128
test "$(hostname)" = fit-stage-app
phase=${COPY_PHASE:?}
jq -e '.folder=="b1gt7dfqg9sht9slnno5" and .vm_ip=="89.169.148.38" and .db_id=="c9q5ic9v0500c217e71n"' <<<"$COPY_CONFIG_JSON" >/dev/null
umask 077
private="$RUNNER_TEMP/fit-yc-cutover-$GITHUB_RUN_ID.key"
printf '%s\n' "$COPY_SSH_PRIVATE_KEY" > "$private"
trap 'rm -f -- "$private"' EXIT
opts=(-i "$private" -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$PWD/scripts/fit-yc-copy-known-hosts" -o ConnectTimeout=15 -o ServerAliveInterval=15)
remote(){ ssh "${opts[@]}" deploy@89.169.148.38 "$@"; }
remote 'test "$(curl -fsS --max-time 5 http://169.254.169.254/computeMetadata/v1/instance/id -H Metadata-Flavor:Google)" = fhm0ju8244ctffsq4lvd'
tar -cf - scripts/fit-yc-cutover-nginx.py scripts/fit-yc-cutover-restore.mjs | remote 'sudo tar -xf - -C /opt/fit-copy --strip-components=1'
case "$phase" in
  cutover-preflight)
    test "$(cat /opt/fit/RUNNING_SHA)" = 2874d3dfbe7ed9f2bb6ee670d47c2df48192df83
    sudo python3 scripts/fit-yc-cutover-nginx.py inspect
    sudo podman inspect fit-api-stage --format 'api_running={{.State.Running}} restart={{.HostConfig.RestartPolicy.Name}}'
    sudo systemctl is-active fit-background.timer
    remote 'sudo bash /opt/fit-copy/fit-yc-copy-target.sh boot-check'
    sudo podman exec -i fit-api-stage node --input-type=module <<'NODE'
import {buildDatabaseConnectionConfig} from '/app/dist/db/connection-config.js';
import {createRequire} from 'node:module';
const {Client}=createRequire('/app/package.json')('pg');
const db=new Client(buildDatabaseConnectionConfig('DATABASE'));
try{await db.connect();console.log(JSON.stringify({event:'source_db_connections',rows:(await db.query("select usename,count(*)::int connections from pg_stat_activity where datname=current_database() group by 1 order by 1")).rows}));}finally{await db.end();}
NODE
    ;;
  cutover-sync)
    # No source writes can resume automatically on a failed or repeated operator.
    sudo install -d -m 700 /opt/fit-cutover
    sudo test ! -e /opt/fit-cutover/TARGET_WRITES_ENABLED
    sudo python3 scripts/fit-yc-cutover-nginx.py maintenance
    sudo nginx -t
    sudo systemctl reload nginx
    sudo systemctl disable --now fit-background.timer
    sudo systemctl stop fit-background.service
    sudo install -d -m 755 /etc/systemd/system/fit-background.service.d
    printf '[Unit]\nConditionPathExists=/opt/fit-cutover/ALLOW_SOURCE_WRITES\n' | sudo tee /etc/systemd/system/fit-background.service.d/cutover.conf >/dev/null
    sudo systemctl daemon-reload
    # Existing unless-stopped policy respects an explicit stop, including reboot.
    sudo podman stop --time 20 fit-api-stage >/dev/null
    sudo systemctl stop fit-speechkit.service
    sudo systemctl disable --now certbot.timer
    remote 'set -e; sudo systemctl stop fit-api.service fit-background.timer; sudo systemctl stop fit-background.service; sudo test ! -e /opt/fit-copy/ENABLE_BACKGROUND_DELIVERY; sudo install -d -m 700 /opt/fit-copy/cutover-20261128'
    echo 'source_and_target_writers_stopped=true'
    COPY_PHASE=database bash scripts/fit-yc-copy-transfer.sh
    remote 'set -e; sudo cp -p /opt/fit-copy/source.dump /opt/fit-copy/source-manifest.json /opt/fit-copy/cutover-20261128/; revision=$(cat /opt/fit/RUNNING_SHA); sudo podman run --rm --read-only --user 0 --network host --env-file /opt/fit/secrets/copy-owner.env -v /opt/fit-copy:/copy "localhost/fit-api:$revision" node /copy/fit-yc-cutover-restore.mjs'
    COPY_PHASE=verify bash scripts/fit-yc-copy-transfer.sh
    COPY_PHASE=media bash scripts/fit-yc-copy-transfer.sh
    remote 'sudo touch /opt/fit-copy/cutover-20261128/SYNC_VERIFIED; sudo systemctl start fit-api.service; for n in $(seq 1 30);do if curl -fsS --max-time 5 http://127.0.0.1:18080/ready >/dev/null;then echo target_ready_after_sync=true;exit 0;fi;sleep 2;done;exit 1'
    echo 'final_sync_complete_source_still_frozen=true'
    ;;
  cutover-forward)
    remote 'set -e; sudo test -e /opt/fit-copy/cutover-20261128/SYNC_VERIFIED; curl -fsS --max-time 10 --resolve fit-training.ru:443:127.0.0.1 https://fit-training.ru/api/ready >/dev/null'
    # From this point rollback requires preserving all new target writes.
    sudo touch /opt/fit-cutover/TARGET_WRITES_ENABLED
    sudo python3 scripts/fit-yc-cutover-nginx.py forward
    sudo nginx -t
    sudo systemctl reload nginx
    curl -fsS --max-time 15 --resolve fit-training.ru:443:127.0.0.1 https://fit-training.ru/api/ready >/dev/null
    curl -fsS --max-time 15 --resolve api.fit-training.ru:443:127.0.0.1 https://api.fit-training.ru/health | jq -e '.releaseId=="2874d3dfbe7ed9f2bb6ee670d47c2df48192df83"' >/dev/null
    echo 'old_public_ip_now_proxies_only_yandex_cloud=true'
    ;;
  cutover-activate)
    sudo test -e /opt/fit-cutover/TARGET_WRITES_ENABLED
    test "$(sudo podman inspect fit-api-stage --format '{{.State.Running}}')" = false
    test "$(sudo systemctl is-enabled fit-background.timer)" = disabled
    remote 'set -e; sudo test -e /opt/fit-copy/cutover-20261128/SYNC_VERIFIED; for h in fit-training.ru www.fit-training.ru api.fit-training.ru;do test "$(getent ahostsv4 "$h" | awk "{print \$1}" | sort -u)" = 89.169.148.38;done; sudo touch /opt/fit-copy/ENABLE_BACKGROUND_DELIVERY; sudo systemctl enable --now fit-background.timer certbot.timer; sudo systemctl start fit-background.service; test "$(sudo systemctl show fit-background.service -p Result --value)" = success; sudo systemctl is-active --quiet fit-background.timer; sudo systemctl is-active --quiet certbot.timer; echo target_background_and_certbot_active=true'
    ;;
  *) exit 2;;
esac
