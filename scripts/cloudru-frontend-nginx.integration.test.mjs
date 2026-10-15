import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm, chmod, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { packageRelease, supportedRouting } from './frontend-release.mjs'
import { materializeCloudruFrontend, cloudruNginxConfigurations } from './prepare-cloudru-frontend.mjs'

// Explicit local integration command; no production URL/DB or Docker dependency.
test('real isolated Nginx preserves hosting contracts and validates non-root candidate beside serving stage', { timeout: 180_000 }, async (t) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'fit-cloudru-nginx-integration-')))
  const connection = process.env.FIT_CLOUDRU_TEST_PODMAN_CONNECTION
  const store = process.env.FIT_CLOUDRU_TEST_PODMAN_STORE
  if (store && !/^\/(?:var\/)?tmp\/fit-cloudru-nginx-test-store-[a-z0-9-]+$/.test(store)) {
    throw new Error('Expected a dedicated temporary Podman test store')
  }
  const podmanPrefix = connection ? ['--connection', connection] : []
  const runPodman = (args, options) => {
    if (!store) return spawnSync('podman', [...podmanPrefix, ...args], options)
    const quote = (argument) => `'${argument.replaceAll("'", "'\\''")}'`
    const command = ['podman', '--root', `${store}/storage`, '--runroot', `${store}/run`,
      '--storage-driver', 'vfs', ...args].map(quote).join(' ')
    return spawnSync('podman', ['machine', 'ssh', 'podman-machine-default', command], options)
  }
  const container = basename(root).toLowerCase()
  t.after(() => runPodman(['rm', '--force', '--ignore', container], { timeout: 10_000, stdio: 'ignore' }))
  t.after(() => rm(root, { recursive: true, force: true }))
  await chmod(root, 0o755)
  const source = join(root, 'source')
  await mkdir(join(source, 'assets'), { recursive: true })
  await mkdir(join(source, 'fonts'))
  for (const [key, bytes] of Object.entries({
    'index.html': '<!doctype html><html>local integration fixture</html>',
    'asset-recovery.js': '// stale asset recovery', 'sw.js': '// service worker', 'site.webmanifest': '{}',
    'assets/app-12345678.js': '// fixture', 'assets/theme-12345678.css': 'body {}',
    'assets/engine-12345678.wasm': '\0asm', 'fonts/fixture.woff2': 'wOF2 synthetic test font',
  })) await writeFile(join(source, key), bytes)
  const sha = 'a'.repeat(40)
  const bundle = await packageRelease(source, sha, supportedRouting)
  await materializeCloudruFrontend(bundle, join(root, 'site'), sha)
  const { candidate } = cloudruNginxConfigurations(bundle, '/fixture/site')
  await writeFile(join(root, 'candidate.conf'), candidate)
  await writeFile(join(root, 'release.json'), JSON.stringify(bundle))
  await writeFile(join(root, 'nginx.conf'), 'pid /tmp/fit-nginx.pid; error_log stderr crit; events {} http { include /fixture/candidate.conf; }\n')
  const vmCandidate = '/opt/fit/frontend/candidates/' + sha + '-1-1'
  await writeFile(join(root, 'stage.conf'), cloudruNginxConfigurations(bundle, vmCandidate + '/site').stage)
  await writeFile(join(root, 'probe-stage.conf'), cloudruNginxConfigurations(bundle, '/fixture/site').stage.replace('/run/fit-frontend-stage.pid', '/tmp/fit-stage.pid'))
  await writeFile(join(root, 'probe.mjs'), `
import { readFile } from 'node:fs/promises';
import { verifyCloudruHttp } from '/scripts/verify-cloudru-frontend.mjs';
const bundle = JSON.parse(await readFile('/fixture/release.json', 'utf8'));
await verifyCloudruHttp(bundle, 'http://127.0.0.1:18083/');
await verifyCloudruHttp(bundle, 'http://127.0.0.1:18081/');
console.log('CLOUDRU_NGINX_CONTRACT_PASSED');
`)
  const result = runPodman([
    'run', '--rm', '--name', container, '--volume', `${root}:/fixture:ro`,
    '--volume', `${resolve(import.meta.dirname)}:/scripts:ro`,
    'docker.io/library/node:22-bookworm-slim', 'sh', '-ec', `
apt-get update -qq && apt-get install -y --no-install-recommends nginx >/dev/null
node --test /scripts/promote-cloudru-frontend.test.mjs
nginx -t -c /fixture/probe-stage.conf
nginx -c /fixture/probe-stage.conf -g 'daemon off;' &
stage_pid=$!
nginx -c /fixture/nginx.conf -g 'daemon off;' &
nginx_pid=$!
node /fixture/probe.mjs
kill -TERM "$nginx_pid"
wait "$nginx_pid"
candidate=/opt/fit/frontend/candidates/${sha}-1-1
mkdir -p "$candidate"
cp -R /fixture/site "$candidate/site"
cp /fixture/stage.conf "$candidate/stage.conf"
su -s /bin/sh node -c 'node /scripts/verify-cloudru-frontend.mjs /fixture/release.json /opt/fit/frontend/candidates/${sha}-1-1 ${sha}'
su -s /bin/sh node -c 'node /scripts/verify-cloudru-frontend.mjs /fixture/release.json /opt/fit/frontend/candidates/${sha}-1-1 ${sha} --serving'
kill -TERM "$stage_pid"
wait "$stage_pid"
`,
  ], { encoding: 'utf8', timeout: 170_000, maxBuffer: 2_000_000 })
  assert.equal(result.status, 0, result.error?.message ?? result.stderr)
  assert.match(result.stdout, /CLOUDRU_NGINX_CONTRACT_PASSED/)
  assert.match(result.stdout, /Verified serving frontend bytes and metadata on loopback/)
  assert.match(result.stdout, /Verified all frontend bytes, MIME\/cache, SPA, recovery and missing assets on loopback/)
})
