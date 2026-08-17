# Fit V2: migration to Yandex Cloud

## User result

Fit stores application data in Managed PostgreSQL in the Yandex Cloud Russia
region and authenticates web and iOS users through Yandex ID, while preserving
the existing trainer/client product contract.

## Compatibility boundary

The current production path remains unchanged until the replacement backend
passes the complete parity and migration rehearsal gates:

```text
route/page -> feature UI/hooks -> repository -> query -> Supabase Data API/RPC
```

The replacement API is introduced as an isolated service. Production must not
mix Supabase and Yandex Cloud writes and must not use dual-write. The frontend
switches to the replacement backend only after a read-only migration window.

The following remain unchanged during the foundation phase:

- the existing `src/` dependency direction and domain DTOs;
- the `supabase/` migrations, RLS tests, Edge Functions, Auth, RPC and Realtime;
- the Vercel production configuration;
- the web and Capacitor iOS user flows;
- YandexGPT prompts, matching, fallbacks and saved workout data.

## Delivery sequence

1. [Done in #369] Add the isolated API process, container image and health
   checks.
2. [Done in #370] Describe Yandex Cloud resources in Terraform without applying
   production.
3. [Done in #371] Add a reproducible Managed PostgreSQL baseline and actor
   context.
4. [Done in #411] Validate the minimum stage deployment before porting the
   remaining domain: remote state, service-network access to private
   PostgreSQL, reviewed migrations and database readiness checks. Profiles,
   trainers, clients and read-only trainer memberships are already ported.
5. [Implemented, deployment pending] Add Yandex ID token validation, identity
   mapping and the read-only profile vertical slice. The server-side rollout
   assignment is keyed by the internal profile UUID; a frontend flag is not an
   authorization or routing boundary.
6. Run the first allowlisted pilot with synthetic/internal accounts and
   read-only behavior. Supabase remains the only write source during this gate.
7. Port the current domain contract in the dependency order below. The scope
   now includes timezone, optimistic concurrency, actor attribution, running
   metrics, feedback/reactions and the derived progress/chronicle reads added
   after the foundation migrations.
8. Rehearse full tenant migration at least twice. Cut over one isolated tenant
   cohort only after all data it can mutate is migrated and writes are frozen
   for the cutover window.
9. Expand sticky tenant cohorts gradually after monitoring data integrity,
   authorization failures, latency and error rates.
10. Remove Supabase only after all cohorts are migrated and the rollback window
    closes.

## Rollout decision

Yandex Cloud rollout is controlled by the application after Yandex ID has been
validated and mapped to an internal profile UUID. Client-provided headers,
query parameters, email addresses and raw Yandex ID subjects never select a
backend.

```text
validated Yandex ID -> internal profile UUID -> tenant rollout assignment
                                            -> Supabase or Yandex API
```

The assignment is evaluated server-side and is sticky. Serverless Container
revision activation applies to all requests, while API Gateway percentage
canaries are random request routing; neither is the source of truth for a
specific-user pilot.

The safe migration unit is a tenant cohort, not always one account. A trainer,
linked client profiles and their shared memberships/workouts must not be split
between writable backends. An individual account can be moved alone only when
its mutable data has no cross-account ownership or relationship dependency.

No domain entity is dual-written. Before a cohort cutover, Supabase remains its
only write source. During cutover, writes for the cohort are paused, its full
required dataset is copied and verified, and then the assignment changes once
to Yandex Cloud. After that point Yandex Cloud is the only write source for the
cohort.

A flag is an instant rollback only before the first Yandex Cloud write or for a
read-only pilot. After writes begin, switching a cohort back to Supabase would
lose or fork new data; rollback then requires a maintenance window and a
reviewed reverse migration. Every cohort expansion therefore records a data
checkpoint and an explicit forward-fix or reverse-migration decision.

Rollout gates:

1. synthetic and internal accounts on isolated stage;
2. allowlisted read-only auth/profile pilot;
3. complete tenant migration rehearsal with production-like data;
4. one small production tenant cohort;
5. gradual cohort expansion;
6. final read-only window and global cutover.

## Yandex ID profile slice

`GET /v1/profile` accepts a Yandex OAuth token as a bearer credential. The API
forwards it only in the `Authorization: OAuth` header to the official Yandex ID
userinfo endpoint, requires the returned `client_id` to match the configured
OAuth application and derives identity only from the app-specific `psuid`.
Tokens, login, email, global Yandex user ID and raw `psuid` are never persisted.

The API stores only a SHA-256 digest of `psuid`. Inside one database transaction
it resolves that digest through the private identity map, requires an enabled
`yandex`/`read_only` rollout assignment, installs the resulting internal profile
UUID as actor context and lets profile RLS perform the final read check.

Endpoint outcomes are deliberately distinct:

- `401` for a missing, malformed, invalid or wrong-application token;
- `403` for a valid Yandex identity outside the server-side pilot allowlist;
- `503` when Yandex ID, application auth configuration or PostgreSQL is
  unavailable;
- `200` with the own profile and explicit `read_only` access mode after every
  gate passes.

This slice does not register an OAuth application, populate real identity
mappings, enable public container invocation, add frontend routing or deploy a
new revision. Those are reviewed stage operations after the code is merged.

## Current main parity impact

The private stage readiness gate applied foundation migrations `000001` through
`000003`. The auth/profile slice adds `000004_yandex_identity_rollout`; product
work merged after the foundation still expands the contract required before a
production tenant can be switched.

Port the current `main` behavior in this order:

1. identity/profile mapping, roles and IANA timezone;
2. clients, trainer memberships and invitation lifecycle;
3. exercises, workouts, workout exercises and sets, including running
   duration/distance fields;
4. versioned aggregate mutations, transaction-local actor context and
   `updated_by` attribution;
5. live-workout conflict, retry and ambiguous-network-result semantics;
6. client progress and goals;
7. post-workout feedback plus trainer reaction/response ownership;
8. role-safe regularity, confirmed-only exercise progress/PR and paginated
   workout chronicle;
9. client-overview activity analytics and realtime invalidation/refetch;
10. goal-aware training summary and the remaining Edge Function behavior.

Each item is a separate vertical slice: PostgreSQL migration, grants/RLS and
cross-tenant tests, API transaction/DTO, repository adapter and observable
parity acceptance. Supabase migration files are evidence for the current
contract, not scripts to copy into the replacement chain.

A production pilot cannot start after only profiles and memberships have been
ported. Every mutable and shared domain reachable by that tenant cohort must
either be fully served by Yandex Cloud or remain unavailable during a declared
read-only pilot.

## Actor context decision

Yandex ID provider subjects are not business entity identifiers and are never
written into tenant columns or passed directly to PostgreSQL RLS:

```text
Yandex ID sub -> identity mapping -> internal profile UUID
                                    -> transaction-local actor context
                                    -> auth.uid() compatibility function
```

The API sets `request.jwt.claim.sub` only with the internal UUID, after opening
an explicit database transaction. `COMMIT` or `ROLLBACK` clears the setting
before a pooled connection can be reused. The migration owner and API runtime
are separate PostgreSQL users so the runtime does not bypass RLS as table owner.

## Foundation acceptance

- `services/api` builds and its health test passes independently.
- The root quality gate also validates the API package.
- The API container listens on the `PORT` environment variable required by
  Serverless Containers.
- No frontend import, query or production environment variable changes.
- No database, authentication or paid cloud resource is created by this step.
