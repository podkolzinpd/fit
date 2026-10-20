import { beforeEach, describe, expect, it, vi } from 'vitest'
import { stageAndroidOta } from './android-ota-runner'
import type { AndroidOtaManifest, AndroidOtaPolicy } from './android-ota-manifest'
const policy: AndroidOtaPolicy = { enabled: true, publicKey: 'verified separately', appId: 'com.coachspace.fit',
  abi: 'a'.repeat(64), origin: 'https://fit-training.ru', channel: 'alpha' }
const release = { bundleId: 'b'.repeat(64), checksum: 'b'.repeat(64), signature: 'signed-zip',
  url: `${policy.origin}/mobile-updates/android/bundles/${'b'.repeat(64)}.zip`, minNativeBuild: 4, maxNativeBuild: 4 }
const manifest: AndroidOtaManifest = { schema: 1, sourceCommit: 'd'.repeat(40), appId: policy.appId,
  abi: policy.abi, platform: 'android', channel: 'alpha', sequence: 2, issuedAt: 0, expiresAt: 1, release }
function dependencies() {
  return { plugin: {
    getVersionCode: vi.fn(() => Promise.resolve({ versionCode: '4' })),
    getCurrentBundle: vi.fn((): Promise<{ bundleId: string | null }> => Promise.resolve({ bundleId: null })),
    getNextBundle: vi.fn((): Promise<{ bundleId: string | null }> => Promise.resolve({ bundleId: null })),
    getBlockedBundles: vi.fn(() => Promise.resolve({ bundleIds: [] as string[] })),
    downloadBundle: vi.fn(() => Promise.resolve()), setNextBundle: vi.fn(() => Promise.resolve()), reset: vi.fn(() => Promise.resolve()),
  }, fetchManifest: vi.fn(() => Promise.resolve(new Response('{}'))), storage: localStorage,
    verify: vi.fn(() => Promise.resolve(manifest)) }
}
beforeEach(() => localStorage.clear())
describe('OTA stages updates without interrupting the active workout', () => {
  it('makes no requests when disabled', async () => {
    const deps = dependencies()
    expect(await stageAndroidOta({ ...policy, enabled: false }, deps)).toBe('disabled')
    expect(deps.fetchManifest).not.toHaveBeenCalled(); expect(deps.plugin.getVersionCode).not.toHaveBeenCalled()
  })
  it('checks credentials-free metadata, downloads a signed ZIP, then sets only the next native bundle', async () => {
    const deps = dependencies()
    expect(await stageAndroidOta(policy, deps)).toBe('staged')
    expect(deps.fetchManifest).toHaveBeenCalledWith(`${policy.origin}/mobile-updates/android/alpha/${policy.abi}/latest.json`, expect.objectContaining({ credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer' }))
    expect(deps.plugin.downloadBundle).toHaveBeenCalledWith({ artifactType: 'zip', bundleId: release.bundleId,
      checksum: release.checksum, signature: release.signature, url: release.url })
    expect(deps.plugin.setNextBundle).toHaveBeenCalledWith({ bundleId: release.bundleId })
    expect(deps.plugin.downloadBundle.mock.invocationCallOrder[0]).toBeLessThan(deps.plugin.setNextBundle.mock.invocationCallOrder[0]!)
    // The adapter receives no reload method, so it cannot interrupt Live/voice/forms.
    expect(localStorage.getItem(`fit.android-ota.sequence.${policy.abi}`)).toBe('2')
  })
  it('does not stage when native signature/download verification fails; the same signed sequence may retry', async () => {
    const deps = dependencies()
    deps.plugin.downloadBundle.mockRejectedValueOnce(new Error('native signature or network failure'))
    await expect(stageAndroidOta(policy, deps)).rejects.toThrow()
    expect(deps.plugin.setNextBundle).not.toHaveBeenCalled()
    expect(await stageAndroidOta(policy, deps)).toBe('staged')
  })
  it('ignores an older signed manifest without changing the pending bundle', async () => {
    const deps = dependencies(); deps.storage.setItem(`fit.android-ota.sequence.${policy.abi}`, '3')
    await expect(stageAndroidOta(policy, deps)).rejects.toThrow('OTA_REPLAY')
    expect(deps.plugin.downloadBundle).not.toHaveBeenCalled(); expect(deps.plugin.reset).not.toHaveBeenCalled()
  })
  it('leaves the current version intact when offline or metadata is invalid', async () => {
    const deps = dependencies(); deps.fetchManifest.mockRejectedValueOnce(new Error('offline'))
    await expect(stageAndroidOta(policy, deps)).rejects.toThrow('offline')
    deps.verify.mockRejectedValueOnce(new Error('invalid metadata'))
    await expect(stageAndroidOta(policy, deps)).rejects.toThrow('invalid metadata')
    expect(deps.plugin.downloadBundle).not.toHaveBeenCalled(); expect(deps.plugin.setNextBundle).not.toHaveBeenCalled()
  })
  it('does not redownload a bundle blocked after native rollback', async () => {
    const deps = dependencies(); deps.plugin.getBlockedBundles.mockResolvedValueOnce({ bundleIds: [release.bundleId] })
    expect(await stageAndroidOta(policy, deps)).toBe('blocked'); expect(deps.plugin.downloadBundle).not.toHaveBeenCalled()
  })
  it.each(['getCurrentBundle', 'getNextBundle'] as const)('does not redownload the %s version', async method => {
    const deps = dependencies(); deps.plugin[method].mockResolvedValueOnce({ bundleId: release.bundleId })
    expect(await stageAndroidOta(policy, deps)).toBe('current'); expect(deps.plugin.downloadBundle).not.toHaveBeenCalled()
  })
  it('accepts a newer signed reset only for the next start', async () => {
    const deps = dependencies(); deps.verify.mockResolvedValueOnce({ ...manifest, release: null })
    expect(await stageAndroidOta(policy, deps)).toBe('reset-pending')
    expect(deps.plugin.reset).toHaveBeenCalledOnce(); expect(deps.plugin.downloadBundle).not.toHaveBeenCalled()
  })
})
