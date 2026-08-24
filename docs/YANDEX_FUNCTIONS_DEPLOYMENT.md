# Production Yandex Cloud Functions deployment

This runbook covers `fit-parse-workout` and
`fit-summarize-client-training`. Both functions execute in Yandex Cloud but
still use Supabase Auth and data during the migration window.

## One-time IAM bootstrap

The folder administrator must grant the GitHub OIDC deploy service account
`functions.editor` in the production Functions folder. The public
`serverless.functions.invoker` binding is also created once by the folder
administrator. Workflows deliberately do not rewrite that binding on every
release.

Runtime service accounts keep only their model invocation and Lockbox payload
viewer roles. GitHub uses a short-lived OIDC IAM token; no authorized-key JSON
is required by either workflow.

## Automatic release contract

Every function workflow:

1. builds and tests the Node package;
2. records the version currently tagged `$latest`;
3. creates the candidate version, which Yandex tags `$latest` automatically;
4. verifies that `$latest` is the expected `ACTIVE` candidate;
5. retries a public unauthenticated request and requires HTTP `401` from the
   application authentication gate;
6. restores `$latest` to the previous active version if metadata or smoke
   verification fails.

The smoke deliberately sends no user token or application data. It proves that
the new package starts, the public invocation bootstrap still exists, and the
authentication boundary rejects anonymous traffic. Authenticated domain smoke
remains a separate release gate until a dedicated non-production identity is
available.

The rollback uses the documented Yandex Functions version tag operation:

```sh
yc serverless function version set-tag \
  --id '<previous-version-id>' \
  --folder-id '<production-folder-id>' \
  --tag '$latest'
```

If the function has no previous version, a failed first release stops without
claiming that rollback succeeded. A rollback failure is reported separately
and requires the folder administrator to restore a known active version.

## Verification after merge

Both workflows must finish green:

- `Deploy production Yandex workout parser`;
- `Deploy production Yandex summary function`.

An HTTP `401` without a token is expected. `403` indicates that the one-time
public invoker bootstrap is missing. `5xx`, a non-`ACTIVE` version, or a
different `$latest` version fails the release and triggers rollback.
