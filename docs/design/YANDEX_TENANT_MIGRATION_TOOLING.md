# Yandex tenant migration tooling

## Accepted outcome

Prepare a repeatable, auditable data copy for one isolated trainer cohort before
any production rollout. The tool must not change routing, deploy resources or
write to a remote database by default.

The same runner must also copy an unlinked client account as an independent
root. It must preserve the client's personal domain history and disconnected
relationship/chat history without creating a trainer role or an active
`client_trainers` membership.

When real data cannot be partitioned safely because memberships or completed
client merges cross trainer boundaries, the same runner can export the complete
application cohort as one snapshot. This mode is intentionally broader: it
copies every row covered by the application manifest instead of weakening the
isolated-tenant checks or silently dropping a merge target.

## Safety contract

1. A trainer, all root client cards and their linked FIT profiles form one
   migration unit.
2. Export runs in one `REPEATABLE READ READ ONLY` transaction.
3. Export is rejected when the cohort has another trainer membership or
   relationship, a merge crossing the cohort boundary, a foreign actor
   reference, a missing root membership or an unsent push notification.
4. The artifact is encrypted with AES-256-GCM. Its scrypt passphrase and both
   database credentials come only from environment variables. The file is
   created with mode `0600` and is never overwritten.
5. Logs contain table names, row counts and a one-way tenant fingerprint only.
   They never print the trainer UUID, profile UUIDs or row contents.
6. Import is `SERIALIZABLE`, tenant-locked and transactional. Without
   `--apply` it always rolls back after inserting and validating every table.
7. Import is idempotent by primary key and never overwrites an existing row.
   A conflicting or changed target row fails checksum validation and rolls the
   whole import back.
8. Validation compares the complete scoped row count and deterministic SHA-256
   checksum for every manifest table. Export, import and validation transactions
   normalize their PostgreSQL session timezone to UTC so identical `timestamptz`
   values remain byte-stable across Supabase and Yandex cluster defaults.
9. Remote source or target access requires both `--allow-remote` and the exact
   remote confirmation environment value. A remote apply has a second,
   independent confirmation.
10. This tooling does not implement dual-write, reverse migration, routing or
    production cutover. Those remain separate reviewed gates.
11. A standalone client root is accepted only for a client-role profile whose
    canonical card is self-owned (`clients.trainer_id = profiles.id`) and has
    neither a current membership nor an active relationship. Profile-only
    client accounts are valid migration roots.
12. Historical actor references are copied as FK dependencies, including the
    minimal referenced trainer profile/row. They do not grant that trainer
    access: disconnected relationships stay disconnected and the membership
    table must remain empty for the standalone root.
13. Standalone export includes the reverse merge closure of the canonical card
    and rejects a merge that crosses that boundary. It also rejects pending
    push delivery. A chat containing image metadata is rejected until the
    corresponding private object-storage copy is implemented, so the target
    cannot contain a broken attachment link.
14. `full-cohort` keeps the strict isolated modes unchanged, but does not apply
    trainer-boundary checks because every manifest row is copied together. Its
    transient push outbox is not application data and is excluded. By default,
    the target runner verifies every referenced private Yandex Object Storage
    object before opening a database connection. An explicit default-off
    `allow_missing_media` operator policy may defer only object existence
    validation while preserving the original paths and media metadata.
15. The full-cohort fingerprint is derived from every table name, row count and
    checksum. A pinned apply requires the exact snapshot fingerprint from a
    successful dry-run; current-snapshot apply uses one repeatable-read export
    for dry-run and both replacement passes.
16. Full-cohort target import takes exclusive locks, preserves Yandex identity,
    app/pilot sessions and rollout assignments for profiles present in the
    source snapshot in transaction-local tables, clears all transferable
    tables, loads the snapshot and restores those anchors. Linked anchors for
    profiles absent from the source snapshot are pruned. Validation reads the
    complete target tables, so changed and stale rows cannot survive. A native
    Yandex identity rejects the operation before the first delete.
