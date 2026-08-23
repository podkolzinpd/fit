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
5. [Done in #487/#488 and verified on stage] Add Yandex ID token validation, identity
   mapping and the read-only profile vertical slice. The server-side rollout
   assignment is keyed by the internal profile UUID; a frontend flag is not an
   authorization or routing boundary.
6. [Done and verified on stage] Enroll synthetic/internal identities
   through the private migration runner and run the first allowlisted,
   read-only browser pilot. Supabase remains the only product write source
   during this gate.
7. [In progress] Port the current domain contract in the dependency order below.
   The first slice adds a short-lived hashed pilot session and the trainer's
   tenant-scoped read-only client list without unlocking the main application.
   The membership and invitation slices expose guarded read/write lifecycle
   commands without changing production routing. The current read-only workout
   slice adds custom exercises and the nested workout/exercise/set aggregate,
   including duration, distance and RPE, behind the same pilot session. Its
   stage gate loads deterministic synthetic rows through the private runner,
   issues a 15-minute smoke session and verifies the nested response through
   the deployed runtime role. The planned-workout write slice adds atomic
   create/update/soft-delete commands, optimistic versions and `created_by` /
   `updated_by` attribution without granting the runtime direct table writes.
   Its smoke verifies create, update, a stale-version conflict, delete and the
   final read model. The Live core slice ports start, set draft, set
   confirmation and finish with separate workout/set versions and a 30-day
   operation receipt: an exact retry returns the original version, while a new
   stale operation still conflicts. Repeated deploys do not duplicate fixtures,
   no production or Supabase data is read, and the token is not printed. The
   remaining scope includes Live structural editing, feedback/reactions and the
   derived progress/chronicle reads added after the foundation migrations.
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

The default-off browser pilot uses Authorization Code with PKCE. It sends the
one-time code and verifier to `POST /v1/auth/yandex/pilot`; the API exchanges the
code without a client secret and never returns or persists the Yandex token.
After every identity and rollout gate passes, the API returns a random
15-minute Fit session. PostgreSQL stores only its SHA-256 digest; disabling the
rollout assignment invalidates the session immediately. `GET /v1/clients`
resolves that session to the internal actor inside one transaction and returns
only the active client rows allowed by RLS. The raw session remains only in the
callback page memory and is neither persisted nor used to unlock the Supabase
application. Browser calls send it in `X-Fit-Pilot-Session`, because Yandex
Serverless Containers reserves the `Authorization` header for its own IAM
invocation token. The existing Yandex-token-protected `GET /v1/profile`
remains available for reviewed native or trusted clients.

The OAuth application and auth API revision are deployed on isolated stage.
The default-off frontend pilot can request a Yandex token and display only the
allowlisted read-only profile; it does not create a Supabase session or unlock
the main application. A stage-only administrative route on the private
migration runner validates a temporary Yandex token and creates the hashed
identity mapping plus read-only rollout assignment without storing email,
login, token or raw `psuid`. Browser invocation is public only at the API
transport layer; the exact CORS allowlist, verified Yandex identity, private
mapping and rollout assignment remain mandatory application gates.

## Current main parity impact

The private stage readiness gate applied foundation migrations `000001` through
`000003`. The auth/profile and session slices add
`000004_yandex_identity_rollout` and `000005_yandex_pilot_sessions`; the
read-only connections slice adds `000006_client_invitations_read_model`.
Product work merged after the foundation still expands the contract required
before a production tenant can be switched.

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

Stage delivery uses a single durable gate for every slice: GitHub OIDC issues a
short-lived deploy token, CI builds one immutable SHA image, the private
one-shot endpoint applies all pending expand-only migrations under an advisory
lock, and the API revision changes only after migration success. Connection
Manager supplies the separate owner/runtime passwords directly; application
database URL secrets are not recreated for each release. A failed API readiness
check restores the previous image, while migration history remains forward-only.
For the workout read model, the same gate also loads a bounded stage-only
synthetic fixture after migration and calls `/v1/training-data` with an
ephemeral session after the candidate revision is deployed. A failed nested
aggregate or RLS check follows the existing API rollback path.

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
