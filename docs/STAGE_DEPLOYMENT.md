# Yandex Cloud stage deployment

This runbook describes the durable stage delivery path. It does not authorize a
production cutover or changes to the current Supabase production path. The
stage API transport is browser-accessible for the default-off Yandex ID pilot;
application data remains protected by verified Yandex ID and a database
allowlist. The migration runner remains private.

## 1. Steady-state contract

After the one-time bootstrap, a release is performed only by
`.github/workflows/deploy-yandex-stage.yml`:

1. A push to `main` affecting `services/api` or `infra/yandex` creates a
   Terraform plan. The plan contains no secret values and its safe resource
   summary is written to the workflow summary.
2. The plan policy allows only existing API and migration runner revisions,
   exact credential metadata and lifecycle updates, and the reviewed public API
   binding. A new resource, resize, identity change, delete or replacement stops
   the workflow before any apply. Safe plans continue automatically.
3. GitHub exchanges its OIDC token for a short-lived Yandex Cloud IAM token.
   No authorized-key JSON is used by CI.
4. Terraform applies the scoped runtime identity and secret access grants
   before any revision is created. A read-only preflight polls Yandex IAM until
   the deployer can use itself and both runtime service accounts. A missing
   grant or IAM authorization error stops the release before Container Registry,
   image build and migrations. The workflow then derives an immutable image tag
   from the `services/api` Git tree hash and checks it in Container Registry.
   Changes outside the API and retries reuse the existing image; an API content
   change builds it once on the GitHub runner and pushes it.
5. The workflow converts the reviewed Terraform planned values into a
   Serverless Containers REST `DeployRevision` request and deploys the
   candidate image only to the private migration runner. `POST /migrate`
   applies all pending forward migrations under an advisory lock. A failure
   stops the release before the API changes.
6. Terraform generates a fresh plan and the workflow deploys the API revision
   through the same REST API. Terraform refreshes state immediately after each
   direct deployment and refuses to continue if either container still differs
   from the reviewed configuration. Private `/health` and `/ready` checks must
   pass. A readiness failure rolls back to the exact previous revision. If the
   plan contains no container change, the active revision is reused. The stage
   API receives a public invocation binding only through the exact reviewed
   Terraform resource; the migration runner never receives one.

The migration runner has no provisioned instances and costs nothing while
idle. It stays private, has concurrency one and can be invoked only by the
OIDC-backed deployment service account. The runtime API service account cannot
read the migration owner's password.

Serverless Container revision deployment deliberately uses the documented REST
API instead of the Terraform provider. Provider `DeployRevision` can return a
successful Terraform process status while the cloud API reports a permission
warning for service-account authentication. Terraform still owns the reviewed
configuration and remote state: direct revisions are built only from plan JSON,
then state is refreshed and a second plan must contain no container drift. The
adapter converts Terraform's Go-duration values such as `5m0s` to the protobuf
JSON duration required by REST, such as `300s`.

## 2. One-time Yandex Cloud bootstrap

Use the existing stage folder, versioned private Object Storage state bucket
and infrastructure service account. Attach that service account to a Workload
Identity Federation configured as follows:

- issuer: `https://token.actions.githubusercontent.com`;
- audience: `https://github.com/podkolzinpd`;
- JWKS URL: `https://token.actions.githubusercontent.com/.well-known/jwks`;
- subject for the plan job:
  `repo:podkolzinpd@3878475/fit@1307853602:ref:refs/heads/main`;
- subject for the deploy job:
  `repo:podkolzinpd@3878475/fit@1307853602:ref:refs/heads/main`.

The service account needs the existing Terraform resource-management roles,
`container-registry.images.pusher`, `logging.editor`, Connection Manager
metadata read access and permission to update Serverless Container IAM
bindings. A folder owner must grant this account an explicit
`iam.serviceAccounts.user` role on the stage folder. This one-time bootstrap
follows Yandex Cloud's documented CI/CD setup and is intentionally outside the
Terraform stack: the deployer must not be able to expand its own folder
permissions. Terraform additionally grants `iam.serviceAccounts.user` directly
on the deployer itself and the two runtime service accounts, and grants
`serverless.containers.invoker` on the private migration and API containers.

Keep one dedicated static S3 key for the Terraform state backend. This is not a
Yandex API authorized-key JSON and is not used for provider authentication.
Store it only in GitHub repository secrets and rotate it on schedule or after
an incident, not on every deployment. Both jobs use only repository-level
values; no deploy credential is stored in a GitHub Environment.

## 3. One-time GitHub configuration

Add these repository variables:

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
- A plan containing delete or replacement actions always fails in the automatic
  workflow.