17. Media migration is a separate idempotent gate. It copies the two private
    source buckets to namespace-isolated keys in one private, versioned Yandex
    bucket and verifies source SHA-256 metadata plus byte length. Reports expose
    only aggregate counts, bytes and a content fingerprint. Neither object paths
    nor payloads are logged or uploaded as workflow artifacts.

## Remote stage orchestration

The manually dispatched `Rehearse Yandex tenant migration` workflow removes
the need to copy credentials or run migration commands on an operator laptop.
The selected trainer UUID is a masked repository secret rather
than a visible workflow input. The source step resolves the reviewed Supabase
session pooler and performs the same read-only export. TLS hostname and chain
verification use the reviewed public Supabase Root 2021 CA committed at
`services/api/certs/supabase-prod-ca-2021.crt`; certificate verification is
never disabled. No Yandex identity or target credential is needed in `audit`
mode.

Audit and dry-run may use `smallest-eligible` selection when an operator has
not supplied a suitable trainer UUID. The source query orders trainer cohorts
by client count and tries them in that order; every candidate still passes the
same isolation, actor, merge and pending-push preflight before any table is
exported. During dry-run, an eligible candidate whose existing stage rows have
a different checksum is rolled back and skipped; the next candidate is tried,
up to 100 conflicts. This bound covers the current small source population
without turning a stale stage into an unbounded sequence of remote requests.
Import, schema, network and authorization errors are not treated as collisions
and still fail the rehearsal. Candidate UUIDs and rejected candidates are not
logged. A `smallest-eligible` apply is allowed only with the independent apply
phrase and the exact 16-character fingerprint printed by its successful
dry-run. The same deterministic selection runs again and aborts before any
target request if the selected cohort no longer has that fingerprint. If every
candidate conflicts, CI prints the complete aggregate of safe
rejection codes (for example, the exact validation table) and counts, without
UUIDs or row contents. This pins a real write to the reviewed cohort without
exposing its UUID.

`smallest-eligible-standalone-client` performs the equivalent masked selection
for client-role profiles. It may choose a profile that has not created a card
yet, or a self-owned card with personal history, and skips profiles that still
have an active trainer, a legacy trainer-owned partition, a cross-boundary
merge, pending push or chat media. Dry-run/apply use the same fingerprint pin
and conflict-skipping behavior as trainer cohorts, so repeated manual runs can
advance through the small population without adding one secret per client.

`most-complete-standalone-client` is used for a representative real-data
rehearsal. It considers only standalone client accounts that own a client card
and at least one workout, tries candidates with the most workouts first, and
still runs the complete standalone safety preflight. Output remains limited to
the masked fingerprint and aggregate table counts.

`full-cohort` performs one complete application snapshot without requiring
`FIT_TENANT_TRAINER_ID`. It is the safe fallback for the current small source
population when a client merge or membership crosses an isolated trainer
boundary. It never skips candidates: audit and dry-run must cover the same full
manifest, and apply requires both the normal apply phrase and the exact
content-derived fingerprint from that dry-run.

By default, before a full-cohort dry-run or apply containing chat photos, the
manual `Migrate Yandex media` workflow must finish in `apply` mode with
`objects == verified`. It recursively reads `chat-media` and
`fit-exercise-media`, preserves their paths under separate target prefixes and
is safe to repeat. The migration runner then HEAD-checks every chat object and
its exact recorded byte length before it obtains a PostgreSQL connection. A
missing, inaccessible or mismatched object rejects the complete database run.

When the product owner explicitly accepts temporarily broken media reads, the
manual rehearsal workflow may set `allow_missing_media=true` for both dry-run
and pinned apply. The private request carries the exact `allow-missing` policy;
unknown policy values are rejected. The runner still parses and validates media
metadata, but skips target object existence checks. Original paths remain in
the database, so a later idempotent media apply restores those reads without a
second database import. The API uses the same private bucket for new chat
uploads and exercise-media signed links after the storage-backed revision is
deployed.

