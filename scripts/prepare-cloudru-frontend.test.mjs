import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createServer } from 'node:http'
import { spawnSync } from 'node:child_process'
import { packageRelease, supportedRouting } from './frontend-release.mjs'
import { cloudruNginxConfigurations, materializeCloudruFrontend } from './prepare-cloudru-frontend.mjs'
import { verifyCloudruFiles, verifyCloudruHttp, verifyCloudruConfiguration } from './verify-cloudru-frontend.mjs'

const sha = 'a'.repeat(40)
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'fit-cloudru-frontend-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = join(root, 'source')
  await mkdir(join(source, 'assets'), { recursive: true })
  for (const [key, bytes] of Object.entries({
    'index.html': '<!doctype html><html>local fixture</html>',
    'asset-recovery.js': '// reload recovery', 'sw.js': '// sw', 'site.webmanifest': '{}',
    'assets/app-12345678.js': '// compiled fixture', 'assets/app-12345678.css': 'body {}',
    'assets/engine-12345678.wasm': '\0asm',
  })) await writeFile(join(source, key), bytes)
  return { root, bundle: await packageRelease(source, sha, supportedRouting) }
}

test('materializes every verified file without changing bytes or replacing a previous release', async (t) => {
  const { root, bundle } = await fixture(t)
  const destination = join(root, 'site')
  assert.equal(await materializeCloudruFrontend(bundle, destination, sha), bundle.files.length)
  await verifyCloudruFiles(bundle, destination, sha)
  await assert.rejects(materializeCloudruFrontend(bundle, destination, sha), { code: 'EEXIST' })
  for (const file of bundle.files) {
    assert.deepEqual(await readFile(join(destination, file.key)), Buffer.from(file.content, 'base64'))
  }
})

test('rejects a stale source before creating the output directory', async (t) => {
  const { root, bundle } = await fixture(t)
  const destination = join(root, 'site')
  await assert.rejects(materializeCloudruFrontend(bundle, destination, 'b'.repeat(40)), /source mismatch/)
  await assert.rejects(readFile(join(destination, 'index.html')), { code: 'ENOENT' })
})

test('rejects corrupted contents and unsafe paths before copying any file', async (t) => {
  const { root, bundle } = await fixture(t)
  for (const change of [
    (file) => { file.content = Buffer.from('changed').toString('base64') },
    (file) => { file.key = '../escape.js' },
    (file) => { file.key = '.env' },
  ]) {
    const invalid = structuredClone(bundle)
    change(invalid.files[0])
    await assert.rejects(materializeCloudruFrontend(invalid, join(root, 'site'), sha))
  }
})

test('never writes through an existing directory symlink', async (t) => {
  const { root, bundle } = await fixture(t)
  const original = join(root, 'original')
  await mkdir(original)
  const destination = join(root, 'link')
  await symlink(original, destination)
  await assert.rejects(materializeCloudruFrontend(bundle, destination, sha), { code: 'EEXIST' })
  await assert.rejects(readFile(join(original, 'index.html')), { code: 'ENOENT' })
})

test('disk verification fails on changed bytes or a leaf symlink', async (t) => {
  const { root, bundle } = await fixture(t)
  const site = join(root, 'site')
  await materializeCloudruFrontend(bundle, site, sha)
  await writeFile(join(site, 'sw.js'), '// changed')
  await assert.rejects(verifyCloudruFiles(bundle, site, sha), /checksum mismatch/)
  await rm(join(site, 'sw.js'))
  await symlink(join(root, 'source', 'sw.js'), join(site, 'sw.js'))
  await assert.rejects(verifyCloudruFiles(bundle, site, sha), /regular frontend file/)
})

test('candidate binds only loopback and retains SPA, stale JS recovery, MIME and cache contracts', async (t) => {
  const { bundle } = await fixture(t)
  const { candidate } = cloudruNginxConfigurations(bundle, '/opt/fit/frontend/candidates/fixture/site')
  assert.match(candidate, /listen 127\.0\.0\.1:18083;/)
  assert.doesNotMatch(candidate, /listen (?:80|443)|proxy_pass/)
  assert.match(candidate, /disable_symlinks on;/)
  assert.match(candidate, /location = \/assets\/engine-12345678.wasm[\s\S]*?application\/wasm/)
  assert.match(candidate, /public, max-age=31536000, immutable/)
  assert.match(candidate, /location = \/sw.js[\s\S]*?no-cache/)
  assert.match(candidate, /rewrite \^ \/asset-recovery.js last/)
  assert.match(candidate, /location \/ \{ try_files \$uri \/index.html; \}/)
  assert.match(candidate, /location ~ \^\/\(assets\|fonts\|media\)\/ \{ return 404; \}/)
  const log = candidate.match(/log_format[^;]+;/)?.[0]
  assert.ok(log)
  assert.doesNotMatch(log, /request_uri|remote_addr|http_|request_body/)
})

