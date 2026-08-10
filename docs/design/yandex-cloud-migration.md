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

1. Add the isolated API process, container image and health checks.
2. Describe Yandex Cloud resources in Terraform without applying production.
3. Add a reproducible Managed PostgreSQL baseline and actor context.
4. Port the existing SQL/RLS contract before exposing domain endpoints.
5. Implement Yandex ID and the profile vertical slice on stage.
6. Port clients, memberships, exercises, workouts, progress, goals and
   summaries in parity-tested vertical slices.
7. Rehearse the data migration at least twice before the production cutover.
8. Remove Supabase only after the rollback window closes.

## Foundation acceptance

- `services/api` builds and its health test passes independently.
- The root quality gate also validates the API package.
- The API container listens on the `PORT` environment variable required by
  Serverless Containers.
- No frontend import, query or production environment variable changes.
- No database, authentication or paid cloud resource is created by this step.
