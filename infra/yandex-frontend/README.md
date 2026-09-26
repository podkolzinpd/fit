# Frontend storage foundation — not deployed

This independent Terraform root is not part of `../yandex` or its production
state. `enabled` defaults to `false`. There is no website endpoint, public access,
DNS, TLS, IAM, CDN or compute resource. Enabling it creates private versioned
storage only, not a working frontend deployment.

Offline configuration checks (provider download requires network access):

```sh
terraform init -backend=false
terraform fmt -check -recursive
terraform validate
terraform test
```

Tests use a mock provider and do not create cloud resources. Do not run `apply`
as part of this preparation. A future deployment requires separate approval,
a reviewed plan, dedicated state/backend and a scoped deployment identity.

The 10 GiB `max_size` limits stored bytes, not traffic charges. Version retention
and cleanup must be designed before publication.

See [scope and cutover gates](../../docs/design/YANDEX_FRONTEND_FOUNDATION.md).
