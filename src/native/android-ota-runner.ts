import { readAndroidOtaEnvelope, verifyAndroidOtaManifest, type AndroidOtaPolicy } from './android-ota-manifest'
import type { LiveUpdatePlugin } from '@capawesome/capacitor-live-update'

export interface OtaDependencies {
  plugin: Pick<LiveUpdatePlugin, 'getVersionCode' | 'getCurrentBundle' | 'getNextBundle' | 'getBlockedBundles' | 'downloadBundle' | 'setNextBundle' | 'reset'>
  fetchManifest: typeof fetch
  storage: Pick<Storage, 'getItem' | 'setItem'>
  verify?: typeof verifyAndroidOtaManifest
}
// Native plugin stages the next server path. Never call reload: Live/voice/forms
// must continue on the running bundle until a later native process launch.
export async function stageAndroidOta(policy: AndroidOtaPolicy, deps: OtaDependencies) {
  if (!policy.enabled) return 'disabled'
  const { versionCode } = await deps.plugin.getVersionCode()
  const url = `${policy.origin}/mobile-updates/android/${policy.channel}/${policy.abi}/latest.json`
  const response = await deps.fetchManifest(url, { credentials: 'omit', cache: 'no-store', redirect: 'error',
    referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(10000) })
  const manifest = await (deps.verify ?? verifyAndroidOtaManifest)(await readAndroidOtaEnvelope(response), policy, Number(versionCode))
  const storageKey = `fit.android-ota.sequence.${policy.abi}`
  const previous = Number(deps.storage.getItem(storageKey) ?? 0)
  if (!Number.isSafeInteger(previous) || previous < 0 || manifest.sequence < previous) throw new Error('OTA_REPLAY')
  deps.storage.setItem(storageKey, String(manifest.sequence))
  if (!manifest.release) { await deps.plugin.reset(); return 'reset-pending' }
  const release = manifest.release
  const { bundleIds } = await deps.plugin.getBlockedBundles()
  if (bundleIds.includes(release.bundleId)) return 'blocked'
  const current = await deps.plugin.getCurrentBundle()
  const next = await deps.plugin.getNextBundle()
  if (current.bundleId === release.bundleId || next.bundleId === release.bundleId) return 'current'
  await deps.plugin.downloadBundle({ artifactType: 'zip', bundleId: release.bundleId, url: release.url,
    checksum: release.checksum, signature: release.signature })
  await deps.plugin.setNextBundle({ bundleId: release.bundleId })
  return 'staged'
}
