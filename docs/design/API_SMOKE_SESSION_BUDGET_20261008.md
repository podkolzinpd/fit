# API rollout: synthetic session lifetime

Scope: assistant-ops, deployment checks only; baseline main `e02ab402`.
No API/schema/IAM/user-session/UI/mobile changes or Supabase fallback.

## Acceptance

1. Obtain fresh synthetic fixture sessions after successful candidate bootstrap,
   retaining the private runtime database preflight before deployment.
2. Validate all four sessions against one 10-minute product-smoke budget with a
   60-second safety margin; do not increase the existing 15-minute fixture TTL.
3. Bound each request by a 5-second connect timeout, a 30-second request timeout
   and the remaining suite budget; never automatically retry mutation or 401.
4. Preserve the complete product assertions, including expected 409 conflicts,
   candidate rollback and the matching-API frontend guard.
5. Report safe per-request diagnostics without tokens, payloads, entity IDs,
   signed object URLs or query strings; do not label all smoke failures `/ready`.
6. Run deterministic expired/fresh-session, budget, timeout, 401, 409 and privacy
   tests, workflow contracts and the full `npm run check` before PR publication.

## Evidence

Run 37766348845 reached product smoke after passing health/readiness, then failed
with 401 in `planned-workout-lifecycle` at 11:14:25 UTC. Its fixture was prepared
by 10:59:11 UTC and expires after 15 minutes. This supports fixture expiry as the
primary hypothesis, not a proven platform failure: the original response body
and server-side auth reason were not retained. Public Gateway network timeouts
are separate and not repaired by this change.

Implementation and local verification are recorded in `docs/CURRENT_STATE.md`;
CI and production must not be claimed before their actual completion.
