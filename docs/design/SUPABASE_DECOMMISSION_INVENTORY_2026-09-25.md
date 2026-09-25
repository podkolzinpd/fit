# Supabase decommission inventory — 2026-09-25

This is a code and deployment-contract inventory against `main` at `c41224ab`,
not proof that an external service has already been disabled. The production
frontend uses Yandex ID and Yandex main routing, while the old source is held by
the paused write gate. Do not interpret the remaining Supabase adapter as a
per-request fallback or delete the source project while these dependencies exist.

| Area | Current dependency | Closure condition |
| --- | --- | --- |
| Browser runtime | `src/app/data-backend-context.tsx` still contains the Supabase adapter for local/Preview and isolated tests. Yandex-only sessions fail closed when the Yandex session is unavailable. `src/data/queries/client.ts` still defines the legacy SDK. | Prove production Yandex-only flows without the browser Supabase environment, then replace local/Preview test composition before removing the adapter and SDK. Check the actual Vercel Production environment separately; code does not prove which variables remain there. |
| Existing-account recovery and linking | `services/api/src/server.ts` wires `SupabaseExistingCredentialsProvider` and `SupabaseExistingActorProvider`; `/v1/auth/yandex/recover` verifies old credentials through Supabase, and `/v1/auth/yandex/link` accepts an old Supabase session. | Decide and test a safe path for still-unlinked existing users. Retire the old endpoints only after the user matrix and recovery window are complete; do not strand those accounts. |
| Media | The API still wires `LegacyChatMediaBridge`, `SupabaseChatMediaStore` and a `SupabaseVitalMediaSigner` fallback. Chat and custom-exercise media are not fully validated on Yandex; custom-exercise photo write support is missing. | Migrate/validate remaining objects without `allow-missing`, implement and smoke the Yandex custom-photo path, then remove the Supabase media bridge and fallback. Vital Gym Pro copies are verified, but this does not close chat/custom objects. |
| Legacy AI and push | `deploy-yandex-workout-parser.yml`, `deploy-yandex-summary-function.yml` and `deploy-yandex-assistant-orchestrator.yml` still mount Supabase credentials. `deploy-yandex-push-function.yml` syncs transport into Supabase Vault. Supabase Edge Function sources remain in the repository. | Verify Yandex-only parser/summary/assistant/push end to end, establish which legacy endpoints still receive traffic, then retire their deployments, Vault sync and secrets. Do not infer zero callers from the Yandex-only browser route alone. |
| Source data and deployments | The Supabase write gate is paused, not a completed archival. `deploy-database.yml` still automatically applies Supabase migrations from `main`; stage deployment mirrors bridge credentials into Lockbox. Tenant export/rehearsal still reads the old source. | Complete media, backup restore and observation gates. Preserve a recoverable source snapshot, stop source migrations and credential mirroring when no runtime path needs them, then disable remote Auth/Data API/Storage/Edge Functions. |
| Local development and CI | `AGENTS.md`, `scripts/run-local-stack.mjs` and `.github/workflows/ci.yml` still use local Supabase for dev, database tests and browser E2E. CI separately runs a clean Yandex PostgreSQL migration chain. | Replace Supabase-dependent fixtures and E2E with local Yandex API/PostgreSQL coverage before removing the SDK, migrations and Supabase CLI from the development contract. Do not connect local tests to production. |

## First reversible step in this change

Stop automatic `main` deployments of the two legacy **Supabase Edge Functions**
(`parse-workout` and `summarize-client-training`), retaining
`workflow_dispatch` for an explicit compatibility release. Existing deployed
versions, Supabase data, recovery, stage/Yandex deployments and automatic
Supabase database migrations are unchanged. This reduces accidental legacy
releases; it does **not** establish that Supabase can be shut down yet.

## Gate before final removal

The remaining media must validate without `allow-missing`; authenticated
trainer/client, recovery, invite, Assistant and push smoke must pass; a Yandex
backup restore must be tested; and the observation window must close. Once
Yandex has accepted production writes, turning off a frontend flag is not a
database rollback. Keep the old source recoverable until a separate retirement
decision and backup are verified. External DataLens/Telegram/Tracker consumers
are deferred and must be checked before disabling the Supabase project.
