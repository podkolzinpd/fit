#!/usr/bin/env bash

set -euo pipefail

readonly max_attempts=5
attempt=1

while true; do
  log_file=$(mktemp)
  if terraform plan "$@" 2>&1 | tee "$log_file"; then
    rm -f "$log_file"
    exit 0
  fi

  if ! grep -q 'rpc error: code = Unavailable' "$log_file" || (( attempt >= max_attempts )); then
    rm -f "$log_file"
    exit 1
  fi

  delay_seconds=$((attempt * 20))
  echo "Yandex API returned transient Unavailable; retrying terraform plan in ${delay_seconds}s (${attempt}/${max_attempts})." >&2
  rm -f "$log_file"
  sleep "$delay_seconds"
  attempt=$((attempt + 1))
done
