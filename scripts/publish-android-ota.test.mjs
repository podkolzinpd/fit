import test from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, sign, createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, stat, chmod } from 'node:fs/promises'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { EventEmitter } from 'node:events'
import { createServer, request as httpsRequest } from 'node:https'
import { execFileSync } from 'node:child_process'
import { decodeSignedManifest, verifyOtaDirectory, installOtaArchive, activateOtaManifest, withOtaLocation, requireKnownNativeShell, requirePublishedApi, fetchLocalPublicHttps, verifyPublicArchive } from './publish-android-ota.mjs'
import { signAndroidOtaManifest } from './package-android-ota.mjs'

async function fixture(t) {
  const root = await mkdtemp('/private/tmp/fit-ota-publish-'.replace('/private/tmp', process.platform === 'darwin' ? '/private/tmp' : '/tmp'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const keys = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const policy = { publicKey: keys.publicKey, abi: 'a'.repeat(64), appId: 'com.coachspace.fit', origin: 'https://fit-training.ru' }
  const commit = 'b'.repeat(40)
  const archive = Buffer.from('signed immutable ZIP fixture')
  const checksum = createHash('sha256').update(archive).digest('hex')
  const payload = { schema: 1, appId: policy.appId, platform: 'android', channel: 'alpha', abi: policy.abi, sourceCommit: commit,
    sequence: 100, issuedAt: Date.now(), expiresAt: Date.now() + 86400000,
    release: { checksum, bundleId: checksum, signature: sign('sha256', archive, keys.privateKey).toString('base64'),
      url: `${policy.origin}/mobile-updates/android/bundles/${checksum}.zip`, minNativeBuild: 5, maxNativeBuild: 5 } }
  const source = join(root, 'source')
  await mkdir(join(source, `android/alpha/${policy.abi}`), { recursive: true })
  await mkdir(join(source, 'android/bundles'), { recursive: true })
  const manifestPath = join(source, `android/alpha/${policy.abi}/latest.json`)
  const archivePath = join(source, `android/bundles/${checksum}.zip`)
  await writeFile(archivePath, archive)
  async function save() {
    await writeFile(manifestPath, JSON.stringify(signAndroidOtaManifest(payload, keys.privateKey)))
    await writeFile(join(source, 'provenance.json'), JSON.stringify({ commit, abi: policy.abi, nativeBuild: 5,
      sequence: payload.sequence, bundleId: payload.release?.bundleId ?? null }))
  }
  await save()
  return { root, source, commit, policy, payload, archivePath, manifestPath, save,
    verified: () => verifyOtaDirectory(source, commit, policy, 5) }
}

test('publisher rejects tampered manifest/archive and wrong source, ABI, native version or expiry', async t => {
  const f = await fixture(t)
  await f.verified()
  await assert.rejects(verifyOtaDirectory(f.source, 'c'.repeat(40), f.policy, 5), /CONTRACT/)
  await assert.rejects(verifyOtaDirectory(f.source, f.commit, f.policy, 6), /PROVENANCE/)
  for (const [field, value] of [['abi', 'c'.repeat(64)], ['expiresAt', 1]]) {
    const old = f.payload[field]; f.payload[field] = value; await f.save()
    await assert.rejects(f.verified(), /CONTRACT/)
    f.payload[field] = old
  }
  await f.save()
  const envelope = JSON.parse(await readFile(f.manifestPath, 'utf8'))
  envelope.payload = Buffer.from('{}').toString('base64')
  assert.throws(() => decodeSignedManifest(JSON.stringify(envelope), f.policy.publicKey), /SIGNATURE/)
  await writeFile(f.archivePath, 'modified')
  await assert.rejects(f.verified(), /ARCHIVE_SIGNATURE/)
})

test('immutable archive is installed before atomic manifest; replay and replacement are refused; newer reset is supported', async t => {
  const f = await fixture(t)
  const target = join(f.root, 'target')
  const verified = await f.verified()
  await installOtaArchive(verified, target)
  await assert.rejects(readFile(join(target, verified.manifestPath)), { code: 'ENOENT' })
  await activateOtaManifest(verified, target)
  assert.deepEqual(await readFile(join(target, verified.manifestPath)), verified.manifest)
  await activateOtaManifest(verified, target) // exact retry is idempotent
  f.payload.sequence = 99; await f.save()
  await assert.rejects(activateOtaManifest(await f.verified(), target), /SEQUENCE/)
  await writeFile(join(target, verified.archivePath), 'different object')
  await assert.rejects(installOtaArchive(verified, target), /IMMUTABLE/)
  f.payload.sequence = 101; f.payload.release = null; await f.save()
  const reset = await f.verified()
  await activateOtaManifest(reset, target)
  assert.equal(decodeSignedManifest(await readFile(join(target, reset.manifestPath)), f.policy.publicKey).release, null)
})

test('publisher refuses a symlink in the destination instead of escaping OTA storage', async t => {
  const f = await fixture(t)
  const target = join(f.root, 'target')
  await mkdir(target)
  await symlink(f.source, join(target, 'android'))
  await assert.rejects(installOtaArchive(await f.verified(), target), /UNSAFE/)
})

test('Nginx integration preserves existing API/body streaming/TLS and is idempotent', async () => {
  const config = await readFile(new URL('../infra/cloudru/nginx-public-web.conf', import.meta.url), 'utf8')
  const fragment = await readFile(new URL('../infra/cloudru/mobile-updates/location.conf', import.meta.url), 'utf8')
  const next = withOtaLocation(config, fragment)
  assert.equal(withOtaLocation(next, fragment), next)
  assert.equal(next, config)
  const withoutOta = config.replace(/    # Fit Android OTA begin\n[\s\S]*?    # Fit Android OTA end\n\n/, '')
  assert.equal(withOtaLocation(withoutOta, fragment), config)
  assert.match(next, /limit_except GET/)
  assert.match(next, /Access-Control-Allow-Origin "https:\/\/localhost"/)
  assert.throws(() => withOtaLocation('another server', fragment), /ANCHOR/)
})

test('release workflow keeps web feature flags, gates trusted main, and separates private signing from public artifacts', async () => {
  const web = await readFile(new URL('../.github/workflows/prepare-cloudru-frontend.yml', import.meta.url), 'utf8')
  const ota = await readFile(new URL('../.github/workflows/release-android-ota.yml', import.meta.url), 'utf8')
  const envLines = content => content.split('\n').filter(line => /^          VITE_/.test(line) && !line.includes('VITE_YANDEX_API_BASE_URL')).sort()
  assert.deepEqual(envLines(ota), envLines(web))
  for (const contract of ['Prepare Cloud.ru frontend without public routing', "github.event.workflow_run.conclusion == 'success'",
    'refs/heads/main', '.head_repository.full_name == $repo', '.path == ".github/workflows/ci.yml"',
    'FIT_ANDROID_OTA_AUTODEPLOY_ENABLED', 'FIT_ANDROID_OTA_PRIVATE_KEY', 'verify-android-apk-signature.mjs',
    'testDebugUnitTest assembleRelease', 'publish-android-ota.mjs readback', 'group: cloudru-stage-vm']) assert.ok(ota.includes(contract), contract)
  assert.match(ota, /path: ota-release\//)
  assert.match(ota, /trap 'rm -f "\$keyfile"' EXIT/)
  assert.ok(!ota.includes('path: dist/'))
})

test('automatic publication refuses a new ABI until an actual signed APK job admits it', async t => {
  const f = await fixture(t)
  const verified = await f.verified()
  const target = join(f.root, 'target')
  await assert.rejects(requireKnownNativeShell(verified, target), /NATIVE_APK_REQUIRED/)
  await requireKnownNativeShell(verified, target, true)
  await activateOtaManifest(verified, target)
  await requireKnownNativeShell(verified, target)
})

test('publication waits for the matching deployed API instead of releasing UI ahead of its backend', async () => {
  const commit = 'a'.repeat(40)
  await requirePublishedApi(commit, async url => {
    assert.equal(url, 'https://api.fit-training.ru/health')
    return Response.json({ status: 'ok', releaseId: commit })
  })
  await assert.rejects(requirePublishedApi(commit, async () => Response.json({ status: 'ok', releaseId: 'b'.repeat(40) })), /REVISION_MISMATCH/)
  await assert.rejects(requirePublishedApi(commit, async () => new Response('', { status: 503 })), /NOT_READY/)
})


test('publisher probes its own Nginx through loopback with canonical TLS identity and fails closed', async () => {
  const signal = AbortSignal.timeout(1000)
  const request = status => (url, options, ready) => {
    assert.equal(url.origin, 'https://api.fit-training.ru')
    assert.equal(options.hostname, '127.0.0.1')
    assert.equal(options.servername, 'api.fit-training.ru')
    assert.equal(options.headers.host, 'api.fit-training.ru')
    assert.equal(options.rejectUnauthorized, true)
    assert.equal(options.signal, signal)
    const req = new EventEmitter()
    req.end = () => {
      const response = new PassThrough()
      response.statusCode = status
      response.headers = { 'content-type': 'application/json' }
      ready(response)
      response.end(JSON.stringify({ status: 'ok', releaseId: 'a'.repeat(40) }))
    }
    return req
  }
  const response = await fetchLocalPublicHttps('https://api.fit-training.ru/health', { signal }, request(200))
  assert.equal((await response.json()).releaseId, 'a'.repeat(40))
  await assert.rejects(fetchLocalPublicHttps('https://api.fit-training.ru/health', { signal }, request(302)), /REDIRECT_REFUSED/)
  const tlsFailure = () => {
    const req = new EventEmitter()
    req.end = () => req.emit('error', new Error('CERT_HAS_EXPIRED'))
    return req
  }
  await assert.rejects(fetchLocalPublicHttps('https://api.fit-training.ru/health', { signal }, tlsFailure), /CERT_HAS_EXPIRED/)
  for (const url of ['http://api.fit-training.ru/health', 'https://other.example/health',
    'https://api.fit-training.ru/v1/clients', 'https://fit-training.ru/api/health',
    'https://api.fit-training.ru/health?token=fixture']) {
    assert.throws(() => fetchLocalPublicHttps(url), /TARGET_INVALID/)
  }
})


test('loopback readback reaches real HTTPS Nginx identity without trusting a wrong hostname', async t => {
  const root = await mkdtemp(join(process.env.TMPDIR || '/tmp', 'fit-ota-tls-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const key = join(root, 'key.pem')
  const cert = join(root, 'cert.pem')
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key,
    '-out', cert, '-days', '1', '-subj', '/CN=api.fit-training.ru',
    '-addext', 'subjectAltName=DNS:api.fit-training.ru'], { stdio: 'ignore' })
  const certificate = await readFile(cert)
  const server = createServer({ key: await readFile(key), cert: certificate }, (req, res) => {
    assert.equal(req.headers.host, 'api.fit-training.ru')
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ status: 'ok', releaseId: 'a'.repeat(40) }))
  })
  await new Promise(done => server.listen(0, '127.0.0.1', done))
  t.after(() => new Promise(done => server.close(done)))
  const request = (url, options, ready) => httpsRequest(url, {
    ...options, port: server.address().port, ca: certificate,
  }, ready)
  const fetcher = (url, options) => fetchLocalPublicHttps(url, options, request)
  await requirePublishedApi('a'.repeat(40), fetcher)
  await assert.rejects(fetcher('https://fit-training.ru/mobile-updates/android/not-a-release', {
    signal: AbortSignal.timeout(2000),
  }), { code: 'ERR_TLS_CERT_ALTNAME_INVALID' })
})


test('public OTA files stay readable under a restrictive runner umask without changing ancestors', async t => {
  const f = await fixture(t)
  const target = join(f.root, 'public')
  await mkdir(target, { mode: 0o700 })
  const before = (await stat(f.root)).mode & 0o777
  const mask = process.umask(0o077)
  try {
    const verified = await f.verified()
    await installOtaArchive(verified, target)
    await chmod(join(target, verified.archivePath), 0o600)
    await installOtaArchive(verified, target) // repair a prior otherwise valid copy
    await activateOtaManifest(verified, target)
    for (const path of [target, join(target, 'android'), join(target, 'android/bundles'),
      join(target, 'android/alpha'), join(target, `android/alpha/${f.policy.abi}`)]) {
      assert.equal((await stat(path)).mode & 0o777, 0o755, path)
    }
    for (const path of [verified.archivePath, verified.manifestPath]) {
      assert.equal((await stat(join(target, path))).mode & 0o777, 0o644, path)
    }
    assert.equal((await stat(f.root)).mode & 0o777, before)
  } finally { process.umask(mask) }
})

test('first Nginx activation waits for exact ZIP after stale workers and remains bounded on mismatch', async t => {
  const f = await fixture(t)
  const verified = await f.verified()
  let calls = 0
  let time = 0
  const readiness = { waitForReady: true, now: () => time, pause: async ms => { time += ms } }
  await verifyPublicArchive(verified, async () => {
    calls++
    return calls < 3 ? new Response('old frontend', { status: 200 }) : new Response(await readFile(f.archivePath))
  }, readiness)
  assert.equal(calls, 3)
  assert.equal(time, 500)
  time = 0; calls = 0
  await assert.rejects(verifyPublicArchive(verified, async () => {
    calls++; return new Response('', { status: 403 })
  }, readiness), /MISMATCH: HTTP 403/)
  assert.equal(time, 10000)
  assert.equal(calls, 40)
  await assert.rejects(verifyPublicArchive(verified, async () => new Response('wrong bytes')), /MISMATCH/)
})


test('a replacement native ABI cannot reuse or lower the installed versionCode', async t => {
  const f = await fixture(t)
  const target = join(f.root, 'target')
  const previous = await f.verified()
  await activateOtaManifest(previous, target)
  const abi = 'c'.repeat(64)
  const replacement = { ...previous, policy: { ...previous.policy, abi },
    payload: { ...previous.payload, abi }, manifestPath: `android/alpha/${abi}/latest.json` }
  await assert.rejects(requireKnownNativeShell(replacement, target, true), /VERSION_MUST_INCREASE/)
  await assert.rejects(requireKnownNativeShell({ ...replacement, nativeBuild: 4 }, target, true), /VERSION_MUST_INCREASE/)
  await requireKnownNativeShell({ ...replacement, nativeBuild: 6 }, target, true)
  // Existing compatible channels continue to work without a native rebuild.
  await requireKnownNativeShell(previous, target)
})
