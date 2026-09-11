# Yandex tenant migration tooling

## Accepted outcome

Prepare a repeatable, auditable data copy for one isolated trainer cohort before
any production rollout. The tool must not change routing, deploy resources or
write to a remote database by default.

The same runner must also copy an unlinked client account as an independent
root. It must preserve the client's personal domain history and disconnected
relationship/chat history without creating a trainer role or an active
`client_trainers` membership.

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

For `dry-run` and `apply`, GitHub OIDC obtains the existing bounded deploy
identity and invokes the private `fit-stage-migration` container. The encrypted
envelope and a random one-run passphrase exist only in memory; the workflow
does not upload an artifact. The runner accepts at most 3 MiB, exposes neither
row contents nor identifiers, and is registered only when
`APP_ENV=stage`. Dry-run rolls back after full import validation. Apply requires
the independent `APPLY_TENANT_TO_YANDEX_STAGE` confirmation and immediately
repeats the import, requiring zero inserted rows.

This stage workflow still does not change routing or provision a rollout
assignment. It adds no always-on resource: only the invoked execution time of
the existing cold migration container is billable.

## Manifest v1

The manifest covers profiles/trainers/clients and memberships, invitations and
relationship history, merge receipts, exercises, the complete workout
aggregate, progress/custom metrics, goals/stages/criteria, generated and
published summaries, Assistant conversations/messages/actions, application
feedback, push subscription/preferences and workout idempotency receipts.
Target-only push outbox and Live operation receipts must be empty for the
cohort; they are validated as explicit zero-row manifest entries.

`client_private_details.note` is normalized into the Yandex
`client_trainers.note` field. Source-only Tracker/Telegram delivery metadata is
not application-domain data and is not copied. Sent push outbox history is not
copied; any unsent cohort notification blocks export so a message cannot be
delivered twice. Identity mappings, app sessions and rollout assignments are
provisioned separately and are deliberately absent from the artifact.

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
retaining the same ordered 30-table manifest. Client-scoped tables follow the
canonical card and its reverse merge closure. Custom exercises include both
client-authored rows and exact custom rows referenced by those workouts.
Account-scoped Assistant, feedback, push preferences/subscriptions and workout
request receipts are limited to the client root; referenced trainer accounts
never pull their unrelated account data into the bundle.

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
- [ ] Run one real unlinked client through remote stage dry-run and pinned apply
  before enabling that profile's Yandex ID session or sticky routing.
- [ ] Freeze writes, validate the selected real cohort and change its sticky
  routing only in the separately approved cutover step.

The local rehearsals exercise a clean PostgreSQL 17 migration chain and the
complete data contract. They deliberately do not prove VPC/IAM connectivity,
remote TLS credentials, production volume or cutover timing; those remain part
of the separately reviewed remote gate.
