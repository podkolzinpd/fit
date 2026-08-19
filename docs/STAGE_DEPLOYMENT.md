# Yandex Cloud stage deployment

This runbook describes the durable stage delivery path. It does not authorize a
production cutover, public API invocation or changes to the current Supabase
production path.

## 1. Steady-state contract

After the one-time bootstrap, a release is performed only by
`.github/workflows/deploy-yandex-stage.yml`:

1. A push to `main` affecting `services/api` or `infra/yandex` creates a
   Terraform plan. The plan contains no secret values and its safe resource
   summary is written to the workflow summary.
2. The `yandex-stage` GitHub Environment pauses the workflow for an explicit
   reviewer approval.
3. GitHub exchanges its OIDC token for a short-lived Yandex Cloud IAM token.
   No authorized-key JSON is used by CI.
4. Terraform applies the two scoped runtime-service-account attachment grants
   before any revision is created and gives Yandex IAM time to propagate them.
   The workflow then checks for the immutable commit image in Container Registry.
   A retry of the same SHA reuses the existing image; otherwise the image is
   built once on the GitHub runner and pushed.
5. Terraform deploys the candidate image only to the private migration runner.
   `POST /migrate` applies all pending forward migrations under an advisory
   lock. A failure stops the release before the API changes.
6. Terraform generates a fresh plan and deploys the API revision. Private
   `/health` and `/ready` checks must pass. A readiness failure restores the
   previous API image automatically.

The migration runner has no provisioned instances and costs nothing while
idle. It stays private, has concurrency one and can be invoked only by the
OIDC-backed deployment service account. The runtime API service account cannot
read the migration owner's password.

The Yandex Terraform provider can report a failed revision deployment as a
warning while returning a successful process status. The workflow treats that
specific warning as a hard failure for the migration candidate, API deployment
and rollback. This prevents Terraform state from being mistaken for a live
revision.

## 2. One-time Yandex Cloud bootstrap

Use the existing stage folder, versioned private Object Storage state bucket
and infrastructure service account. Attach that service account to a Workload
Identity Federation configured as follows:

- issuer: `https://token.actions.githubusercontent.com`;
- audience: `https://github.com/podkolzinpd`;
- JWKS URL: `https://token.actions.githubusercontent.com/.well-known/jwks`;
- subject for the plan job:
  `repo:podkolzinpd@3878475/fit@1307853602:ref:refs/heads/main`;
- subject for the approved deploy job:
  `repo:podkolzinpd@3878475/fit@1307853602:environment:yandex-stage`.

The service account needs the existing Terraform resource-management roles,
`container-registry.images.pusher`, Connection Manager metadata read access and
permission to update Serverless Container IAM bindings. Terraform grants this
same account `serverless.containers.invoker` on the private migration and API
containers and `iam.serviceAccounts.user` directly on their two runtime
service accounts. The latter is required to attach those identities to a
revision and is deliberately not granted folder-wide.

Keep one dedicated static S3 key for the Terraform state backend. This is not a
Yandex API authorized-key JSON and is not used for provider authentication.
Store it only in GitHub repository secrets and rotate it on schedule or after
an incident, not on every deployment. The pre-approval plan job deliberately
does not enter the protected Environment, so it cannot read Environment-only
secrets.

## 3. One-time GitHub configuration

Create a protected GitHub Environment named `yandex-stage` with at least one
required reviewer. Add these repository variables (not Environment-only
variables, because the plan job runs before approval):

- `YC_CLOUD_ID`;
- `YC_FOLDER_ID`;
- `YC_DEPLOY_SA_ID`;
- `YC_TFSTATE_BUCKET`;
- `YC_API_REPOSITORY` in the form `<registry-id>/api`;
- `YC_YANDEX_OAUTH_CLIENT_ID` (public client ID, never the client secret).

Add exactly two repository secrets containing the existing dedicated state
credentials:

- `YC_TFSTATE_ACCESS_KEY_ID`;
- `YC_TFSTATE_SECRET_ACCESS_KEY`.

Do not add the old authorized-key JSON, database passwords, database URLs or
the Yandex OAuth client secret to GitHub.

## 4. Database credentials and migrations

Managed PostgreSQL generates separate `fit_owner` and `fit_api` credentials in
Connection Manager. Terraform reads only their Lockbox metadata and injects
only the password entry into the matching container:

- `fit_owner` is available only to the private migration runner;
- `fit_api` is available only to the API runtime.

Host, port, database and user are non-secret environment variables. TLS uses
the committed Yandex Cloud CA bundle and certificate verification. No
application Lockbox version is created for each release, no credential is
copied into a URL, and no password is stored in Terraform state.

Every new file in `services/api/db/migrations` is checked in PR CI, replayed on
a clean PostgreSQL 17 database and then automatically applied to stage before
the matching API revision. Existing migrations are immutable and destructive
patterns are rejected. Migrations must remain expand-only so the previous API
image can run after an automatic application rollback.

## 5. Terraform safety gates

- State remains in the private Object Storage backend. GitHub Actions
  serializes every stage operation with one concurrency group.
- A plan containing delete or replacement actions fails by default.
- Managed PostgreSQL cluster or database destruction is always blocked by the
  plan policy, including manual runs.
- A reviewed `workflow_dispatch` may set `allow_destroy=true` only for a known
  non-database transition.
- Adding `system:allUsers` is outside this workflow and is always rejected.
- Plan files and state are never uploaded as GitHub artifacts.

## 6. Image lifecycle

Images use the full Git commit SHA, never `latest`. Container Registry retains
the ten newest commit images and expires older commit or untagged layers after
seven days. This keeps enough versions for rollback without unbounded storage.

For an exceptional local build, use Podman with the API directory as the build
context:

```sh
podman build --platform linux/amd64 \
  --file services/api/Dockerfile \
  --tag "cr.yandex/<registry-id>/api:<commit-sha>" \
  services/api
```

Using the repository root as the build context is incorrect: it installs the
frontend dependency tree and can exhaust the local Podman VM.

## 7. Smoke and stop conditions

The approved workflow verifies:

1. migration response is `200` with a generic migrated result;
2. `GET /health` returns `200 {"status":"ok"}`;
3. `GET /ready` returns `200 {"status":"ready"}`;
4. the API remains private and has no `system:allUsers` binding.

Until a separate cutover is reviewed, do not change the frontend API URL,
production Vercel variables or the existing Supabase path. The local Yandex ID
pilot remains default-off and read-only.

## 8. Legacy credential transition

The first deployment through this pipeline switches the containers from the
manually created URL secrets to the managed Connection Manager secrets. Keep
the legacy secret metadata and runtime reader binding only until the new API
passes readiness. Then deactivate the legacy payload version and remove the
legacy Terraform resources in a separately reviewed cleanup plan. This is a
one-time transition and is not part of future releases.
