import { generateKeyPairSync, sign, webcrypto } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readAndroidOtaEnvelope, verifyAndroidOtaManifest, type AndroidOtaPolicy } from './android-ota-manifest'

const keys = generateKeyPairSync('rsa', { modulusLength: 2048 })
const policy: AndroidOtaPolicy = { enabled: true, abi: 'a'.repeat(64), appId: 'com.coachspace.fit',
  origin: 'https://fit-training.ru', channel: 'alpha', publicKey: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString() }
const now = Date.UTC(2026, 9, 19)
const manifest = () => ({ schema: 1, sourceCommit: 'd'.repeat(40), appId: policy.appId, platform: 'android', abi: policy.abi,
  channel: 'alpha', sequence: 1, issuedAt: now, expiresAt: now + 86400000,
  release: { bundleId: 'b'.repeat(64), checksum: 'b'.repeat(64), signature: Buffer.alloc(256).toString('base64'),
    url: `${policy.origin}/mobile-updates/android/bundles/${'b'.repeat(64)}.zip`, minNativeBuild: 4, maxNativeBuild: 4 } })
function signed(value: unknown) {
  const bytes = Buffer.from(JSON.stringify(value))
  return { payload: bytes.toString('base64'), signature: sign('sha256', bytes, keys.privateKey).toString('base64') }
}
beforeEach(() => { vi.stubGlobal('crypto', webcrypto) })
afterEach(() => { vi.unstubAllGlobals() })
describe('Android OTA manifest authenticity and compatibility', () => {
  it('accepts a genuine release and signed builtin reset; verification does not depend on API/auth', async () => {
    expect(await verifyAndroidOtaManifest(signed(manifest()), policy, 4, now)).toEqual(manifest())
    expect((await verifyAndroidOtaManifest(signed({ ...manifest(), release: null }), policy, 4, now)).release).toBeNull()
  })
  it('rejects changed bytes and signatures from another key', async () => {
    const envelope = signed(manifest())
    envelope.payload = Buffer.from(JSON.stringify({ ...manifest(), sequence: 100 })).toString('base64')
    await expect(verifyAndroidOtaManifest(envelope, policy, 4, now)).rejects.toThrow('OTA_MANIFEST_SIGNATURE')
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 })
    const bytes = Buffer.from(JSON.stringify(manifest()))
    await expect(verifyAndroidOtaManifest({ payload: bytes.toString('base64'), signature: sign('sha256', bytes, other.privateKey).toString('base64') }, policy, 4, now)).rejects.toThrow('OTA_MANIFEST_SIGNATURE')
  })
  it.each(['appId', 'abi', 'channel'] as const)('rejects a genuinely signed release for a different %s', async field => {
    const value = manifest()
    value[field] = field === 'abi' ? 'c'.repeat(64) : 'other'
    await expect(verifyAndroidOtaManifest(signed(value), policy, 4, now)).rejects.toThrow('OTA_INCOMPATIBLE')
  })
  it.each([3, 5, Number.NaN])('rejects native build %s outside the exact APK compatibility contract', async build => {
    await expect(verifyAndroidOtaManifest(signed(manifest()), policy, build, now)).rejects.toThrow('OTA_INCOMPATIBLE')
  })
  it.each([
    'http://fit-training.ru/mobile-updates/android/bundles/file.zip',
    'https://attacker.invalid/bundle.zip',
    'https://fit-training.ru/mobile-updates/android/bundles/../private.zip',
    `${policy.origin}/mobile-updates/android/bundles/${'b'.repeat(64)}.zip?token=secret`,
  ])('rejects an alternate or credential-bearing download URL', async url => {
    const value = manifest(); value.release.url = url
    await expect(verifyAndroidOtaManifest(signed(value), policy, 4, now)).rejects.toThrow('OTA_INCOMPATIBLE')
  })
  it.each([
    { issuedAt: now - 2, expiresAt: now - 1 },
    { issuedAt: now + 300001, expiresAt: now + 86400000 },
    { issuedAt: now, expiresAt: now + 31 * 86400000 },
  ])('rejects expired, future or unbounded signed manifests', async dates => {
    await expect(verifyAndroidOtaManifest(signed({ ...manifest(), ...dates }), policy, 4, now)).rejects.toThrow('OTA_EXPIRED')
  })
  it('rejects HTTP failures, oversized streaming bodies and truncated JSON before staging', async () => {
    await expect(readAndroidOtaEnvelope(new Response('', { status: 404 }))).rejects.toThrow('OTA_UNAVAILABLE')
    await expect(readAndroidOtaEnvelope(new Response('a'.repeat(32769)))).rejects.toThrow('OTA_MANIFEST_SIZE')
    await expect(readAndroidOtaEnvelope(new Response('{'))).rejects.toThrow()
    await expect(readAndroidOtaEnvelope(new Response(new ReadableStream({ start(controller) { controller.error(new Error('connection lost')) } })))).rejects.toThrow('connection lost')
  })
})
