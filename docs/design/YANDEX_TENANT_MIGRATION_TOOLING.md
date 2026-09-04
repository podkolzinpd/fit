# Yandex tenant migration tooling

## Accepted outcome

Prepare a repeatable, auditable data copy for one isolated trainer cohort before
any production rollout. The tool must not change routing, deploy resources or
write to a remote database by default.

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
   checksum for every manifest table.
9. Remote source or target access requires both `--allow-remote` and the exact
   remote confirmation environment value. A remote apply has a second,
   independent confirmation.
10. This tooling does not implement dual-write, reverse migration, routing or
    production cutover. Those remain separate reviewed gates.

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

Yandex migration `000029_tenant_migration_parity.sql` preserves the V1
`workouts.stage_id` goal-stage binding and `client_progress.updated_by` audit
field. The exporter derives Yandex-required creator/fingerprint fields only
where the V1 schema did not persist them directly.
Migration `000034_client_custom_exercise_self_service.sql` additionally
preserves `custom_exercises.created_by`: client-authored exercises keep their
author and root data partition instead of being silently converted into
trainer-owned rows.

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
  synthetic data (`npm run tenant:rehearse:local`, 2026-09-04): each clean
  target imported and validated 35 rows across all 28 manifest tables, the
  dry-run left the target empty and the repeated apply inserted zero rows.
- [ ] Review a production export window, remote credentials and the exact
  target before the first remote command.
- [ ] Freeze writes, validate the selected real cohort and change its sticky
  routing only in the separately approved cutover step.

The local rehearsals exercise a clean PostgreSQL 17 migration chain and the
complete data contract. They deliberately do not prove VPC/IAM connectivity,
remote TLS credentials, production volume or cutover timing; those remain part
of the separately reviewed remote gate.
