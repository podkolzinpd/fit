import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, chmod, rm, realpath } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'

test('real local Nginx TLS stays closed and rolls back reload/serving failures', { timeout: 180_000 }, async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'fit-sealed-https-test-')))
  const store = process.env.FIT_CLOUDRU_TEST_PODMAN_STORE
  if (!store || !/^\/(?:var\/)?tmp\/fit-cloudru-nginx-test-store-[a-z0-9-]+$/.test(store)) {
    throw new Error('Set a dedicated local test Podman store; no production environment is used')
  }
  const run = (args, options = {}) => {
    const quote = text => `'${text.replaceAll("'", "'\\''")}'`
    return spawnSync('podman', ['machine', 'ssh', 'podman-machine-default',
      ['podman', '--root', `${store}/storage`, '--runroot', `${store}/run`, '--storage-driver', 'vfs', ...args].map(quote).join(' ')], options)
  }
  const container = basename(root)
  t.after(() => run(['rm', '--force', '--ignore', container], { timeout: 10_000, stdio: 'ignore' }))
  t.after(() => rm(root, { recursive: true, force: true }))
  await chmod(root, 0o755)
  await writeFile(join(root, 'systemctl'), `#!/bin/sh
set -eu
if [ "$*" != 'reload nginx' ]; then exit 1; fi
if [ -e /tmp/fixture-reload-fail ]; then
  /bin/rm /tmp/fixture-reload-fail
  exit 1
fi
/usr/sbin/nginx -s reload
`)
  await writeFile(join(root, 'curl'), `#!/bin/sh
set -eu
case "$*" in
  *:443:*) if [ -e /tmp/fixture-serving-fail ]; then /bin/rm /tmp/fixture-serving-fail; exit 1; fi ;;
esac
/usr/bin/curl "$@" || { code=$?; printf 'curl:%s\\n' "$code" >> /tmp/fixture-command-errors; exit "$code"; }
`)
  await writeFile(join(root, 'entry.mjs'), `
process.argv[1]='/scripts/prepare-cloudru-sealed-https.mjs';
await import('/scripts/prepare-cloudru-sealed-https.mjs');
`)
  await writeFile(join(root, 'nginx'), `#!/bin/sh
set -eu
case "$*" in
  *'daemon off;'*) if [ -e /tmp/fixture-probe-wait ]; then touch /tmp/fixture-probe-ready; exec sleep 120; fi ;;
esac
exec /usr/sbin/nginx "$@"
`)
  await writeFile(join(root, 'dig'), `#!/bin/sh
set -eu
case "$*" in
  *' CNAME '*) exit 0 ;;
  *' TXT '*) printf '"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"\\n' ;;
  *) exit 1 ;;
esac
`)
  await writeFile(join(root, 'certbot'), `#!/bin/sh
set -eu
hook=
for argument in "$@"; do
  if [ "$argument" = '--manual-auth-hook' ]; then next=hook; continue; fi
  if [ "\${next:-}" = hook ]; then hook="$argument"; next=; fi
done
test -n "$hook"
if [ "\${ISSUE_TEST_MODE:-}" = wait ]; then touch /tmp/fixture-issuance-ready; exec sleep 120; fi
CERTBOT_DOMAIN=fit-training.ru CERTBOT_VALIDATION=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa /bin/sh -c "$hook"
if [ "\${ISSUE_TEST_MODE:-}" = fail ]; then exit 42; fi
mkdir -p /etc/letsencrypt/live/fit-training.ru /etc/letsencrypt/archive/fit-training.ru
cp /test-certs/fit-training.ru.pem /etc/letsencrypt/archive/fit-training.ru/fullchain1.pem
cat /test-certs/ca.pem >> /etc/letsencrypt/archive/fit-training.ru/fullchain1.pem
install -m 600 /test-certs/fit-training.ru.key /etc/letsencrypt/archive/fit-training.ru/privkey1.pem
ln -s /etc/letsencrypt/archive/fit-training.ru/fullchain1.pem /etc/letsencrypt/live/fit-training.ru/fullchain.pem
ln -s /etc/letsencrypt/archive/fit-training.ru/privkey1.pem /etc/letsencrypt/live/fit-training.ru/privkey.pem
`)
  await writeFile(join(root, 'proof.mjs'), `
import assert from 'node:assert/strict';
import { readFileSync, existsSync, writeFileSync, statSync, readdirSync, chmodSync, symlinkSync, mkdirSync, copyFileSync } from 'node:fs';
import { spawnSync, spawn } from 'node:child_process';
import { validateContent, verifySealed } from '/scripts/prepare-cloudru-sealed-https.mjs';
const env = {...process.env, GITHUB_REPOSITORY:'podkolzinpd/fit',GITHUB_REF:'refs/heads/main',RELEASE_SHA:'a'.repeat(40),
  TARGET:'web',PREPARE_CONFIRMATION:'PREPARE_CLOUDRU_HTTPS_CLOSED'};
const issueEnv={...env,CA_TERMS_CONFIRMATION:'ACCEPT_LETS_ENCRYPT_TERMS_FOR_CLOUDRU',DNS_CONFIRMATION:'TEMPORARY_FIT_ACME_DNS_WITH_RESTORE'};
const issue=(extra={})=>spawnSync('node',['/scripts/issue-cloudru-sealed-certificate.mjs'],{encoding:'utf8',env:{...issueEnv,...extra},timeout:25000});
assert.equal(issue({CA_TERMS_CONFIRMATION:''}).status,1);
assert.equal(issue({DNS_CONFIRMATION:''}).status,1);
assert.equal(issue({GITHUB_REF:'refs/heads/unknown'}).status,1);
const aborted=spawn('node',['/scripts/issue-cloudru-sealed-certificate.mjs'],{env:{...issueEnv,ISSUE_TEST_MODE:'wait'},stdio:['ignore','pipe','pipe']});
const abortExit=new Promise(resolve=>aborted.once('exit',resolve));
for(let i=0;i<200 && !existsSync('/tmp/fixture-issuance-ready');i++) await new Promise(resolve=>setTimeout(resolve,10));
assert.ok(existsSync('/tmp/fixture-issuance-ready')); aborted.kill('SIGTERM');
assert.equal(await abortExit,1);
const denied=issue({ISSUE_TEST_MODE:'fail'});
assert.equal(denied.status,1); assert.match(denied.stdout,/cloudru_acme_dns_restore_required/);
assert.ok(!existsSync('/etc/nginx/sites-enabled/fit-cloudru-sealed-web'));
const issued=issue(); assert.equal(issued.status,0,issued.stderr);
assert.match(issued.stdout,/cloudru_local_certificate_issued/);
assert.match(issued.stdout,/cloudru_acme_dns_required/);
assert.match(issued.stdout,/cloudru_acme_dns_restore_required/);
assert.doesNotMatch(issued.stdout,/BEGIN.*PRIVATE KEY/);
assert.ok(!existsSync('/etc/nginx/sites-enabled/fit-cloudru-sealed-web'));
const reused=issue(); assert.equal(reused.status,0,reused.stderr);
assert.match(reused.stdout,/cloudru_local_certificate_already_valid/);
const cli = () => spawnSync('node',['/fixture/entry.mjs'],{encoding:'utf8',env,timeout:25000});
const initial=cli(); assert.equal(initial.status,0,initial.stderr);
assert.match(initial.stdout,/cloudru_sealed_https_prepared/);
const site='/etc/nginx/sites-available/fit-cloudru-sealed-web';
const original=readFileSync(site,'utf8');
for(const domain of ['fit-training.ru','www.fit-training.ru']) verifySealed(domain,443);
mkdirSync('/etc/letsencrypt/archive/api.fit-training.ru',{recursive:true});
mkdirSync('/etc/letsencrypt/live/api.fit-training.ru',{recursive:true});
copyFileSync('/test-certs/api.fit-training.ru.pem','/etc/letsencrypt/archive/api.fit-training.ru/fullchain1.pem');
copyFileSync('/test-certs/api.fit-training.ru.key','/etc/letsencrypt/archive/api.fit-training.ru/privkey1.pem');
chmodSync('/etc/letsencrypt/archive/api.fit-training.ru/privkey1.pem',0o600);
symlinkSync('/etc/letsencrypt/archive/api.fit-training.ru/fullchain1.pem','/etc/letsencrypt/live/api.fit-training.ru/fullchain.pem');
symlinkSync('/etc/letsencrypt/archive/api.fit-training.ru/privkey1.pem','/etc/letsencrypt/live/api.fit-training.ru/privkey.pem');
const api=spawnSync('node',['/fixture/entry.mjs'],{encoding:'utf8',env:{...env,TARGET:'api'},timeout:25000});
assert.equal(api.status,0,api.stderr+(existsSync('/tmp/fixture-command-errors')?readFileSync('/tmp/fixture-command-errors','utf8'):'')); verifySealed('api.fit-training.ru',443);
assert.equal(readFileSync(site,'utf8'),original);
assert.equal(statSync('/etc/fit/tls').mode & 0o777,0o700);
for(const directory of readdirSync('/etc/fit/tls')) {
  for(const name of readdirSync('/etc/fit/tls/'+directory)) if(name.endsWith('.pem'))
    assert.equal(statSync('/etc/fit/tls/'+directory+'/'+name).mode & 0o777,0o600);
}
const expected={domain:'fit-training.ru',domains:['fit-training.ru','www.fit-training.ru']};
const bundle={privateKey:readFileSync('/test-certs/fit-training.ru.key','utf8'),certificateChain:[readFileSync('/test-certs/fit-training.ru.pem','utf8')]};
assert.ok(validateContent(expected,bundle).fingerprint);
assert.throws(()=>validateContent({...expected,domain:'api.fit-training.ru'},bundle),/https_certificate_invalid/);
assert.throws(()=>validateContent({...expected,domains:['fit-training.ru']},bundle),/https_certificate_invalid/);
assert.throws(()=>validateContent(expected,{...bundle,privateKey:readFileSync('/test-certs/ca.key','utf8')}),/https_certificate_invalid/);
assert.throws(()=>validateContent(expected,bundle,Date.now()+365*86400000),/https_certificate_invalid/);
chmodSync('/etc/letsencrypt/archive/fit-training.ru/privkey1.pem',0o666);
assert.equal(cli().status,1); assert.equal(readFileSync(site,'utf8'),original);
chmodSync('/etc/letsencrypt/archive/fit-training.ru/privkey1.pem',0o600);
for(const failure of ['fixture-reload-fail','fixture-serving-fail']) {
  writeFileSync('/tmp/'+failure,'fixture');
  const failed=cli(); assert.equal(failed.status,1,failed.stderr);
  assert.equal(readFileSync(site,'utf8'),original);
  for(const domain of ['fit-training.ru','www.fit-training.ru']) verifySealed(domain,443);
}
writeFileSync('/etc/nginx/sites-enabled/fit-public-api','fixture');
assert.equal(cli().status,1); assert.equal(readFileSync(site,'utf8'),original);
await import('node:fs/promises').then(fs=>fs.rm('/etc/nginx/sites-enabled/fit-public-api'));
symlinkSync('/missing-fixture-target','/etc/nginx/sites-enabled/fit-public-api');
assert.equal(cli().status,1); assert.equal(readFileSync(site,'utf8'),original);
await import('node:fs/promises').then(fs=>fs.rm('/etc/nginx/sites-enabled/fit-public-api'));
writeFileSync('/tmp/fixture-probe-wait','fixture');
const cancelled=spawn('node',['/fixture/entry.mjs'],{env,stdio:['ignore','pipe','pipe']});
const completion=new Promise(resolve=>cancelled.once('exit',resolve));
for(let i=0;i<200 && !existsSync('/tmp/fixture-probe-ready');i++) await new Promise(resolve=>setTimeout(resolve,10));
assert.ok(existsSync('/tmp/fixture-probe-ready'));
cancelled.kill('SIGTERM');
assert.equal(await completion,1);
assert.equal(readFileSync(site,'utf8'),original);
assert.ok(!original.includes('proxy_pass'));
console.log('SEALED_TLS_REAL_NGINX_ROLLBACK_PROOF_PASSED');
`)
  const result = run(['run', '--rm', '--name', container,
    '--volume', `${root}:/fixture:ro`, '--volume', `${resolve(import.meta.dirname)}:/scripts:ro`,
    'docker.io/library/node:22-bookworm-slim', 'sh', '-ec', `
apt-get update -qq && apt-get install -y --no-install-recommends nginx openssl curl ca-certificates >/dev/null
mkdir -p /test-certs /etc/nginx/sites-available /etc/nginx/sites-enabled
openssl req -x509 -newkey rsa:2048 -nodes -keyout /test-certs/ca.key -out /test-certs/ca.pem -days 30 -subj /CN=Local-Fixture-CA >/dev/null 2>&1
for domain in fit-training.ru api.fit-training.ru; do
  openssl req -new -newkey rsa:2048 -nodes -keyout /test-certs/$domain.key -out /test-certs/$domain.csr -subj /CN=$domain >/dev/null 2>&1
  if [ "$domain" = fit-training.ru ]; then
    printf 'subjectAltName=DNS:fit-training.ru,DNS:www.fit-training.ru\nextendedKeyUsage=serverAuth\n' > /test-certs/extension.cnf
  else
    printf 'subjectAltName=DNS:api.fit-training.ru\nextendedKeyUsage=serverAuth\n' > /test-certs/extension.cnf
  fi
  openssl x509 -req -in /test-certs/$domain.csr -CA /test-certs/ca.pem -CAkey /test-certs/ca.key -CAcreateserial -out /test-certs/$domain.pem -days 30 -extfile /test-certs/extension.cnf >/dev/null 2>&1
done
cp /test-certs/ca.pem /usr/local/share/ca-certificates/fixture.crt
update-ca-certificates >/dev/null
cp /fixture/systemctl /usr/local/bin/systemctl
cp /fixture/curl /usr/local/bin/curl
cp /fixture/nginx /usr/local/bin/nginx
cp /fixture/certbot /usr/local/bin/certbot
cp /fixture/dig /usr/local/bin/dig
chmod 755 /usr/local/bin/systemctl /usr/local/bin/curl /usr/local/bin/nginx /usr/local/bin/certbot /usr/local/bin/dig
nginx
node /fixture/proof.mjs
`], { encoding: 'utf8', timeout: 170_000, maxBuffer: 2_000_000 })
  assert.equal(result.status, 0, result.error?.message ?? result.stderr)
  assert.match(result.stdout, /SEALED_TLS_REAL_NGINX_ROLLBACK_PROOF_PASSED/)
})
