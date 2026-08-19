#!/usr/bin/env bash
set -euo pipefail

: "${ACTIONS_ID_TOKEN_REQUEST_TOKEN:?GitHub OIDC request token is required}"
: "${ACTIONS_ID_TOKEN_REQUEST_URL:?GitHub OIDC request URL is required}"
: "${GITHUB_ENV:?GITHUB_ENV is required}"
: "${YC_DEPLOY_SA_ID:?YC_DEPLOY_SA_ID is required}"
: "${YC_OIDC_AUDIENCE:?YC_OIDC_AUDIENCE is required}"

encoded_audience=$(jq -rn --arg value "$YC_OIDC_AUDIENCE" '$value | @uri')
github_response=$(curl --fail --silent --show-error \
  --header "Authorization: Bearer $ACTIONS_ID_TOKEN_REQUEST_TOKEN" \
  "${ACTIONS_ID_TOKEN_REQUEST_URL}&audience=${encoded_audience}")
github_token=$(jq -er '.value' <<<"$github_response")

echo "::add-mask::$github_token"
oidc_claims=$(node -e '
  let token = ""
  process.stdin.setEncoding("utf8")
  process.stdin.on("data", (chunk) => { token += chunk })
  process.stdin.on("end", () => {
    const claims = JSON.parse(Buffer.from(token.trim().split(".")[1], "base64url"))
    process.stdout.write(JSON.stringify({ iss: claims.iss, aud: claims.aud, sub: claims.sub }))
  })
' <<<"$github_token")
printf 'GitHub OIDC claims: %s\n' "$oidc_claims"

exchange_response=$(curl --silent --show-error \
  --request POST \
  --header 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode 'grant_type=urn:ietf:params:oauth:grant-type:token-exchange' \
  --data-urlencode 'requested_token_type=urn:ietf:params:oauth:token-type:access_token' \
  --data-urlencode "audience=$YC_DEPLOY_SA_ID" \
  --data-urlencode "subject_token=$github_token" \
  --data-urlencode 'subject_token_type=urn:ietf:params:oauth:token-type:id_token' \
  https://auth.yandex.cloud/oauth/token)
if ! iam_token=$(jq -er '.access_token' <<<"$exchange_response"); then
  error_code=$(jq -r '.error // .code // "unknown_error"' <<<"$exchange_response")
  error_description=$(jq -r '.error_description // .message // "No error description"' <<<"$exchange_response")
  printf 'Yandex token exchange failed: %s: %s\n' "$error_code" "$error_description" >&2
  exit 1
fi

echo "::add-mask::$iam_token"
printf 'YC_TOKEN=%s\n' "$iam_token" >>"$GITHUB_ENV"
