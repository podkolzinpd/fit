#!/usr/bin/env bash
set -euo pipefail
test "$GITHUB_REPOSITORY" = podkolzinpd/fit
test "$GITHUB_REF" = refs/heads/codex/fit-yc-copy-20261128
test "$(hostname)" = fit-stage-app
if test "${COPY_PHASE:-inventory}" = connectivity; then
  private="$RUNNER_TEMP/fit-yc-copy-$GITHUB_RUN_ID.key"
  trap 'rm -f -- "$private"' EXIT
  umask 077
  printf '%s\n' "$COPY_SSH_PRIVATE_KEY" > "$private"
  ssh -i "$private" -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$PWD/scripts/fit-yc-copy-known-hosts" -o ConnectTimeout=15 deploy@89.169.148.38 'hostname; test -f /var/lib/fit-copy-bootstrap-ready; echo BOOTSTRAP_READY; df -h /'
  exit
fi
test "${COPY_PHASE:-inventory}" = inventory
printf 'SOURCE_RELEASE='; cat /opt/fit/RUNNING_SHA
printf 'FRONTEND_RELEASE='; readlink -f /opt/fit/frontend/current || true
sudo podman ps --format '{{.Names}} {{.Image}}'
sudo podman inspect fit-api-stage --format '{{range .Mounts}}{{.Source}} -> {{.Destination}}{{println}}{{end}}'
sudo podman inspect fit-api-stage --format '{{json .Config.Env}}' | python3 -c 'import json,sys; print("API_ENV_NAMES="+",".join(sorted(x.split("=",1)[0] for x in json.load(sys.stdin))))'
sudo ls /opt/fit/secrets
sudo du -sh /opt/fit/frontend /opt/fit/jitsi /var/lib/fit-mobile-updates /etc/letsencrypt 2>/dev/null || true
sudo systemctl list-unit-files 'fit*' --no-pager
sudo podman exec -i fit-api-stage node --input-type=module <<'NODE'
import {buildDatabaseConnectionConfig} from '/app/dist/db/connection-config.js';
import {createRequire} from 'node:module';
const {Client}=createRequire('/app/package.json')('pg');
const client=new Client({...buildDatabaseConnectionConfig('DATABASE'),connectionTimeoutMillis:5000,query_timeout:10000});
try {
  await client.connect();
  await client.query('begin read only');
  for (const [name,sql] of Object.entries({
    database:"select current_setting('server_version') version, pg_database_size(current_database()) bytes",
    extensions:"select extname,extversion from pg_extension order by extname",
    tables:"select schemaname,count(*)::int tables from pg_tables where schemaname not like 'pg_%' and schemaname<>'information_schema' group by 1 order by 1"
  })) console.log(JSON.stringify({name,rows:(await client.query(sql)).rows}));
  await client.query('rollback');
} catch(e) {console.log(JSON.stringify({event:'inventory_failed',code:/^[A-Z0-9]{5}$/.test(e.code??'')?e.code:'unknown'}));process.exitCode=1;}
finally {await client.end();}
NODE