The full snapshot deliberately ignores the source push outbox in every delivery
state. It is transient transport state, not application-domain data; Supabase
continues to dispatch it while production routing remains on Supabase. Before
the eventual final cutover, writes are frozen, the source dispatcher gets a
bounded drain window and is then disabled so old notifications cannot be sent
after Yandex becomes authoritative. Isolated trainer/client exports remain
strict and still reject unsent notifications inside their boundary.

For `dry-run` and `apply`, GitHub OIDC obtains the existing bounded deploy
identity and invokes the private `fit-stage-migration` container. The encrypted
envelope and a random one-run passphrase exist only in memory; the workflow
does not upload an artifact. Envelope v3 Brotli-compresses the canonical JSON
before AES-256-GCM encryption and keeps v1/v2 decryption support for existing
local gzip artifacts. Remote v3 transport sends the ciphertext as a raw binary
body and puts only bounded format, salt, IV and authentication-tag metadata in
headers. Removing Base64/JSON wire overhead preserves the single-request,
single-transaction import for the complete cohort instead of creating partially
staged batches. The runner accepts at most 3,400,000 binary body bytes, leaving
room for headers under the immutable 3.5 MB platform request limit, caps
decompressed data at 64 MiB, exposes neither row contents nor identifiers, and
is registered only when `APP_ENV=stage`. Dry-run rolls back after full import
validation. Apply requires the independent `APPLY_TENANT_TO_YANDEX_STAGE`
confirmation and immediately repeats the import, requiring zero inserted rows.

This stage workflow still does not change routing or provision a rollout
assignment. It adds no always-on resource: only the invoked execution time of
the existing cold migration container is billable.

## Manifest v1

The manifest covers profiles/trainers/clients and memberships, invitations and
relationship history, merge receipts, exercises, the complete workout
aggregate, progress/custom metrics, goals/stages/criteria, generated and
published summaries, trainer professional profiles, Assistant
conversations/messages/actions, application
feedback, push subscription/preferences and workout idempotency receipts.
Target-only push outbox and Live operation receipts must be empty for the
cohort; they are validated as explicit zero-row manifest entries.

`client_private_details.note` is normalized into the Yandex
`client_trainers.note` field. Source-only Tracker/Telegram delivery metadata is
not application-domain data and is not copied. Push outbox history is never
copied. Unsent notifications block isolated trainer/client exports; a complete
application snapshot excludes the whole source outbox because it stays active
only on Supabase until the final drain-and-disable cutover step. Identity
mappings, app sessions and rollout assignments are provisioned separately and
are deliberately absent from the artifact.

Push subscriptions use their subscription `id` as the import key on both
backends. The production-like fixture contains two endpoints for one user, so
the rehearsal fails before rollout if either schema regresses to the former
one-device-per-user contract.

Yandex migration `000029_tenant_migration_parity.sql` preserves the V1
`workouts.stage_id` goal-stage binding and `client_progress.updated_by` audit
field. The exporter derives Yandex-required creator/fingerprint fields only
where the V1 schema did not persist them directly.
Migration `000035_client_custom_exercise_self_service.sql` additionally
preserves `custom_exercises.created_by`: client-authored exercises keep their
author and root data partition instead of being silently converted into
trainer-owned rows.

Standalone artifacts use the distinct
`fit-standalone-client-bundle-v1` format and fingerprint namespace while
retaining the same ordered 35-table manifest. Client-scoped tables follow the
canonical card and its reverse merge closure. Custom exercises include both
client-authored rows and exact custom rows referenced by those workouts.
Account-scoped Assistant, feedback, push preferences/subscriptions and workout
request receipts are limited to the client root; referenced trainer accounts
never pull their unrelated account data into the bundle.

