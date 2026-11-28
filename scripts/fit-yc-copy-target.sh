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
  runtime|configure)
    test -e /opt/fit-copy/DATABASE_RESTORED
    if test "$1" = runtime;then test ! -e /opt/fit-copy/RUNTIME_STARTED;fi
    python3 /opt/fit-copy/fit-yc-copy-runtime.py
    if ! test -f /usr/lib/nginx/modules/ngx_stream_module.so;then apt-get update -qq; DEBIAN_FRONTEND=noninteractive apt-get install -y libnginx-mod-stream >/dev/null;fi
    systemctl disable --now certbot.timer
    systemctl stop nginx
    web=$(python3 -c 'import json;print(json.load(open("/opt/fit-copy/target.json"))["domain"])')
    api=$(python3 -c 'import json;print(json.load(open("/opt/fit-copy/target.json"))["api_domain"])')
    test -s "/etc/letsencrypt/live/$web/fullchain.pem"
    test -s "/etc/letsencrypt/live/$api/fullchain.pem"
    openssl x509 -noout -checkend 86400 -in "/etc/letsencrypt/live/$web/fullchain.pem" >/dev/null
    openssl x509 -noout -checkend 86400 -in "/etc/letsencrypt/live/$api/fullchain.pem" >/dev/null
    install -d -m 750 -o root -g turnserver /etc/fit-jitsi
    for file in fullchain.pem privkey.pem;do install -m 640 -o root -g turnserver "/etc/letsencrypt/live/$api/$file" "/etc/fit-jitsi/$file";done
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
    curl -fsS --max-time 10 --resolve "$web:443:127.0.0.1" "https://$web/api/ready" >/dev/null
    curl -fsS --max-time 10 --resolve "$api:443:127.0.0.1" "https://$api/libs/lib-jitsi-meet.min.js" >/dev/null
    test "$(curl -sS --max-time 10 --resolve "$api:443:127.0.0.1" -H 'Origin: https://untrusted.invalid' -o /dev/null -w '%{http_code}' "https://$api/xmpp-websocket")" = 403
    systemctl is-active fit-api fit-frontend-stage fit-speechkit fit-jitsi nginx coturn fit-background.timer
    touch /opt/fit-copy/RUNTIME_STARTED
    echo 'runtime_started_and_public_routes_verified=true'
    ;;
  source-code)
    revision=$(cat /opt/fit/RUNNING_SHA)
    podman run --rm --read-only --user 0 --network host -v /opt/fit-copy:/copy "localhost/fit-api:$revision" node --input-type=module -e '
      import {readFile,rename} from "node:fs/promises";import {createWriteStream} from "node:fs";import {Readable,Transform} from "node:stream";import {pipeline} from "node:stream/promises";import {createHash} from "node:crypto";
      try{const c=JSON.parse(await readFile("/copy/target.json","utf8"));if(c.folder!=="b1gt7dfqg9sht9slnno5")throw Error();const r=await fetch(c.source_archive_url,{signal:AbortSignal.timeout(300000)});if(!r.ok)throw Error();const h=createHash("sha256");let bytes=0;await pipeline(Readable.fromWeb(r.body),new Transform({transform(chunk,_enc,cb){bytes+=chunk.length;h.update(chunk);cb(null,chunk);}}),createWriteStream("/copy/source-code.part",{mode:0o600}));const sha256=h.digest("hex");if(sha256!==c.source_archive_sha256)throw Error();await rename("/copy/source-code.part","/copy/source-code.tar.gz");console.log(JSON.stringify({event:"source_archive_readback_verified",bytes,sha256}));}catch{console.log("source_archive_readback_failed");process.exitCode=1;}'
    install -d -m 755 "/opt/fit/source/$revision"
    tar -xzf /opt/fit-copy/source-code.tar.gz --strip-components=1 -C "/opt/fit/source/$revision"
    echo 'source_archive_extracted=true'
    ;;
  acceptance)
    test -e /opt/fit-copy/RUNTIME_STARTED
    python3 - <<'PY_COMPARE'
import json,hashlib,pathlib
manifest=json.loads(pathlib.Path('/opt/fit-copy/frontend-manifest.json').read_text())
root=pathlib.Path('/opt/fit/frontend/current').resolve()
actual={str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(root.rglob('*')) if p.is_file()}
assert actual==manifest,'frontend_copy_mismatch'
print(json.dumps({'event':'published_frontend_byte_copy_verified','files':len(actual),'sha256':hashlib.sha256(json.dumps(actual,sort_keys=True).encode()).hexdigest()}))
PY_COMPARE
    revision=$(cat /opt/fit/RUNNING_SHA)
    podman run --rm --read-only --user 0 --network host --env-file /opt/fit/secrets/copy-owner.env -v /opt/fit-copy:/copy "localhost/fit-api:$revision" node /copy/fit-yc-copy-verify.mjs
    speech=$(cat /opt/fit/SPEECH_RELEASE_SHA)
    podman run --rm --read-only --network host --env-file /opt/fit/secrets/speech.env "localhost/fit-speechkit:$speech" node cloudru-smoke.mjs upstream
    podman run --rm --read-only --network host "localhost/fit-speechkit:$speech" node cloudru-smoke.mjs guard
    podman run --rm --read-only --network host --env-file /opt/fit/secrets/api.env "localhost/fit-api:$revision" node --input-type=module -e '
      import {programModelJson} from "/app/dist/assistant-orchestrator/program/model.js";
      try{const value=await programModelJson({instruction:"Return the JSON object {\"ok\":true}.",data:{},schema:{type:"object",additionalProperties:false,required:["ok"],properties:{ok:{type:"boolean"}}},functionName:"fit-copy-synthetic-smoke",operationId:"standby-synthetic-smoke",maxTokens:20,timeoutMs:20000});if(value?.ok!==true)throw Error("invalid_result");console.log(JSON.stringify({event:"target_ai_smoke_passed"}));}catch(e){console.log(JSON.stringify({event:"target_ai_smoke_failed",reason:/^program_model_http_[1-5][0-9]{2}$/.test(e.message)?e.message:"request"}));process.exitCode=1;}'
    timeout 10 openssl s_client -connect 127.0.0.1:5349 -servername api.fit-training.ru -verify_hostname api.fit-training.ru -verify_return_error </dev/null >/dev/null 2>&1
    echo 'turn_tls_verified=true'
    systemctl is-active fit-api fit-frontend-stage fit-speechkit fit-jitsi nginx coturn fit-background.timer
    test ! -e /opt/fit-copy/ENABLE_BACKGROUND_DELIVERY
    echo 'background_delivery_held=true'
    podman ps --format '{{.Names}} {{.Image}} {{.Status}}'
    ;;
  *) echo 'target_phase_not_implemented'; exit 2;;
esac
