# Temporary ISO real-generator audit

Audit branch only. Never merge or deploy. Product changes are exactly the two
ISO brief source/test files copied from local fix checkout. The audit bundle is copied outside the checkout into RUNNER_TEMP/trainer-iso.
There `source` is a runtime symlink to this checked-out repository; keeping it
outside Vite root avoids a recursive watcher loop.
API dist model boundary is replaced there by `model-adapter.js`; it dispatches
real model-only runs of this same workflow/ref. No model response replay.

All application writes are loopback disposable Postgres17. No production DB,
profiles, flags, env files or keys are read or modified. GH_TOKEN is the job-scoped
ephemeral GitHub token; it is inherited in-process and never printed/uploaded.
Program instructions, guards, quality validation and role boundaries stay intact.
Audit transport timeouts/pool/readiness changes are not production latency acceptance.

Dispatch reviewed/published branch only:
`gh workflow run configure-cloudru-ai.yml --repo podkolzinpd/fit --ref audit/trainer-real-generator-20261107 -f mode=cycle`

Evidence upload is an explicit allowlist, excluding source/node_modules/dist.
Model artifacts contain only synthetic requests/responses and safe metrics.
The fixed ISO is 2026-11-07 throughout, never replaced with a natural-language date.
