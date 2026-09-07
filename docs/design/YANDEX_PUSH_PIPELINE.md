# Yandex push pipeline

## User result

A user routed to Yandex PostgreSQL keeps the existing Web Push behavior:
trainer-created plans enqueue an immediate notification, and a planned workout
can enqueue one local-time reminder around 09:00. Existing Supabase tenants and
the frontend interface are unchanged.

## Accepted contract

- PostgreSQL produces and atomically leases outbox rows; it makes no network
  calls and uses no business trigger.
- `savePlannedWorkout` calls the scheduled-workout producer in the same actor
  transaction only for a new trainer-authored plan.
- A private Serverless Container runs the reminder producer, claims up to 20
  rows and calls the existing Yandex Web Push function.
- A one-minute Timer Trigger invokes only that container through its own
  service account. Neither the dispatcher nor migration runner allows
  `allUsers`.
- A committed lease is recoverable after ten minutes. Failures are bounded to
  ten attempts; HTTP 404/410 also removes the invalid subscription.
- Provider error bodies, subscription endpoints and Lockbox payloads are not
  persisted or logged.
- The sender Function and its Lockbox may live in a different folder from
  stage. CI switches between the two existing OIDC identities, passes only
  resource IDs/version to Terraform and grants payload access directly to the
  dispatcher service account; the secret value never crosses the boundary.
- The first billable bootstrap is blocked until its plan and cost estimate are
  explicitly approved. The timer is applied only after candidate health passes.

## Acceptance evidence

- PostgreSQL 17 integration covers actor-derived scheduled events, self-plan
  suppression, reminder idempotency, leasing, successful finalization,
  expired subscriptions, retry exhaustion and closed direct grants.
- Unit tests cover timer event validation, sender authentication and response
  validation, transaction boundaries and safe failures.
- Terraform policy tests reject public access, resource expansion and an
  unapproved bootstrap; workflow tests pin approval, health and rollback order.

## Rollout boundary

This change does not migrate a tenant or switch frontend routing. Applying
migration `000030` alone is inert with respect to outbound delivery. Stage
transport starts only after the separate Terraform bootstrap; production
requires its own reviewed infrastructure and tenant rollout decision.