test('serving config retains loopback isolation and changed config cannot be promoted', async (t) => {
  const { root, bundle } = await fixture(t)
  const { stage } = cloudruNginxConfigurations(bundle, join(root, 'site'))
  assert.match(stage, /listen 127\.0\.0\.1:18081;/)
  assert.doesNotMatch(stage, /listen (?:80|443)|proxy_pass|ssl_certificate/)
  await writeFile(join(root, 'stage.conf'), stage)
  await verifyCloudruConfiguration(bundle, root)
  await writeFile(join(root, 'stage.conf'), stage.replace('127.0.0.1:18081', '0.0.0.0:18081'))
  await assert.rejects(verifyCloudruConfiguration(bundle, root), /configuration mismatch/)
})

test('rejects Nginx directive injection in the filesystem root', async (t) => {
  const { bundle } = await fixture(t)
  for (const root of ['/tmp/site; listen 80;', '/tmp/../site', 'relative/site', '/tmp/$host']) {
    assert.throws(() => cloudruNginxConfigurations(bundle, root), /Unsafe frontend root/)
  }
})

test('HTTP verification exercises real bytes, routes, MIME/cache and missing assets', async (t) => {
  const { bundle } = await fixture(t)
  const requested = []
  let invalidMetadata = false
  const server = createServer((request, response) => {
    requested.push(request.url)
    const key = request.url.slice(1)
    const file = bundle.files.find((entry) => entry.key === key)
      ?? (key === 'assets/missing-cloudru-probe.js' ? bundle.files.find((entry) => entry.key === 'asset-recovery.js') : undefined)
      ?? (!key.includes('.') ? bundle.files.find((entry) => entry.key === 'index.html') : undefined)
    if (!file) { response.writeHead(404).end(); return }
    response.writeHead(200, {
      'Content-Type': file.contentType, 'Cache-Control': invalidMetadata ? 'public, max-age=0' : file.cacheControl,
      'X-Content-Type-Options': 'nosniff',
    }).end(Buffer.from(file.content, 'base64'))
  })
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  t.after(() => new Promise((done) => { server.closeAllConnections(); server.close(done) }))
  await verifyCloudruHttp(bundle, `http://127.0.0.1:${server.address().port}/`)
  assert.ok(requested.includes('/auth/yandex/callback'))
  assert.ok(requested.includes('/assets/engine-12345678.wasm'))
  assert.ok(requested.includes('/fonts/missing.woff2'))
  await assert.rejects(verifyCloudruHttp(bundle, 'https://production.example.test/'), /loopback HTTP/)
  invalidMetadata = true
  await assert.rejects(verifyCloudruHttp(bundle, 'http://127.0.0.1:' + server.address().port + '/'), /metadata mismatch/)
})

