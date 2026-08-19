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
- one Container Registry repository with image retention;
- one least-privilege runtime service account;
- direct references to the generated Connection Manager Lockbox secrets;
- a private cold migration runner invoked only by the OIDC-backed deployment
  identity before an API revision is changed.

The container is private by default. Do not set
`allow_unauthenticated_api = true` until the API validates Yandex ID tokens.

## Safe workflow

The first infrastructure bootstrap is manual and reviewed. Steady-state stage
delivery is owned by `.github/workflows/deploy-yandex-stage.yml`: OIDC
authentication, immutable image push, locked forward migrations, final
Terraform plan/apply, private readiness checks and automatic image rollback.

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

When `deployer_member` is set, Terraform grants that OIDC-backed service
account `iam.serviceAccounts.user` on itself and the two runtime service
accounts. Serverless Containers requires both self-use and runtime-identity
attachment permission when the caller is a service account. The deployment
workflow verifies all three grants through IAM before touching the registry or
running a migration; a folder-wide impersonation grant is unnecessary.

The exact bootstrap, migration and smoke-test sequence is documented in
`docs/STAGE_DEPLOYMENT.md`.

The service network `198.19.0.0/16` is explicitly allowed to reach only the
PostgreSQL Odyssey port `6432`. Yandex assigns addresses from this range to
network-connected Serverless Containers; it is distinct from the user subnet.

Do not place backend credentials, OAuth secrets, database passwords or URLs,
`.tfplan` or state files in the repository.

Pull-request CI never applies Terraform. A merge creates a plan; the protected
`yandex-stage` GitHub Environment requires an explicit approval before any
image push, migration or apply.

## Current intentional limits

- a single PostgreSQL host is the MVP cost choice, not a high-availability
  production topology;
- the first compatibility migration provides transaction-local actor context;
- Yandex ID verification and the read-only profile endpoint are implemented in
  the API, but the OAuth application, real allowlist, public invocation,
  frontend routing and stage revision deployment remain separate operations;
- Terraform state backend and CI identity are selected before the first apply.
