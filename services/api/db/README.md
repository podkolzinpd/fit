# Managed PostgreSQL baseline

The API owns a separate migration chain for Yandex Managed PostgreSQL. It does
not replace or modify `supabase/migrations` while production still uses
Supabase.

The first migration recreates the `auth.uid()` contract on vanilla PostgreSQL.
The second migration ports the provider-independent `profiles` and `trainers`
contract, including least-privilege grants and actor-scoped RLS. The API sets
an internal profile UUID through `set_config` inside an explicit transaction.
Provider subjects such as a Yandex ID `sub` must never be passed directly as
this actor UUID.

The third migration adds client cards and trainer memberships. A client owner,
the partition owner and connected trainers can read the card, while an
unrelated actor cannot.

The fourth migration adds the Yandex ID identity map and the server-side
read-only pilot assignment. It stores only a SHA-256 digest of the app-specific
Yandex `psuid`; raw provider IDs, login, email and OAuth tokens are not stored.
The runtime can resolve an internal profile UUID only when both the identity
mapping and an enabled `yandex`/`read_only` assignment exist. The resulting UUID
is then installed as transaction-local actor context before profile RLS runs.

The sixth migration adds the creator-scoped invitation read model. The seventh
adds five narrow security-definer commands for create, claim, revoke, remove
and leave. Direct runtime writes remain revoked. Invitation codes are returned
once, stored only as SHA-256, expire after seven days and are claimed under a
row lock. Root memberships and archived clients are protected by the database,
not only by the browser UI.

The eighth migration adds the read-only custom exercise and workout aggregate
baseline. Workout exercises and sets use composite foreign keys so aggregate
children cannot cross a trainer/client partition. RLS preserves author-scoped
visibility: a client reads its own workouts, connected trainers read their own
assignments plus completed client-authored history, and unrelated actors read
nothing. Runtime insert, update and delete grants remain closed.

Stage delivery uses the private migration runner to load one deterministic,
synthetic workout fixture for each enabled read-only trainer plus an isolated
smoke actor. This route is disabled outside `APP_ENV=stage`, accepts no user
data and is unreachable without the runner IAM binding. Repeated delivery does
not duplicate domain rows. It returns one 15-minute session only to the current
CI job; CI keeps the response file private and verifies the nested aggregate
through the public runtime API and its `fit_api` RLS role before accepting the
new revision.

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
name. The repository-level `npm run dev` and `npm run local:prepare` commands
start a persistent local PostgreSQL 17 container through Podman and apply only
pending migrations automatically. No Yandex Cloud database is contacted.

For an isolated disposable test instance, use:

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