- Managed PostgreSQL cluster or database destruction is always blocked by the
  plan policy, including manual runs.
- Automatic deployment accepts only updates to the existing API and migration
  containers without CPU, memory, timeout, concurrency, identity, connectivity
  or logging changes; the existing registry lifecycle and credential metadata;
  and the exact reviewed public API binding. Every other create or in-place
  infrastructure change fails before apply.
- `workflow_dispatch` is a safe retry of the same policy, not a destructive or
  infrastructure-change override. New or cost-changing infrastructure requires
  a separate reviewed workflow change and must show its cost before apply.
- `system:allUsers` is accepted only on the exact stage API invocation binding,
  only with the explicit `--allow-public-api` policy flag used by this workflow,
  and only for the `serverless.containers.invoker` role. It is rejected for the
  migration runner and every other resource.
- Plan files and state are never uploaded as GitHub artifacts.

## 6. Image lifecycle

Images use the full `services/api` Git tree hash, never `latest`. Container
Registry retains the ten newest immutable API images and expires older
content-addressed or untagged layers after seven days. This keeps enough
versions for rollback without rebuilding the API for documentation or
infrastructure-only changes.

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

The automatic workflow verifies:

1. the deployer has direct `iam.serviceAccounts.user` bindings on itself and
   both runtime identities before any image work; `DeployRevision` also fails
   closed if the one-time folder grant is missing;
2. migration response is `200` with a generic migrated result;
3. `GET /health` returns `200 {"status":"ok"}`;
4. `GET /ready` returns `200 {"status":"ready"}`;
5. the API has only the reviewed public invoker binding; the migration runner
   remains private.

Until a separate cutover is reviewed, do not change the frontend API URL,
production Vercel variables or the existing Supabase path. The Yandex ID browser
pilot remains default-off and its workout UI remains read-only; stage mutation
endpoints are exercised only by automated smoke until a separate repository
adapter and UI rollout are reviewed.

The first browser pilot uses the existing branch-scoped Vercel Preview rather
than a separate cloud frontend. Its exact origin is included in the stage CORS
allowlist and its Yandex OAuth callback is:

```text
https://fit-git-codex-yandex-id-b494d5-uniteddispatch999-8643s-projects.vercel.app/auth/yandex/callback
```

Only that preview branch receives the three pilot build variables:
`VITE_YANDEX_ID_PILOT_ENABLED=true`, the public
`VITE_YANDEX_OAUTH_CLIENT_ID`, and `VITE_YANDEX_API_BASE_URL` pointing to the
stage API. Do not add them to Production or to every Preview deployment.

`.github/workflows/sync-yandex-stage-preview.yml` merges every verified `main`
push into `codex/yandex-id-stage-pilot`. Vercel therefore rebuilds the same
branch-scoped origin automatically; the OAuth callback and CORS allowlist do
not need to change after normal merges. The workflow never force-pushes. A
merge conflict stops synchronization visibly instead of replacing either
branch.

The browser sends the short-lived Fit pilot session in
`X-Fit-Pilot-Session`, not in `Authorization`. Yandex Serverless Containers
reserves `Authorization: Bearer ...` for Yandex IAM invocation tokens and can
reject an application token at the gateway before Fastify receives it. The
custom header is allowed only for the exact pilot origins by the API CORS
policy; it contains no Yandex token and is never persisted by the browser.

The same session authorizes `GET /v1/clients`, `GET /v1/connections` and
`GET /v1/training-data`. Connections include only memberships for clients
accessible through PostgreSQL actor context and only active invitations
created by that actor. Claimed, revoked and expired invitations are filtered in
the database. Planned-workout `POST`, `PUT` and `DELETE` commands are available
only through the stage API and are not connected to production UI routing.
They execute security-definer aggregate functions with actor checks, optimistic
versions and full transaction rollback; `fit_api` still has no direct INSERT,
UPDATE or DELETE grants on workout tables. The delivery smoke uses the
short-lived synthetic fixture session to verify all three read models plus
create, update, stale-version conflict, soft delete and the final filtered read
before a revision is accepted.

The base domain mutation slice adds stage-only client card and custom exercise
commands. `POST /v1/clients` creates either a trainer-managed card or the
caller's single self-managed card. `PUT /v1/clients/:id` and
`PUT /v1/clients/:id/archive` are restricted to the root trainer or the linked
client account; `GET /v1/clients?archived=true` exposes only accessible archived
cards so restoration survives a reload. A connected trainer can only change that trainer's private
alias and note through `PUT /v1/clients/:id/preferences`, using the independent
membership version. `POST /v1/custom-exercises`, `PUT /v1/custom-exercises/:id`
and `PUT /v1/custom-exercises/:id/archive` are owner-trainer only. Every update
requires an expected version, tenant existence is not leaked to unauthorized
actors, and the runtime role still has no direct domain-table write grants.

