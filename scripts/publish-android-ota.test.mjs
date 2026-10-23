import test from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, sign, createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { decodeSignedManifest, verifyOtaDirectory, installOtaArchive, activateOtaManifest, withOtaLocation, requireKnownNativeShell } from './publish-android-ota.mjs'
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
