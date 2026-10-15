import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { certificateTargets, validateContent, sealedConfiguration } from './prepare-cloudru-sealed-https.mjs'
import { dnsChallenge, dnsAnswerMatches } from './issue-cloudru-sealed-certificate.mjs'

const root = { domain: 'fit-training.ru' }
const configuration = [{ domain: root.domain, chainPath: '/etc/fit/tls/candidate/chain.pem', keyPath: '/etc/fit/tls/candidate/key.pem' }]

test('local certificate targets are confined to approved Fit domains', () => {
  assert.deepEqual(certificateTargets('web'), [root, { domain: 'www.fit-training.ru' }])
  assert.deepEqual(certificateTargets('api'), [{ domain: 'api.fit-training.ru' }])
  for (const target of ['unknown', '', '../web']) assert.throws(() => certificateTargets(target), /https_target_invalid/)
})

test('DNS proof is exact, bounded and not an arbitrary DNS writer', () => {
  const value = 'a'.repeat(43)
  assert.deepEqual(dnsChallenge(root.domain, value), { event: 'cloudru_acme_dns_required',
    name: '_acme-challenge.fit-training.ru', type: 'TXT', value })
  assert.ok(dnsAnswerMatches(`"${value}"\n`, value))
  for (const answer of ['', `"${value}x"`, value, 'cm.yandexcloud.net.', `"${'b'.repeat(43)}"`]) {
    assert.equal(dnsAnswerMatches(answer, value), false)
  }
  for (const [domain, token] of [['unapproved.example', value], [root.domain, 'invalid'],
    ['*.fit-training.ru', value], [root.domain, `${value}; rm -rf /`]]) {
    assert.throws(() => dnsChallenge(domain, token), /https_challenge_invalid/)
  }
})

test('invalid key/chain inputs never reach generated config', () => {
  for (const value of [null, {}, { privateKey: 'not a private key',
    certificateChain: ['-----BEGIN CERTIFICATE-----\ninvalid'] }]) {
    assert.throws(() => validateContent(root, value), /https_(?:content|certificate)_invalid/)
  }
})

test('all locations and methods remain closed without upstream or database access', () => {
  const text = sealedConfiguration(configuration)
  assert.match(text, /listen 443 ssl/)
  assert.match(text, /ssl_protocols TLSv1.2 TLSv1.3/)
  assert.match(text, /return 503/)
  assert.match(text, /applicationAccess.*closed/)
  assert.match(text, /Cache-Control "no-store" always/)
  assert.match(text, /access_log off/)
  assert.doesNotMatch(text, /proxy_pass|fastcgi_pass|uwsgi_pass|\balias\b|\broot\b|18080|18081|limit_except/)
  assert.match(sealedConfiguration(configuration, { address: '127.0.0.1:', port: 18443 }), /listen 127.0.0.1:18443 ssl/)
})

test('unsafe config domains, paths, listeners or empty packages are rejected', () => {
  for (const item of [{ ...configuration[0], domain: 'unapproved.example' },
    { ...configuration[0], keyPath: '/etc/key; proxy_pass http://localhost;' },
    { ...configuration[0], chainPath: '/etc/fit/../secrets' }]) {
    assert.throws(() => sealedConfiguration([item]), /https_config_invalid/)
  }
  assert.throws(() => sealedConfiguration([]), /https_config_invalid/)
  assert.throws(() => sealedConfiguration(configuration, { address: '0.0.0.0:', port: 443 }), /https_config_invalid/)
})

test('existing workflow separates closed TLS from public cutover and CA/DNS consent', () => {
  const workflow = readFileSync(new URL('../.github/workflows/configure-cloudru-public-ingress.yml', import.meta.url), 'utf8')
  assert.match(workflow, /default: sealed/)
  assert.match(workflow, /ingress:\n    if: inputs.mode == 'activate'/)
  assert.match(workflow, /sealed:\n    if: inputs.mode == 'sealed'/)
  const sealed = workflow.split('  sealed:\n')[1]
  assert.match(sealed, /PREPARE_CLOUDRU_HTTPS_CLOSED/)
  assert.match(sealed, /group: cloudru-stage-vm/)
  assert.match(sealed, /getent ahostsv4 fit-training.ru/)
  assert.doesNotMatch(sealed, /YC_IAM_TOKEN|oidc|id-token|certificate-manager|terraform|db:migrate|secrets\./)
  assert.match(workflow, /test "\$ACTIVATION_CONFIRMATION" = OPEN_CLOUDRU_PUBLIC_INGRESS/)
  assert.match(workflow, /test "\$CA_TERMS_CONFIRMATION" = ACCEPT_LETS_ENCRYPT_TERMS_FOR_CLOUDRU/)
})

test('sealed installation has no remote keys, DNS mutations, raw errors or TLS bypass', () => {
  const helper = readFileSync(new URL('./prepare-cloudru-sealed-https.mjs', import.meta.url), 'utf8')
  assert.doesNotMatch(helper, /rejectUnauthorized:\s*false|--insecure|agree-tos|certificate-manager|\bfetch\(|console\.(?:log|error)/)
  assert.match(helper, /mode: 0o600/)
  assert.match(helper, /mode: 0o700/)
  assert.match(helper, /https_public_ingress_active/)
  assert.match(helper, /https_rollback_failed/)
  assert.match(helper, /process.on\('SIGTERM'/)
  assert.match(helper, /process.on\('SIGINT'/)
})

test('direct issuance is manual, current-main only, consent-gated and never opens API', () => {
  const issuer = readFileSync(new URL('./issue-cloudru-sealed-certificate.mjs', import.meta.url), 'utf8')
  assert.match(issuer, /ACCEPT_LETS_ENCRYPT_TERMS_FOR_CLOUDRU/)
  assert.match(issuer, /TEMPORARY_FIT_ACME_DNS_WITH_RESTORE/)
  assert.match(issuer, /refs\/heads\/main/)
  assert.match(issuer, /cloudru_acme_dns_restore_required/)
  assert.match(issuer, /--manual-auth-hook/)
  assert.match(issuer, /acme-v02\.api\.letsencrypt\.org/)
  assert.doesNotMatch(issuer, /certificate-manager|YC_IAM_TOKEN|\bfetch\(|proxy_pass|nginx.*reload|dns.*(?:create|update|delete)/)
})