test('prepare workflow retains green-main and default-off automatic gate without public/API/DB activation', async () => {
  const workflow = await readFile(new URL('../.github/workflows/prepare-cloudru-frontend.yml', import.meta.url), 'utf8')
  assert.match(workflow, /workflow_dispatch:/)
  assert.match(workflow, /test "\$GITHUB_REF" = refs\/heads\/main/)
  assert.match(workflow, /workflow_run:[\s\S]*workflows: \[CI\]/)
  assert.match(workflow, /vars.CLOUDRU_FRONTEND_AUTODEPLOY_ENABLED == 'true'/)
  assert.doesNotMatch(workflow, /\n  push:|pull_request:/)
  assert.match(workflow, /contents: read\n  actions: read/)
  assert.match(workflow, /\.status == "completed" and .conclusion == "success"/)
  assert.match(workflow, /head_repository.full_name == \$repo/)
  assert.match(workflow, /VITE_YANDEX_API_BASE_URL: https:\/\/fit-training.ru\/api/)
  assert.ok(workflow.includes("VITE_ASSISTANT_PROGRAM_ENABLED: ${{ vars.CLOUDRU_AI_ENABLED == 'true' && 'true' || 'false' }}"))
  assert.match(workflow, /runs-on: \[self-hosted, cloudru-stage\]/)
  assert.match(workflow, /group: cloudru-stage-vm\n\s+cancel-in-progress: false/)
  assert.match(workflow, /verify-cloudru-frontend.mjs/)
  assert.match(workflow, /https:\/\/fit-training\.ru\/api\/health/)
  assert.match(workflow, /\.releaseId == \$release/)
  assert.match(workflow, /https:\/\/fit-training\.ru\/api\/v1\/clients\)" = 401/)
  assert.match(workflow, /scripts\/promote-cloudru-frontend.sh/)
  assert.ok(workflow.indexOf('Verify immutable candidate') < workflow.indexOf('Promote verified loopback'))
  assert.doesNotMatch(workflow, /ssh |SSH_|REGISTRATION_TOKEN|certbot|dns record|pg_restore|psql|podman run|DATABASE_PASSWORD|service_role/)
  for (const match of workflow.matchAll(/\n\s+run: \|\n([\s\S]*?)(?=\n      - |$)/g)) {
    const shell = match[1].replace(/^          /gm, '')
    const result = spawnSync('bash', ['-n'], { input: shell, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
  }
})

test('candidate preserves legacy VITE settings and adds only the reviewed Cloud.ru fixed2 plan pilot', async () => {
  const [production, candidate] = await Promise.all([
    readFile(new URL('../.github/workflows/deploy-yandex-frontend.yml', import.meta.url), 'utf8'),
    readFile(new URL('../.github/workflows/prepare-cloudru-frontend.yml', import.meta.url), 'utf8'),
  ])
  const settings = (text) => new Map([...text.matchAll(/^          (VITE_[A-Z_]+): (.+)$/gm)]
    .map((match) => [match[1], match[2]]))
  const original = settings(production)
  const next = settings(candidate)
  const planPilot = ['VITE_COACH_PLAN_INPUT_ENABLED', 'VITE_COACH_PLAN_INPUT_PILOT_USER_IDS', 'VITE_COACH_PLAN_LAYOUT_ENABLED', 'VITE_COACH_PLAN_LAYOUT_PILOT_USER_IDS']
  assert.deepEqual([...next.keys()].filter(name => name !== 'VITE_SPEECHKIT_RELAY_URL').sort(), [...original.keys(), ...planPilot].sort())
  assert.equal(next.get(planPilot[0]), "${{ vars.VITE_COACH_PLAN_INPUT_ENABLED || 'false' }}")
  assert.equal(next.get(planPilot[1]), "${{ vars.VITE_COACH_PLAN_INPUT_PILOT_USER_IDS || '' }}")
  assert.equal(next.get(planPilot[2]), "${{ vars.VITE_COACH_PLAN_LAYOUT_ENABLED || 'false' }}")
  assert.equal(next.get(planPilot[3]), "${{ vars.VITE_COACH_PLAN_LAYOUT_PILOT_USER_IDS || '' }}")
  for (const [name, value] of original) {
    // VITE_SERVICE_NOTICE_ENABLED: временная плашка о восстановлении ИИ, решение владельца 14.10.
    if (name === 'VITE_YANDEX_API_BASE_URL' || name === 'VITE_ASSISTANT_PROGRAM_ENABLED' || name === 'VITE_SERVICE_NOTICE_ENABLED') continue
    assert.equal(next.get(name), value, name)
  }
})

test('only the hosted build uses the existing frontend candidate secret environment', async () => {
  const workflow = await readFile(new URL('../.github/workflows/prepare-cloudru-frontend.yml', import.meta.url), 'utf8')
  const build = workflow.slice(workflow.indexOf('  build:\n'), workflow.indexOf('  prepare:\n'))
  const prepare = workflow.slice(workflow.indexOf('  prepare:\n'))
  assert.match(build, /runs-on: ubuntu-24\.04\n    environment: fit-frontend-candidate/)
  assert.doesNotMatch(build, /VITE_SUPABASE_/)
  assert.match(build, /FIT_LIME_FONTS_REQUIRED: 'true'/)
  assert.doesNotMatch(prepare, /environment:|secrets\./)
  assert.doesNotMatch(workflow, /environment: fit-frontend-production|id-token: write/)
})
