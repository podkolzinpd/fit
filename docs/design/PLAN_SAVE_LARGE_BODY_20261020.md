# Save-plan HTTP500: large request bodies, 20.10.2026

## Result and scope
A workout plan must reach the existing API regardless of crossing the proxy memory buffer. Keep the50MiB ingress limit and all API auth/body/schema/ownership rules. Change only the two API proxy locations: proxy_request_buffering off, existing HTTP1.1 retained. No UI/API/DB/LLM/cohort/native changes.

## Existing-state preflight
Base main85e13f3d after approved read-only diagnostic PR1729. The supplied screenshot reports POST/api/v1/workouts500. Exact request inspection39370304224:170entries in four-minute window,0matched. Broader39370443591:5000entries/0matched/0commandfailures. The request cannot be attributed to an application exception from those logs.

Public synthetic unauthenticated reproduction (no cookies/auth, no workout writes): web512B/4KiB/8KiB =>401 with API request/release headers; web16/32KiB =>500 without API headers; canonical API32KiB =>500 without API headers. A size-dependent ingress failure is directly reproduced; the screenshot alone does not reveal its payload size. Actual server filesystem error text was not read.

Reuse existing public ingress configs, main-only configure-cloudru-public-ingress workflow and rollback/nginx-t protections. Existing proxy_buffering off covers responses; request buffering was still default-on. Official directive: https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_request_buffering.

Local isolated Podman/nginx1.28-alpine reproduction uses exact before/after API location blocks, upstream401 stub and a deliberately unwritable client-body temp directory. Both old locations:512B401/32KiB500; both fixed:512B401/32KiB401. All8 assertions passed. This proves the fix removes that temp-file dependency, not the precise production filesystem permission failure. Evidence outputs/plan-save-http500-20261020/nginx-regression.json in the project workspace, not this checkout.

## Acceptance/release
- Existing policy suite gains one regression covering both API locations, HTTP1.1, limit and unchanged auth forwarding.
- Full local check and exact-head CI required by actual classifier; no skip-policy changes.
- Owner's queue exception applied only to diagnostics1729. This fix requires normal1725–1727 order or a new explicit exception.
- After green merge/mainCI, reapply only the two existing active ingress targets using their existing valid certificates; no DNS switch or certificate issuance is needed. Capture rollback-protected workflow results.
- Verify public512B/16KiB/32KiB/256KiB guards now return401 with API headers on both targets, existing auth/readiness/DNS/TLS intact. Do not write a real user's workout as a smoke test or claim their authenticated save was exercised.
