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
- Lockbox secret metadata for runtime and temporary migration URLs, without
  secret payloads;
- an opt-in private migration runner, created only while an owner secret
  version and one scoped invoker are configured.

The container is private by default. Do not set
`allow_unauthenticated_api = true` until the API validates Yandex ID tokens.

## Safe workflow

1. Create a private Object Storage bucket for Terraform state outside this
   stack. Copy `backend.hcl.example` to ignored `backend.hcl`, set its bucket
   and key, and export backend credentials as `AWS_ACCESS_KEY_ID` and
   `AWS_SECRET_ACCESS_KEY`.
2. Authenticate the Yandex provider outside the repository and set
   `TF_VAR_cloud_id` and `TF_VAR_folder_id`.
3. Run `TF_CLI_CONFIG_FILE=terraform.rc.example terraform init
   -backend-config=backend.hcl` in this directory. The config uses the official
   Yandex Cloud provider mirror.
4. Run `terraform fmt -check` and `terraform validate`.
5. Copy `terraform.tfvars.example` to an ignored local `.tfvars` file and
   review `terraform plan -out=stage.tfplan`.
6. Bootstrap only the Container Registry and repository, then build
   `services/api/Dockerfile` with Podman, tag it with the
   `api_repository_name` output and push it before any container apply.
7. Create the `DATABASE_URL` Lockbox payload outside Terraform after the
   generated database credentials exist. Pass only its version ID to Terraform.
8. Review a new full plan before the first full apply.

The exact bootstrap, migration and smoke-test sequence is documented in
`docs/STAGE_DEPLOYMENT.md`.

The service network `198.19.0.0/16` is explicitly allowed to reach only the
PostgreSQL Odyssey port `6432`. Yandex assigns addresses from this range to
network-connected Serverless Containers; it is distinct from the user subnet.

Do not place backend credentials, OAuth secrets, database URLs, `.tfplan` or
state files in the repository.

Do not run `terraform apply` as part of review or CI. The first apply needs a
separate approval because Managed PostgreSQL and other resources are billable.

## Current intentional limits

- a single PostgreSQL host is the MVP cost choice, not a high-availability
  production topology;
- the first compatibility migration provides transaction-local actor context;
- Yandex ID, public invocation and frontend switching are not implemented;
- Terraform state backend and CI identity are selected before the first apply.
