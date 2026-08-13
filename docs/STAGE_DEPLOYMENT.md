# Yandex Cloud stage deployment

This runbook prepares the isolated Fit stage. It does not authorize a
production cutover, public API invocation or changes to the current Supabase
production path.

## 1. One-time prerequisites

- Use a dedicated Yandex Cloud folder with an active billing account.
- Create a private, versioned Object Storage bucket for Terraform state.
- Create a least-privilege infrastructure service account and static S3 access
  key outside this stack.
- Copy `infra/yandex/backend.hcl.example` to ignored `backend.hcl` and replace
  the example bucket and key.
- Copy `terraform.tfvars.example` to an ignored stage tfvars file.
- Keep all Terraform apply operations serialized. The Yandex YDB/DynamoDB
  locking mechanism is deprecated by current Terraform, so this MVP does not
  claim a lock implementation that may be removed.

Never commit backend credentials, tfvars, plans, state, database URLs, OAuth
secrets or exported data.

## 2. Initialize and validate

From `infra/yandex`:

```sh
export AWS_ACCESS_KEY_ID="<state access key id>"
export AWS_SECRET_ACCESS_KEY="<state secret key>"
export TF_VAR_cloud_id="<cloud id>"
export TF_VAR_folder_id="<stage folder id>"

TF_CLI_CONFIG_FILE=terraform.rc.example terraform init \
  -backend-config=backend.hcl
terraform fmt -check
terraform validate
terraform plan -out=stage.tfplan
```

Review the saved plan before applying anything. A plan may contain sensitive
metadata and must remain untracked.

## 3. Bootstrap the image repository

The Serverless Container cannot be created before its image exists, while the
repository name is produced by Terraform. For the first deployment only,
create the registry and repository with a targeted, reviewed apply:

```sh
terraform apply \
  -target=yandex_container_registry.api \
  -target=yandex_container_repository.api
```

Build the API from the repository root with Podman, tag it with the Terraform
repository output and push it using an authenticated Yandex Container Registry
session. Use an immutable commit SHA as the image tag, not `latest`.

After the image exists, set `api_image_tag` to that SHA and generate a fresh
full plan. Do not reuse the bootstrap plan for the complete apply.

## 4. Create stage infrastructure

The first full apply creates billable resources and requires explicit approval:

- private Managed PostgreSQL 17;
- Serverless Container with no provisioned instances;
- VPC, subnet and PostgreSQL security group;
- runtime service account, Registry access and Lockbox metadata.

The database has no public IP. PostgreSQL port `6432` accepts traffic from the
user subnet and Yandex Serverless Containers service CIDR `198.19.0.0/16` only.
The container remains private while Yandex ID validation is absent.

## 5. Populate secrets and migrate

Obtain the generated `fit_owner` and `fit_api` credentials through Yandex
Connection Manager without printing them to logs or shell history. Create two
separate Lockbox versions outside Terraform. The payload entry keys must match
the names below exactly:

- `DATABASE_URL` uses `fit_api` and is attached only to the API container;
- `MIGRATION_DATABASE_URL` uses `fit_owner` and is attached only to the
  temporary migration container.

Create a Lockbox version for `DATABASE_URL` outside Terraform. It must use:

- user `fit_api`;
- the private primary PostgreSQL FQDN;
- port `6432` and database `fit`;
- session pooling;
- `target_session_attrs=read-write`;
- a short connection timeout;
- `sslmode=verify-full`;
- `sslrootcert=/app/certs/yandex-cloud-ca.pem`.

The runtime image contains the public Yandex Cloud CA bundle from
`https://storage.yandexcloud.net/cloud-certs/CA.pem`. Its reviewed SHA-256 is
`6d148f85b5213445b23ad22ff45e47e1aa2be968f183f9bd6ff39de54d47a8ef`.
Review and rotate the committed bundle before its certificates expire or when
Yandex publishes a replacement.

First set `database_owner_url_secret_version_id` and
`migration_invoker_member` to one explicitly approved operator identity.
Review and apply the plan. Terraform then creates a private migration container
with concurrency one and no public invoker.

Invoke `POST /migrate` once using that Yandex Cloud identity. The runner uses a
PostgreSQL advisory lock, applies the reviewed files from `db/migrations` and
returns only their names. A failure returns a generic response without secret
details. Verify `app_private.fit_migrations`, then set both temporary variables
back to `null` and apply again. This removes the migration container, revokes
its Lockbox access and removes the invoker binding. Deactivate the owner secret
version after verification.

Finally set `database_url_secret_version_id`, review a new plan and deploy the
API revision. Never run migrations from every API startup and never attach
`fit_owner` credentials to the API container.

## 6. Smoke checks

Invoke the private container using an authorized Yandex Cloud identity:

1. `GET /health` returns `200 {"status":"ok"}`. This checks only the process.
2. `GET /ready` returns `200 {"status":"ready"}`. This performs `select 1`
   through the runtime pool.
3. Temporarily using a wrong or missing database secret makes `/ready` return
   generic `503 {"status":"not_ready"}` without exposing connection details.
4. Confirm the PostgreSQL host still has no public IP and the container is not
   invokable by `system:allUsers`.
5. Confirm migrations `000001` through `000003` exist in `app_private.fit_migrations`.
6. Confirm the migration container no longer exists and its owner secret
   version is inactive.

Record resource IDs, image digest, migration version and smoke results. Do not
record secret payloads.

## 7. Stop condition

Stage readiness is complete only when private invocation, database readiness
and migration verification pass. Do not enable public invocation or switch any
frontend environment until Yandex ID validation and application sessions are
implemented and reviewed.
