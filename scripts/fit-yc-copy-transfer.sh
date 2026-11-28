#!/usr/bin/env bash
set -euo pipefail
test "$GITHUB_REPOSITORY" = podkolzinpd/fit
test "$GITHUB_REF" = refs/heads/codex/fit-yc-copy-20261128
test "$(hostname)" = fit-stage-app
phase=${COPY_PHASE:?}
case "$phase" in export|database|media|restore|runtime|verify|inspect-target|source-code|certificates|acceptance|configure) ;; *) exit 2;; esac
jq -e '.folder=="b1gt7dfqg9sht9slnno5" and .vm_ip=="89.169.148.38" and .db_id=="c9q5ic9v0500c217e71n"' <<<"$COPY_CONFIG_JSON" >/dev/null
private="$RUNNER_TEMP/fit-yc-copy-$GITHUB_RUN_ID.key"
envfile="$RUNNER_TEMP/fit-yc-copy-$GITHUB_RUN_ID.env"
scratch="/opt/fit/copy-export-$GITHUB_RUN_ID"
umask 077
printf '%s\n' "$COPY_SSH_PRIVATE_KEY" > "$private"
cleanup(){ rm -f -- "$private" "$envfile"; }
trap cleanup EXIT
ssh_options=(-i "$private" -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$PWD/scripts/fit-yc-copy-known-hosts" -o ConnectTimeout=15 -o ServerAliveInterval=15)
remote(){ ssh "${ssh_options[@]}" deploy@89.169.148.38 "$@"; }
remote 'sudo install -d -m 700 /opt/fit-copy; test -f /var/lib/fit-copy-bootstrap-ready'
printf '%s' "$COPY_CONFIG_JSON" | remote 'sudo sh -c "umask 077; cat > /opt/fit-copy/target.json"'
tar -cf - scripts/fit-yc-copy-target.sh scripts/fit-yc-copy-verify.mjs scripts/fit-yc-copy-runtime.py scripts/fit-yc-copy-background.mjs | remote 'sudo tar -xf - -C /opt/fit-copy --strip-components=1'
if test "$phase" = export; then
  printf 'copy_stage=runtime_files\n'
  # Only active app configuration is copied. Historical credentials and receipts stay on the source.
  source_paths=(/opt/fit/frontend /opt/fit/RUNNING_SHA /opt/fit/SPEECH_RELEASE_SHA /opt/fit/BACKGROUND_STARTED_AT /opt/fit/secrets/api.env /opt/fit/secrets/background.env /opt/fit/secrets/speech.env /opt/fit-jitsi /var/lib/fit-mobile-updates /etc/nginx /etc/turnserver.conf /etc/systemd/system/fit-background.service /etc/systemd/system/fit-background.timer /etc/systemd/system/fit-frontend-stage.service /etc/systemd/system/fit-speechkit.service /etc/systemd/system/fit-jitsi.service /etc/systemd/system/fit-jitsi.slice /usr/local/libexec/fit-cloudru-background /usr/local/libexec/fit-cloudru-speechkit)
  sudo rsync -aR --bwlimit=8192 --rsync-path='sudo rsync' -e "ssh -i $private -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=$PWD/scripts/fit-yc-copy-known-hosts -o ServerAliveInterval=15" "${source_paths[@]}" deploy@89.169.148.38:/
  printf 'copy_stage=container_images\n'
  mapfile -t images < <(sudo podman ps --format '{{.Image}}' | sort -u)
  test "${#images[@]}" = 6
  sudo podman save --format docker-archive --multi-image-archive "${images[@]}" | remote 'sudo podman load >/dev/null'
  printf 'copy_stage=runtime_files_and_images_copied\n'
elif test "$phase" = database; then
  jq -e '.MIGRATION_DATABASE_HOST=="10.70.10.67" and .MIGRATION_DATABASE_USER=="fit_owner" and .MIGRATION_DATABASE_NAME=="fit"' <<<"$SOURCE_DATABASE_CONFIG_JSON" >/dev/null
  jq -r 'to_entries[] | select(.key | startswith("MIGRATION_DATABASE_")) | "\(.key)=\(.value)"' <<<"$SOURCE_DATABASE_CONFIG_JSON" > "$envfile"
  printf 'MIGRATION_DATABASE_SSL_MODE=require\n' >> "$envfile"
  sudo install -d -m 700 "$scratch"
  revision=$(cat /opt/fit/RUNNING_SHA)
  [[ "$revision" =~ ^[a-f0-9]{40}$ ]]
  sudo podman run --rm --read-only --user 0 --memory=512m --cpus=1 --cap-drop=ALL --security-opt=no-new-privileges --env-file "$envfile" --mount "type=bind,src=$scratch,dst=/copy" -v "$PWD/scripts/fit-yc-copy-database.mjs:/copy-database.mjs:ro" "localhost/fit-api:$revision" node /copy-database.mjs
  sudo tar -C "$scratch" -cf - source.dump source-manifest.json | remote 'sudo tar -xf - -C /opt/fit-copy'
  printf 'source_dump_sha256=';sudo sha256sum "$scratch/source.dump" | cut -d ' ' -f1
  remote 'printf "target_dump_sha256="; sudo sha256sum /opt/fit-copy/source.dump | cut -d " " -f1'
  sudo rm -f -- "$scratch/source.dump" "$scratch/source-manifest.json"
  sudo rmdir -- "$scratch"
elif test "$phase" = media; then
  printf 'COPY_CONFIG_JSON=%s\n' "$COPY_CONFIG_JSON" > "$envfile"
  revision=$(cat /opt/fit/RUNNING_SHA)
  sudo podman run --rm --read-only --memory=512m --cpus=0.5 --cap-drop=ALL --security-opt=no-new-privileges --env-file /opt/fit/secrets/api.env --env-file "$envfile" -v "$PWD/scripts/fit-yc-copy-media.mjs:/copy-media.mjs:ro" "localhost/fit-api:$revision" node /copy-media.mjs
elif test "$phase" = acceptance; then
  sudo podman exec -i fit-api-stage node --input-type=module <<'NODE_META' | remote 'sudo sh -c "umask 077; cat > /opt/fit-copy/source-metadata.json"'
import {buildDatabaseConnectionConfig} from '/app/dist/db/connection-config.js';
import {createRequire} from 'node:module';
const {Client}=createRequire('/app/package.json')('pg');
const client=new Client({...buildDatabaseConnectionConfig('DATABASE'),connectionTimeoutMillis:5000,query_timeout:5000});
try{await client.connect();console.log(JSON.stringify((await client.query("select datcollate,datctype,current_setting('server_version') version,current_setting('timezone') timezone from pg_database where datname=current_database()" )).rows[0]));}finally{await client.end();}
NODE_META
  sudo python3 - <<'PY_FRONTEND' | remote 'sudo sh -c "umask 077; cat > /opt/fit-copy/frontend-manifest.json"'
import json,hashlib,pathlib
root=pathlib.Path('/opt/fit/frontend/current').resolve()
print(json.dumps({str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(root.rglob('*')) if p.is_file()}))
PY_FRONTEND
  remote 'sudo bash /opt/fit-copy/fit-yc-copy-target.sh acceptance'
  revision=$(cat /opt/fit/RUNNING_SHA)
  sudo podman run --rm --read-only --memory=256m --cpus=0.5 --cap-drop=ALL --security-opt=no-new-privileges -v "$PWD/scripts/fit-yc-copy-acceptance.mjs:/copy-acceptance.mjs:ro" "localhost/fit-api:$revision" node /copy-acceptance.mjs
elif test "$phase" = certificates; then
  # Preserve the complete existing renewal state, without enabling it before cutover.
  sudo rsync -aR --rsync-path='sudo rsync' -e "ssh -i $private -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=$PWD/scripts/fit-yc-copy-known-hosts" /etc/letsencrypt deploy@89.169.148.38:/
  remote 'sudo systemctl disable --now certbot.timer'
  echo 'existing_domain_tls_copied_without_dns_changes=true'
elif test "$phase" = source-code; then
  revision=$(cat /opt/fit/RUNNING_SHA)
  [[ "$revision" =~ ^[a-f0-9]{40}$ ]]
  remote "sudo install -d -m 755 /opt/fit/source/$revision"
  if jq -e '.source_archive_url and .source_archive_sha256' <<<"$COPY_CONFIG_JSON" >/dev/null; then
    remote 'sudo bash /opt/fit-copy/fit-yc-copy-target.sh source-code'
  else
    curl --fail --silent --show-error --max-time 600 --location -H "Authorization: Bearer $COPY_REPOSITORY_TOKEN" -H "Accept: application/vnd.github+json" "https://api.github.com/repos/podkolzinpd/fit/tarball/$revision" | remote "sudo tar -xz -C /opt/fit/source/$revision --strip-components=1"
  fi
  printf 'source_code_copied_revision=%s\n' "$revision"
else
  remote "sudo bash /opt/fit-copy/fit-yc-copy-target.sh '$phase'"
fi
