# Yandex Cloud infrastructure foundation

This directory describes the first Fit stage environment in Yandex Cloud. It
does not apply infrastructure automatically and contains no cloud credentials,
database password, OAuth secret or Terraform state.

## Resources described

- one VPC and private subnet in `ru-central1-d`;
- one private Managed PostgreSQL 17 host with no public IP;
- separate `fit_owner` migration and non-owner `fit_api` runtime users;
- one `fit` database owned only by the migration user;
- one Serverless Container with 1 GB RAM and no provisioned instances;
- one private 512 MB push dispatcher with no provisioned instances, plus a
  one-minute timer and separate least-privilege runtime/scheduler identities;
- one Container Registry repository with image retention;
- one least-privilege runtime service account;
- direct references to the generated Connection Manager Lockbox secrets;
- a private cold migration runner invoked only by the OIDC-backed deployment
  identity before an API revision is changed. The runner uses the owner identity
  for migrations and separately probes the exact `fit_api` runtime identity
  before an API revision can be created.

The API container is private by default. Stage delivery enables browser invocation
only after Yandex ID validation and the read-only rollout allowlist are present.
The migration runner and push dispatcher are always private. The dispatcher
reuses the existing `fit-send-push-notifications` function. That function lives
in a separate Functions security scope, so its OIDC identity reads only
`PUSH_DISPATCH_SECRET` into a masked runner-temporary file. After switching back
to the stage OIDC identity, the workflow creates or updates the deletion-protected
`fit-stage-push-transport` Lockbox mirror and removes the temporary files. The
dispatcher receives `lockbox.payloadViewer` only on that stage-local secret.
Terraform receives only the mirror ID and immutable version; the payload never
enters GitHub outputs, environment files, logs or Terraform state. The source
version ID in the mirror version description makes later rotations idempotent.
The provider cannot plan IAM binding lists containing service-account IDs that
are still unknown on the first run. The read-only plan therefore omits only
those free IAM members. After the bootstrap identity phase, the workflow pins
their IDs from Terraform state and the final reviewed plan manages the exact
registry and dispatcher bindings without folder-wide roles or configuration drift.

## Safe workflow

The first infrastructure bootstrap is manual and reviewed. Steady-state stage
delivery is owned by `.github/workflows/deploy-yandex-stage.yml`: OIDC
authentication, immutable image push, locked forward migrations, final
Terraform plan/apply, private runtime-database preflight, bounded readiness
checks and automatic image rollback.

The first push-pipeline bootstrap is an explicit exception to steady-state
automatic delivery. The plan summary shows the exact new identities, private
container and timer plus a bounded usage estimate. A manual `workflow_dispatch`
with `plan_only=true` can review that plan without applying it; an apply fails
before build or migration until a second manual run sets `plan_only=false` and
`approve_push_pipeline=true`. The workflow creates the timer only after the
private dispatcher reports the exact candidate release; a failed update restores
the preceding revision, while a failed first revision leaves no timer. Once the
resources exist, immutable image updates follow the normal automatic path.

At one invocation per minute there are about 43,200 dispatcher requests per
30-day month. With 512 MB, 1 vCPU and zero warm instances, the current official
Russia-region rates imply roughly 0–389 RUB/month for average 0.1–5 second
calls, before shared free-tier consumption. Sender-function calls and outgoing
Web Push traffic remain usage-dependent; the workflow repeats this estimate
before the one-time approval.

The only long-lived CI credentials are repository secrets containing the
dedicated S3 access key and secret for the private Terraform state bucket.
Yandex API access uses short-lived OIDC tokens; an authorized-key JSON is not
stored in GitHub.

The Terraform service account needs `vpc.user`, `logging.editor` and
`connection-manager.editor` in addition to the resource-management roles used
by this stack, and the Connection Manager service must be enabled in the
folder. `logging.editor` is required because revision configuration explicitly
selects the stage folder as its log destination. Current Managed PostgreSQL API
versions choose their managed Connection Manager and Lockbox folders
automatically; do not add explicit `user_connection_manager` folder IDs to the
database users.