The Live core adds stage-only start, set-draft, set-confirm and finish commands.
Every request carries an `operationId` UUID in addition to its expected version.
An exact retry by the same actor returns the committed result with
`replayed: true` instead of mutating twice; reusing the UUID for different input
is rejected, and a new operation against a stale workout or set version returns
`409`. Operation receipts contain no workout facts: only internal UUIDs, action,
request SHA-256, result version and, for structural commands, the affected or
created child UUID. They expire from the retry ledger after 30 days and are not
readable by `fit_api`.

The structural Live slice adds stage-only exercise append, set append/remove,
exercise replacement, block reorder and exercise comment commands. They lock
and version the workout root, preserve a single set when removing, inherit the
previous set's plan/fact when appending, reject replacement after a confirmed
set and keep positions contiguous. The smoke replays start, exercise append,
set removal and set-save requests, then replaces and comments an exercise,
reorders its block, confirms and finishes the aggregate, checks a stale finish
conflict and reads the final structure and facts back.

## 8. Enroll a stage pilot account

Enrollment is an explicit stage administration operation. It validates a
temporary Yandex OAuth token against the configured client, stores only the
SHA-256 identity mapping, creates a profile without name or email and assigns
read-only Yandex backend access. The route exists only on the private migration
runner when `YANDEX_PILOT_ENROLLMENT_ENABLED=true`; it is not part of the public
API container.

Run the following in Yandex Cloud Shell after the matching revision is active.
The hidden prompt and stdin request body keep the OAuth token out of shell
history and process arguments:

```sh
read -rsp 'Temporary Yandex OAuth token: ' FIT_YANDEX_TOKEN
printf '\n'
FIT_YC_TOKEN="$(yc iam create-token)"
FIT_MIGRATION_URL="$(terraform -chdir=infra/yandex output -raw migration_container_url)"
test -n "${FIT_YANDEX_TOKEN:?}" && test -n "${FIT_YC_TOKEN:?}" && test -n "${FIT_MIGRATION_URL:?}"
jq -n --arg token "$FIT_YANDEX_TOKEN" --arg role trainer \
  '{accessToken: $token, accountRole: $role}' \
  | curl --fail --silent --show-error \
      --request POST \
      --header "Authorization: Bearer $FIT_YC_TOKEN" \
      --header 'Content-Type: application/json' \
      --data-binary @- \
      "${FIT_MIGRATION_URL%/}/pilot/enroll"
unset FIT_YANDEX_TOKEN FIT_YC_TOKEN FIT_MIGRATION_URL
```

Use `client` instead of `trainer` only when that is the intended product role.
Repeating the same role is idempotent. Changing an enrolled identity's role is
rejected and requires a separately reviewed data correction. Never paste the
OAuth token into a URL, a GitHub variable, logs or repository files.

## 9. Human read-only database access

Do not share `fit_owner` or `fit_api` and do not grant `mdb_read_all_data`.
`fit_api` can install application actor context and execute mutations;
`mdb_read_all_data` also reaches private application schemas. Neither is a
human read-only profile.

Onboard a stage reader once in Yandex Cloud:

1. add the person's Yandex account to the stage folder with the reviewed
   folder and cluster viewer/connector roles;
2. create a Managed PostgreSQL IAM user and allow that user to connect to the
   `fit` database, without an administrative or `mdb_*` data role;
3. open GitHub Actions, select `Manage Yandex stage database access`, run it
   from `main`, choose `grant`, and enter that PostgreSQL IAM username.

The workflow is the explicit audit event; it requires no Git commit, PR,
migration, database password or Cloud Shell command. It uses GitHub OIDC to
invoke the existing private migration runner. A repeat grant is safe. To remove
access, run the same workflow with `revoke` before removing the Cloud IAM and
Managed PostgreSQL user bindings.

Readers connect to the `fit` database and browse only the `ops_readonly`
schema. Its views cover the domain tables but omit names, free-form personal
fields, invitation hashes and every `app_private` object. The access function
also removes direct grants left by manual experiments and rejects privileged
roles. Existing readers automatically receive future views created by
`fit_owner`; a new domain table must add its curated view as part of that
table's normal migration, never as a per-person migration.

## 10. Legacy credential transition

The first deployment through this pipeline switches the containers from the
manually created URL secrets to the managed Connection Manager secrets. Keep
the legacy secret metadata and runtime reader binding only until the new API
passes readiness. Then deactivate the legacy payload version and remove the
legacy Terraform resources in a separately reviewed cleanup plan. This is a
one-time transition and is not part of future releases.
