# FIT custom domain: fit-training.ru

## Scope and acceptance

Approved on 27 September 2026: use Yandex Cloud DNS for `fit-training.ru`;
retain Beget registration, mail records, `www`, Vercel and the technical
frontend hostname. DNS pricing reviewed: 0.0592 RUB/zone-hour plus 37.94 RUB
per million authoritative requests, VAT included. No new compute resources.

1. Copy existing records before delegation and verify authoritative answers.
2. Delegate only this domain to Yandex Cloud DNS.
3. Issue managed HTTPS certificate and attach the existing frontend gateway.
4. Add domain-specific OAuth callback and API/storage CORS without removing
   existing origins or changing application/database permissions.
5. After certificate issuance, replace only apex parking A with gateway ANAME;
   verify HTTPS/auth/assets, old origins and mail records.

## Verified remote changes

- Public zone `fit-training-ru`, ID `dns7eld4ceutkbftord9`.
- Nameservers: `ns1.yandexcloud.net`, `ns2.yandexcloud.net`.
- Beget accepted the nameserver change. At 23:52 UTC on 26 September the `.ru`
  authoritative server still returned Beget delegation; propagation pending.
- Copied record sets (TTL 300): apex A `5.101.152.161`, MX priorities 10/20
  to `mx1.beget.com.` / `mx2.beget.com.`, TXT `v=spf1 redirect=beget.com`;
  the same A/MX/TXT for `www`; `autoconfig` and `autodiscover` CNAME to
  `autoconfig.beget.com.`. New provider's NS/SOA are retained, not copied.
- Authoritative MX/TXT queries against Yandex nameservers passed.
- Managed certificate `fpqsgmijaus25eog4poq`, domain `fit-training.ru`,
  status `Validating`. Linked CNAME `_acme-challenge.fit-training.ru.` points
  to `fpqsgmijaus25eog4poq.cm.yandexcloud.net.` (TTL 600), verified by DNS.
- OAuth client retains its four existing callbacks and adds
  `https://fit-training.ru/auth/yandex/callback`; saved form re-opened to verify.
- API CORS adds `https://fit-training.ru`. Recursive comparison against
  previous revision confirms only CORS changed, apart from revision metadata.
  Image/release remains `6cf00d82d0b87f0f3dacb12d8fddae210d5f5720`.
  OPTIONS from new domain and Vercel both return 204 and exact allowed origin.
- Frontend bucket CORS retains technical origin and adds new domain, with
  existing GET/HEAD, Range, exposed headers and max-age unchanged. Public WASM
  HEAD returns 200 and exact allowed origin for both origins. ACL unchanged.
- Deployment workflow and its contract test preserve this additional API origin.

## Pending gates / continuation

Do not mark custom-domain rollout complete yet. Wait for registry delegation
and certificate `Issued`, then attach certificate to existing gateway
`d5drmhq5ovqk03jgsm8i`, replace only apex A with ANAME to its technical hostname,
and verify HTTPS `/auth`, direct routes and assets. Keep frontend request
logging disabled (OAuth query safety). No frontend release replacement here.
Real-account OAuth, browser WASM and rollback drill remain separate unverified
checks from the previous candidate rollout.

Until those gates pass, apex still uses the preserved Beget parking A record.
The existing technical frontend and Vercel remain available. No DB migrations,
user-data writes, secret rotation or service-account permission changes.

## Recovery

Before gateway activation, new zone preserves the previous public behavior.
If required, restore Beget delegation to the six original servers
`ns1.beget.com`, `ns2.beget.com`, `ns1.beget.pro`, `ns2.beget.pro`,
`ns1.beget.ru`, `ns2.beget.ru`; their existing zone has not been edited.
After activation, website-only recovery is to restore apex A `5.101.152.161`
instead of ANAME, without touching mail, `www` or delegation. This restores
the former parking page, not FIT; Vercel remains the working alternative.

## Local verification

- Deployment workflow contract: 30 passed.
- `npm run check` passed the stages before frontend hosting; hosting's local
  HTTP listeners were blocked by sandbox `EPERM`. Re-run outside that restriction:
  `npm run frontend:hosting:test`: 25 passed.
- API initially lacked the worktree dependency symlink; after reusing the
  installed dependencies with an identical lockfile, `npm run api:check`
  passed (927 tests, 49 skipped), followed by `npm run build` and startup check.
- `git diff --check` passed. No application UI changes or database changes;
  no authenticated product E2E or remote migrations performed.