Revision deployment uses the Serverless Containers REST API with the same
short-lived OIDC IAM token as Terraform. The request is derived from Terraform
plan JSON, not duplicated workflow configuration. After deployment Terraform
refreshes state and a second plan must show no container drift before remaining
infrastructure changes can be applied.

Before the first deployment, a folder owner must grant the OIDC-backed deploy
service account an explicit `iam.serviceAccounts.user` role on the stage
folder, as required by the documented Serverless Containers CI/CD setup. This
bootstrap grant is deliberately not managed by this Terraform stack: the
deployer must not be able to expand its own folder permissions. When
`deployer_member` is set, Terraform additionally manages direct grants on the
deployer itself and both runtime service accounts, and the workflow verifies
those three least-privilege bindings before image work or migrations.

The exact bootstrap, migration and smoke-test sequence is documented in
`docs/STAGE_DEPLOYMENT.md`.

The service network `198.19.0.0/16` is explicitly allowed to reach only the
PostgreSQL Odyssey port `6432`. Yandex assigns addresses from this range to
network-connected Serverless Containers; it is distinct from the user subnet.

## Temporary Supabase function bridge

`parse-workout` and `summarize-client-training` can execute in the API
Serverless Container before the source data is migrated. Their caller still
authenticates with a Supabase JWT; the container verifies it with Supabase and
reads/writes through the existing RLS and service-role contracts. Client
invitations no longer use an e-mail Edge Function: both current production and
Yandex stage use the explicit single-use code lifecycle.

The isolated Yandex pilot has native equivalents for these contracts. Its
invitation lifecycle, workout parser and goal-aware summary authenticate with
the short-lived Fit pilot session, read Yandex PostgreSQL and never receive a
Supabase JWT. The bridge remains only for unchanged production tenants until a
reviewed cohort cutover.

Native stage parser and summary generation do not mount a permanent AI key.
The API service account has only `ai.languageModels.user`; the Serverless
Container obtains a short-lived IAM token from its GCE-compatible metadata
endpoint. Ordinary deployment checks only stored summary reads and therefore
make no paid model request. The two synthetic AI scenarios run only through
the manually dispatched `smoke-yandex-stage-ai.yml` workflow after the exact
`RUN_PAID_AI_SMOKE` confirmation; bounded model retries can add requests.

Before the first native AI deployment, a folder administrator grants
`ai.languageModels.user` once to the existing `fit-stage-api` service account.
This folder-level bootstrap binding is deliberately outside Terraform: the
OIDC deployer must not receive `resource-manager.admin` or be able to expand
its own permissions. Ordinary deploys remain automatic after this one-time
grant, and the controlled AI smoke verifies the effective runtime permission.

To enable this bridge on an isolated stage, a security administrator creates an
existing Lockbox version with exactly these payload keys:

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `YANDEX_CLOUD_API_KEY`

Set only the Lockbox ID and version through the two
`legacy_supabase_bridge_lockbox_*` Terraform inputs. Do not put payload values
in Terraform variables, GitHub variables, repository files or frontend builds.
The API receives a Supabase session only in `X-Supabase-Authorization`, because
the container transport reserves `Authorization` for Yandex IAM. The container
timeout is 120 seconds to preserve the existing summary function's bounded
three-attempt, 30-second YandexGPT policy.

Do not place backend credentials, OAuth secrets, database passwords or URLs,
`.tfplan` or state files in the repository.

Pull-request CI never applies Terraform. A merge to `main` creates a plan and
automatically deploys only when policy confirms an existing API/migration image
update with no new paid resource, resize, identity change, delete or replacement.
Every other infrastructure plan stops before image push, migration or apply.
Feature branches initialize Terraform without the remote backend and validate
the configuration without Yandex OIDC or state credentials; remote plan and
apply remain restricted to `main`.

## Current intentional limits

- a single PostgreSQL host is the MVP cost choice, not a high-availability
  production topology;
- the first compatibility migration provides transaction-local actor context;
- Yandex ID verification, controlled stage enrollment and the read-only profile
  endpoint are implemented. The default-off browser pilot still requires a
  reviewed stage apply and an explicitly enrolled test identity;
- native Yandex AI stage calls use runtime IAM metadata; their paid synthetic
  smoke is separate from automatic deployment;
- Terraform state backend and CI identity are selected before the first apply.
