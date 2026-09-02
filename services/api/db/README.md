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

Migration `000024` adds application feedback as an isolated Yandex vertical
slice. The pilot session supplies the author UUID and account role; request
bodies cannot choose either value. `fit_api` can execute only the validated
insert command and cannot read or write the table directly. Human stage readers
see new messages through the curated `ops_readonly.app_feedback` view, without
profile names or user-agent data. Production feedback continues to use the
existing Supabase RPC until sticky tenant routing is implemented.

Migration `000025` ports Web Push state without enabling delivery. It stores one
browser subscription per actor, opt-out preferences for the two existing kinds
and a provider-neutral private outbox. The public API returns only subscription
presence and preference booleans; endpoint and Web Push keys are never returned
or exposed through `ops_readonly`. `fit_api` executes narrow actor-derived
functions and has no direct table access. The migration deliberately creates no
producer, scheduler, dispatcher or sender, so applying it cannot send a push.
Subscription enable/disable and the matching reminder preference update happen
atomically inside the database command.

Migration `000030` completes the Yandex delivery contract without `pg_net` or a
business trigger. Creating a trainer-authored plan explicitly enqueues the
`workout_scheduled` event in the same API transaction; a private timer runner
enqueues timezone-aware 09:00 reminders, leases at most 20 rows with
`SKIP LOCKED`, calls the existing Web Push sender and finalizes every result.
Leases recover after ten minutes, retries stop after ten attempts, expired
subscriptions are discarded and removed, and the outbox remains unavailable
through both direct `fit_api` grants and `ops_readonly`.

Migration `000026` ports durable Assistant conversations, messages and actions.
Only trainer actors can create or read their own history; user turns and model
responses are idempotent by `turn_id`, and action confirmation uses optimistic
versions. Record-workout, client draft, program draft and progress-summary
actions reuse the existing actor-scoped domain functions. The runtime exposes
history and confirmation endpoints behind the opaque pilot session, while the
production Assistant continues to use Supabase until sticky tenant routing is
enabled. Assistant content is intentionally absent from `ops_readonly`.

Migration `000027` adds the foundation for normal Yandex ID sessions without
switching production auth. A user who is already signed in through the existing
provider can link one app-scoped Yandex identity digest to their existing
profile. Linking is idempotent for the same pair, rejects subject/profile
collisions and does not create rollout access by itself. A separate opaque
read-write app session can be issued only when the linked profile already has
an enabled `yandex`/`read_write` rollout assignment. Provider OAuth tokens,
raw Yandex identifiers and the app session token are never stored; only SHA-256
digests are persisted.

Delivery is enabled only by the separately reviewed private dispatcher and
timer infrastructure. Applying the database migration alone cannot make an
outbound request. The sender function keeps the existing shared-secret
contract; provider errors are reduced to stable status codes so subscription
endpoints never reach responses, logs or outbox error text.

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

Human stage readers never receive either role. Migration `000013` creates the
`ops_readonly` schema with explicit security-definer views and a private,
owner-only grant/revoke function. The views omit profile/client names, goals,
membership notes, invitation hashes, workout notes and trainer comments. They
never expose `app_private`, push endpoints or Web Push key material. A direct
`fit_api` grant would allow actor-context impersonation and is prohibited.

The private migration runner exposes the access function only in stage. The
manual `Manage Yandex stage database access` GitHub workflow calls it with an
existing Managed PostgreSQL IAM username. Grant and revoke are idempotent,
remove earlier direct grants on `public` and `app_private`, and reject
administrative, `BYPASSRLS` and inherited `mdb_*` data roles. Adding or removing
a person therefore requires no migration. A future domain table still needs a
reviewed curated view in that table's normal migration; default privileges give
existing readers access to the new view automatically.

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
