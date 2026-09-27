# Frontend release efficiency and retention

Approved scope, 27 September 2026. Stream: assistant-ops. Base main: `81853352`.
No application UI, auth, database, DNS, media bucket or Vercel changes.
Tracker connection is unavailable here; no ticket ID is invented.

## Accepted checklist

1. Загружать только новые или изменившиеся файлы, сравнивая контрольные суммы.
2. Неизменившиеся шрифты, картинки и WASM переиспользовать.
3. Для каждой версии сохранять полный список её файлов — это позволит безопасно переключаться и откатываться.
4. Новые файлы загружать параллельно.
5. Всегда сохранять текущий релиз и предыдущий для быстрого отката.
6. Остальные релизы хранить 3 дня (срок изменён по прямому решению пользователя).
7. Ежедневно удалять устаревшие релизы (частота изменена вместе со сроком).
8. Общие файлы удалять только тогда, когда на них больше не ссылается ни один сохраняемый релиз.

## Implementation and acceptance evidence

| Item | Observable contract | Automated evidence |
| --- | --- | --- |
| 1–2 | Verify previous object bytes; unchanged objects stay at their original immutable release key; only new bytes require PUT | Cross-commit test reuses 4/6 files; 2 PUTs, zero additional PUTs on retry; collision/access errors fail closed |
| 3 | Private `releases/<release>/release-manifest.json` records own routes/objects, creation date and previous gateway; read back before activation | Manifest write/readback and permission-failure tests; reserved filename rejected |
| 4 | At most six upload/read/metadata/smoke workers, drained before failure propagates | Bounded worker and in-flight drain test; existing upload checksum suite |
| 5–6 | Active and actual previous release pinned independent of age; other manifests retained for 3 days | Retention tests with months-old active/previous, recent release, exact cutoff and shared objects |
| 7–8 | Daily 03:17 UTC, same concurrency lock as deployment; preview exact deletion inventory; prune only expired compatibility routes before deleting unreferenced objects | Workflow, pagination, inventory, drift, partial-failure and zero-delete safety tests |

## Storage and rollout

Existing bucket and `releases/*` policy remain sufficient for publication.
No global public asset directory is introduced. All mapped objects retain
checksum/MIME/cache/CORS checks. The whole artifact is still built and validated;
only redundant remote PUTs are removed. SHA checks download old bytes, so reuse
does not mean zero GET requests or zero egress.

Before first scheduled apply, publish one manifest-aware release, run the
cleanup workflow in `plan` mode, inspect its artifact and verify resource-scoped
`s3:ListBucket` and `s3:DeleteObject` permissions. Do not grant folder editor/admin.
Then set `YC_FRONTEND_CLEANUP_ENABLED=true`; absent/false keeps scheduled runs off
and rejects manual apply. Manual plan is read-only. IAM and the kill switch are
not changed by repository code. The shared production environment is main-only;
its immutable OIDC subject is
`repo:podkolzinpd@3878475/fit@1307853602:environment:fit-frontend-production`.

Old releases without a manifest are not deleted merely because of their age.
The first modern manifest also protects the full pre-migration rollback graph;
later manifests can share files from that graph. Untracked failed/legacy uploads
require a separate reviewed inventory, not a wildcard cleanup. A standard DELETE
does not purge object versions. On 27 September, the console confirmed versioning
is enabled and there is no lifecycle configuration: noncurrent versions therefore
still consume storage. A separate operator rule is prepared but not saved:
`releases/` prefix, only `NoncurrentVersionExpiration`, 3 days after becoming
noncurrent; no current-object Expiration, no transitions. This gives deleted
releases a further 3-day recovery window before irreversible version removal.
Saving that rule requires explicit confirmation; no lifecycle setting is applied
by this PR. Semantics: [Object Storage lifecycles](https://yandex.cloud/ru/docs/storage/concepts/lifecycles).

## Failure and recovery

- Current/previous/recent references are protected even if stored under an old
  release prefix. No recursive prefix deletion and no version purge.
- All listing pages must be read; invalid manifests/inventory, missing protected
  objects or unknown active gateway routes stop cleanup before mutation.
- Save exact plan and gateway backup for 90 days. Same GitHub concurrency lock
  serializes publication/cleanup. Out-of-band operator writes must not overlap.
- Recheck gateway status/spec before each deletion batch and each object's
  ETag/size/time before delete. Any error stops further batches; successful
  deletion is checked by an exact-key list query. Already deleted expired
  objects may remain absent on retry; pinned objects may not.
- Prune obsolete hashed routes before removing backing objects. Do not roll
  back to a pruned gateway after deletions. Current/previous own assets survive;
  90-day artifacts do not extend the 3-day retention of expired releases.
- Old tabs are supported for the retention window, not indefinitely. Beyond it,
  the existing missing-JS recovery remains the fallback.

Remote enablement, actual timing reduction and first cleanup dry-run are pending
until this branch passes CI and is deployed; local tests are not production proof.

Local verification: full `npm run check` passed (2,053 frontend tests, 943 API
tests; 49 environment-dependent API tests skipped by the existing suite).
Hosting HTTP/retention tests pass with localhost access enabled; sandbox-only
HTTP tests cannot bind a port (`EPERM`) and were rerun outside that restriction.
No database schema or UI changes; DB reset and new visual snapshots are not
applicable. Browser/device OAuth was not retested as part of this hosting change.