Full application snapshots use `fit-full-cohort-bundle-v1`. Identity mappings,
hashed app sessions, rollout assignments, sent push outbox history and Live
operation receipts remain outside this format. The format copies application
profiles, not Supabase `auth.users`, passwords or provider credentials.
Legal acceptance history and account deletion requests are transferable
application data and are included in the manifest.

## Acceptance checklist

- [x] Encrypted artifact does not contain plaintext tenant UUIDs.
- [x] Dry-run executes all inserts and validations, then leaves the target
  unchanged.
- [x] Apply copies the synthetic cohort across all 28 manifest tables.
- [x] Repeating apply inserts zero rows and validates successfully.
- [x] A changed target row is detected by validation.
- [x] Source and target remain local Podman PostgreSQL instances during the
  implementation check.
- [x] Run two complete local rehearsals with production-like, non-production
  synthetic data (`npm run tenant:rehearse:local`, 2026-09-09): each clean
  target imported and validated 36 rows across all 28 manifest tables,
  including two subscriptions for one user; the
  dry-run left the target empty and the repeated apply inserted zero rows. The
  target fixture deliberately uses `Europe/Moscow` while migration transactions
  normalize to UTC, covering cross-cluster timestamp checksums.
- [x] Review a production export window, remote credentials and the exact
  target before the first remote command.
- [x] Run a selected real cohort through target `dry-run` and fingerprint-pinned
  `apply` using the private stage workflow. Run `34589510827` (2026-09-11)
  validated all 30 current manifest tables, inserted 5 rows and proved
  idempotency with a second apply inserting zero rows.
- [x] Add a standalone-client artifact, CLI selector and masked remote selector.
  Two local PostgreSQL 17 rehearsals (2026-09-11) each imported and validated
  a 22-row self-owned client bundle across all 30 tables, preserved a
  disconnected relationship/chat and foreign historical actor references,
  left `client_trainers` empty, rolled dry-run back and inserted zero rows on
  repeated apply. The same runs revalidated the trainer bundle at 38 rows and
  added chat rows to the production-like manifest fixture.
- [x] Add a content-pinned full-cohort artifact and manual workflow selector.
  Two local PostgreSQL 17 rehearsals (2026-09-14) each exported 61 synthetic
  rows across all 32 manifest tables, rolled dry-run back, applied the complete
  snapshot, proved a repeated apply inserted zero rows and validated the final
  checksums. The same runs revalidated isolated trainer and standalone-client
  modes; trainer professional profiles are now included in every applicable
  manifest.
- [x] Run the real full-cohort source `audit`. The 2026-09-14 run exported all
  32 tables and 12 876 rows with a content-derived fingerprint; no source
  contract or table-parity mismatch remained.
- [x] Replace full-cohort insert-only import with an atomic 35-table rebuild,
  preserve current-snapshot Yandex auth/session/rollout anchors, prune stale
  linked anchors and reject native-only target profiles before deletion. Local
  PostgreSQL 17 rehearsal on 2026-09-19 applies, repeats and validates 88
  synthetic rows across the then-current 34 tables while removing an extra
  stale profile;
  the 2026-09-19 rerun after adding `favorite_workouts` validated 69 full-cohort
  rows twice with the same checksum.
- [x] Repeat the real full-cohort stage `dry-run` with compressed envelope v3.
  Run `35466016700` exported and transactionally validated all 16,192 rows
  across the 35-table manifest, then rolled the target transaction back.
- [ ] Use the exact reviewed fingerprint for pinned `apply` and repeat the
  full-cohort rebuild to confirm the same final checksum.
- [ ] Run one real unlinked client through remote stage dry-run and pinned apply
  before enabling that profile's Yandex ID session or sticky routing.
- [ ] Freeze writes, validate the selected real cohort and change its sticky
  routing only in the separately approved cutover step.

The local rehearsals exercise a clean PostgreSQL 17 migration chain and the
complete data contract. They deliberately do not prove VPC/IAM connectivity,
remote TLS credentials, production volume or cutover timing; those remain part
of the separately reviewed remote gate.
