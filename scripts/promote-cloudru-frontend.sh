#!/usr/bin/env bash
set -Eeuo pipefail

release_file=${1:?release manifest required}
candidate=${2:?candidate required}
release_sha=${3:?source required}
[[ "$release_sha" =~ ^[a-f0-9]{40}$ ]]
[[ "$candidate" =~ ^/opt/fit/frontend/candidates/$release_sha-[0-9]+-[0-9]+$ ]]
test -d "$candidate/site" && test ! -L "$candidate/site"
test -f "$candidate/stage.conf" && test ! -L "$candidate/stage.conf"
node scripts/verify-cloudru-frontend.mjs "$release_file" "$candidate" "$release_sha"

current=/opt/fit/frontend/current
config=/etc/nginx/fit-frontend-stage.conf
unit=/etc/systemd/system/fit-frontend-stage.service
service=fit-frontend-stage.service
backup=$(mktemp -d "$RUNNER_TEMP/fit-cloudru-frontend-rollback.XXXXXX")
previous=
if [ -L "$current" ]; then
  previous=$(readlink -f "$current")
  test -d "$previous"
elif [ -e "$current" ]; then
  echo 'Refusing to replace a non-symlink frontend path.' >&2
  exit 1
fi
had_config=false
had_unit=false
was_active=false
was_enabled=false
if sudo test -e "$config"; then
  sudo test -f "$config" && ! sudo test -L "$config"
  sudo cp "$config" "$backup/stage.conf"
  had_config=true
fi
if sudo test -e "$unit"; then
  sudo test -f "$unit" && ! sudo test -L "$unit"
  sudo cp "$unit" "$backup/stage.service"
  had_unit=true
fi
if sudo systemctl is-active --quiet "$service"; then was_active=true; fi
if sudo systemctl is-enabled --quiet "$service"; then was_enabled=true; fi
next_link="$candidate/current.next"
test ! -e "$next_link" && test ! -L "$next_link"

rollback() {
  local exit_code=${1:-1}
  trap - ERR INT TERM
  set +e
  local failed=0
  if [ "$had_config" = true ]; then
    sudo cp "$backup/stage.conf" "$config" || failed=1
  else
    sudo rm -f "$config" || failed=1
  fi
  if [ "$had_unit" = true ]; then
    sudo cp "$backup/stage.service" "$unit" || failed=1
  else
    if sudo test -f "$unit"; then
      sudo systemctl stop "$service" || failed=1
      sudo systemctl disable "$service" || failed=1
    fi
    sudo rm -f "$unit" || failed=1
  fi
  sudo rm -f "$next_link" || failed=1
  if [ -n "$previous" ]; then
    sudo ln -s "$previous" "$next_link" && sudo mv -Tf "$next_link" "$current" || failed=1
  else
    sudo rm -f "$current" || failed=1
  fi
  sudo systemctl daemon-reload || failed=1
  if [ "$was_active" = true ]; then
    sudo nginx -t -c "$config" && sudo systemctl restart "$service" || failed=1
  elif [ "$had_unit" = true ]; then
    sudo systemctl stop "$service" || failed=1
  fi
  if [ "$had_unit" = true ] && [ "$was_enabled" = false ]; then
    sudo systemctl disable "$service" || failed=1
  fi
  if [ "$failed" != 0 ]; then
    echo 'Frontend rollback failed; preserved releases and configuration backup for recovery.' >&2
  else
    echo 'Previous frontend configuration and serving pointer restored.' >&2
  fi
  exit "$exit_code"
}
trap 'rollback $?' ERR
trap 'rollback 130' INT
trap 'rollback 143' TERM
sudo install -m 644 "$candidate/stage.conf" "$config"
sudo nginx -t -c "$config"
sudo install -m 644 infra/cloudru/fit-frontend-stage.service "$unit"
sudo ln -s "$candidate/site" "$next_link"
sudo mv -Tf "$next_link" "$current"
sudo systemctl daemon-reload
sudo systemctl enable --now "$service"
sudo systemctl reload "$service"
test "$(readlink -f "$current")" = "$candidate/site"
node scripts/verify-cloudru-frontend.mjs "$release_file" "$candidate" "$release_sha" --serving
trap - ERR INT TERM
echo 'Verified frontend revision promoted; API, public ingress, DNS and data unchanged.'
