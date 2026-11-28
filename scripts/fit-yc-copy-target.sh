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
  restore)
    test ! -e /opt/fit-copy/DATABASE_RESTORED
    install -d -m 700 /opt/fit/secrets
    python3 - <<'PY_CONFIG'
import json,pathlib
c=json.loads(pathlib.Path('/opt/fit-copy/target.json').read_text())
assert c['folder']=='b1gt7dfqg9sht9slnno5'
values={'MIGRATION_DATABASE_HOST':c['db_host'],'MIGRATION_DATABASE_PORT':'6432','MIGRATION_DATABASE_NAME':'fit','MIGRATION_DATABASE_USER':'fit_owner','MIGRATION_DATABASE_PASSWORD':c['owner_password'],'MIGRATION_DATABASE_SSL_MODE':'verify-full'}
p=pathlib.Path('/opt/fit/secrets/copy-owner.env');p.write_text(''.join(k+'='+v+'\n' for k,v in values.items()));p.chmod(0o600)
PY_CONFIG
    revision=$(cat /opt/fit/RUNNING_SHA)
    image="localhost/fit-api:$revision"
    test -s /opt/fit-copy/source.dump
    # Provider-managed extensions are prepared through the managed database API.
    podman run --rm --read-only --user 0 --network host -v /opt/fit-copy:/copy "$image" pg_restore --list /copy/source.dump > /opt/fit-copy/restore.list
    python3 - <<'PY_LIST'
from pathlib import Path
p=Path('/opt/fit-copy/restore.list');lines=p.read_text().splitlines()
p.write_text('\n'.join(';'+line if (' EXTENSION ' in line or ' COMMENT - EXTENSION ' in line) and not line.startswith(';') else line for line in lines)+'\n')
PY_LIST
    if ! podman run --rm --read-only --user 0 --network host --env-file /opt/fit/secrets/copy-owner.env -v /opt/fit-copy:/copy "$image" node --input-type=module -e '
      import {spawnSync} from "node:child_process";
      const p=spawnSync("pg_restore",["--exit-on-error","--no-owner","--host="+process.env.MIGRATION_DATABASE_HOST,"--port=6432","--username=fit_owner","--dbname=fit","--use-list=/copy/restore.list","/copy/source.dump"],{env:{...process.env,PGPASSWORD:process.env.MIGRATION_DATABASE_PASSWORD,PGSSLMODE:"verify-full",PGSSLROOTCERT:"/app/certs/yandex-cloud-ca.pem"},encoding:"utf8",maxBuffer:1024*1024});
      if(p.status!==0){await (await import("node:fs/promises")).writeFile("/copy/restore-private-error.txt",p.stderr??"",{mode:0o600});console.log(JSON.stringify({event:"restore_failed",code:p.status}));process.exit(1);}console.log("database_restored=true");'; then
      exit 1
    fi
    touch /opt/fit-copy/DATABASE_RESTORED
    ;;
  verify)
    revision=$(cat /opt/fit/RUNNING_SHA)
    podman run --rm --read-only --user 0 --network host --env-file /opt/fit/secrets/copy-owner.env -v /opt/fit-copy:/copy "localhost/fit-api:$revision" node /copy/fit-yc-copy-verify.mjs
    ;;
  runtime)
    test -e /opt/fit-copy/DATABASE_RESTORED
    test ! -e /opt/fit-copy/RUNTIME_STARTED
    python3 /opt/fit-copy/fit-yc-copy-runtime.py
    systemctl stop nginx
    web=$(python3 -c 'import json;print(json.load(open("/opt/fit-copy/target.json"))["domain"])')
    api=$(python3 -c 'import json;print(json.load(open("/opt/fit-copy/target.json"))["api_domain"])')
    if ! test -f "/etc/letsencrypt/live/$web/fullchain.pem"; then
      if ! certbot certonly --standalone --non-interactive --agree-tos --register-unsafely-without-email --cert-name "$web" -d "$web" -d "$api" >/opt/fit-copy/certbot-private.log 2>&1; then
        echo 'certificate_issuance_failed';exit 1
      fi
    fi
    if ! test -e "/etc/letsencrypt/live/$api"; then ln -s "$web" "/etc/letsencrypt/live/$api";fi
    install -d -m 750 -o root -g turnserver /etc/fit-jitsi
    for file in fullchain.pem privkey.pem;do install -m 640 -o root -g turnserver "/etc/letsencrypt/live/$web/$file" "/etc/fit-jitsi/$file";done
    systemctl daemon-reload
    nginx -t -c /etc/nginx/fit-copy.conf
    systemctl enable --now fit-api.service fit-frontend-stage.service fit-speechkit.service fit-jitsi.service
    systemctl unmask coturn.service
    systemctl enable --now nginx coturn fit-background.timer
    for attempt in $(seq 1 30);do
      if curl -fsS --max-time 5 http://127.0.0.1:18080/ready >/dev/null;then break;fi
      test "$attempt" -lt 30
      sleep 2
    done
    curl -fsS --max-time 10 "https://$web/api/ready" >/dev/null
    curl -fsS --max-time 10 "https://$api/libs/lib-jitsi-meet.min.js" >/dev/null
    test "$(curl -sS --max-time 10 -H 'Origin: https://untrusted.invalid' -o /dev/null -w '%{http_code}' "https://$api/xmpp-websocket")" = 403
    systemctl is-active fit-api fit-frontend-stage fit-speechkit fit-jitsi nginx coturn fit-background.timer
    touch /opt/fit-copy/RUNTIME_STARTED
    echo 'runtime_started_and_public_routes_verified=true'
    ;;
  *) echo 'target_phase_not_implemented'; exit 2;;
esac
