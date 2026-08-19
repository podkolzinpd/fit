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
exchange_response=$(curl --fail --silent --show-error \
  --request POST \
  --header 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode 'grant_type=urn:ietf:params:oauth:grant-type:token-exchange' \
  --data-urlencode 'requested_token_type=urn:ietf:params:oauth:token-type:access_token' \
  --data-urlencode "audience=$YC_DEPLOY_SA_ID" \
  --data-urlencode "subject_token=$github_token" \
  --data-urlencode 'subject_token_type=urn:ietf:params:oauth:token-type:id_token' \
  https://auth.yandex.cloud/oauth/token)
iam_token=$(jq -er '.access_token' <<<"$exchange_response")

echo "::add-mask::$iam_token"
printf 'YC_TOKEN=%s\n' "$iam_token" >>"$GITHUB_ENV"
