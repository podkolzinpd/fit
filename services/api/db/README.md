# Managed PostgreSQL baseline

The API owns a separate migration chain for Yandex Managed PostgreSQL. It does
not replace or modify `supabase/migrations` while production still uses
Supabase.

The first migration recreates the `auth.uid()` contract on vanilla PostgreSQL.
The API sets an internal profile UUID through `set_config` inside an explicit
transaction. Provider subjects such as a Yandex ID `sub` must never be passed
directly as this actor UUID.

## Roles

- `fit_owner` owns the `fit` database and runs migrations only;
- `fit_api` is the non-owner runtime login used by Serverless Containers.

Both users are provisioned by Terraform with Connection Manager-generated
passwords. Keeping the runtime user separate from the database owner is
required for RLS to remain effective.

## Commands

- `npm run db:migrate:dry-run` prints pending SQL without applying it;
- `npm run db:migrate` applies pending migrations using `DATABASE_URL`;
- `npm run test:db` runs the actor-context integration test when
  `TEST_DATABASE_URL` points to local `fit_actor_test`.

The integration test deliberately refuses remote hosts and any other database
name. A disposable PostgreSQL 17 instance can be started with Podman:

```sh
podman run --rm --detach --name fit-actor-postgres \
  --publish 55432:5432 \
  --env POSTGRES_PASSWORD=postgres \
  --env POSTGRES_DB=fit_actor_test \
  docker.io/library/postgres:17

TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55432/fit_actor_test \
  npm run test:db

podman stop fit-actor-postgres
```

Do not run migrations automatically from each Serverless Container startup.
Run them once as a reviewed deployment step before switching traffic.
