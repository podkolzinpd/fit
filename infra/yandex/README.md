# Yandex Cloud infrastructure foundation

This directory describes the first Fit stage environment in Yandex Cloud. It
does not apply infrastructure automatically and contains no cloud credentials,
database password, OAuth secret or Terraform state.

## Resources described

- one VPC and private subnet in `ru-central1-d`;
- one private Managed PostgreSQL 17 host with no public IP;
- one Serverless Container with 1 GB RAM and no provisioned instances;
- one Container Registry repository with image retention;
- one least-privilege runtime service account;
- Lockbox secret metadata for `DATABASE_URL`, without a secret payload.

The container is private by default. Do not set
`allow_unauthenticated_api = true` until the API validates Yandex ID tokens.

## Safe workflow

1. Authenticate the Yandex provider outside the repository and set
   `TF_VAR_cloud_id` and `TF_VAR_folder_id`.
2. Run `TF_CLI_CONFIG_FILE=terraform.rc.example terraform init` in this
   directory. The config uses the official Yandex Cloud provider mirror.
3. Run `terraform fmt -check` and `terraform validate`.
4. Copy `terraform.tfvars.example` to an ignored local `.tfvars` file and
   review `terraform plan -out=stage.tfplan`.
5. Build `services/api/Dockerfile` with Podman, tag it with the
   `api_repository_name` output and push it before any container apply.
6. Create the database role and `DATABASE_URL` Lockbox payload outside this
   foundation step. Pass only its version ID to Terraform.

Do not run `terraform apply` as part of review or CI. The first apply needs a
separate approval because Managed PostgreSQL and other resources are billable.

## Current intentional limits

- a single PostgreSQL host is the MVP cost choice, not a high-availability
  production topology;
- database/user creation and actor context belong to the next migration step;
- Yandex ID, public invocation and frontend switching are not implemented;
- Terraform state backend and CI identity are selected before the first apply.
