import { Capacitor } from '@capacitor/core'
import { stageAndroidOta } from './android-ota-runner'
import type { AndroidOtaPolicy } from './android-ota-manifest'

declare const __FIT_ANDROID_OTA_POLICY__: AndroidOtaPolicy
let startup: Promise<void> | undefined
export function initializeNativeOta(): Promise<void> {
  if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('LiveUpdate')) return Promise.resolve()
  startup ??= initialize()
  return startup
}
async function initialize() {
  try {
    const { LiveUpdate } = await import('@capawesome/capacitor-live-update')
    // The caller lives inside the root render boundary, after App commits.
    // Readiness is independent of connectivity and auth/API availability.
    await LiveUpdate.ready()
    if (Capacitor.getPlatform() !== 'android' || typeof __FIT_ANDROID_OTA_POLICY__ === 'undefined') return
    await stageAndroidOta(__FIT_ANDROID_OTA_POLICY__, { plugin: LiveUpdate, fetchManifest: fetch, storage: localStorage })
  } catch {
    // Stable diagnostic only: no URL, account, payload, stack or network error.
    console.warn('FIT_ANDROID_OTA_CHECK_FAILED')
  }
}
