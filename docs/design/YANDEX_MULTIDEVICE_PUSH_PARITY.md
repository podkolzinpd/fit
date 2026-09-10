# Yandex multi-device push parity

## Accepted outcome

After a tenant is moved from Supabase to Yandex, every active browser push
subscription remains transferable and addressable. Disabling notifications or
receiving a terminal Web Push response on one device must not remove another
device. Existing production routing stays unchanged by this work.

## Acceptance checklist

- [x] Yandex PostgreSQL uses a subscription UUID primary key and unique
  `(user_id, endpoint)` identity.
- [x] Producers create one outbox row per subscription and deduplicate by the
  subscription identity.
- [x] Claim/finalize reads the exact subscription and a 404/410 removes only
  that endpoint.
- [x] The actor-authenticated API checks and deletes an endpoint from request
  bodies without exposing it in a URL or response.
- [x] Tenant export/import keys subscriptions by `id` and the local rehearsal
  transfers two subscriptions for one synthetic user.
- [x] Actor, cross-tenant, API, repository and migration tests cover the new
  contract locally.
- [x] `AGENTS.md` requires every future product/database change to preserve or
  explicitly block Supabase/Yandex parity in the same PR.
- [ ] Apply migration `000038` through the normal reviewed stage deployment;
  no remote database is changed from this PR preparation step.
