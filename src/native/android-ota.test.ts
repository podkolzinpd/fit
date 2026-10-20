import { beforeEach, describe, expect, it, vi } from 'vitest'
const native = vi.hoisted(() => ({ enabled: true, platform: 'android', available: true }))
const plugin = vi.hoisted(() => ({ ready: vi.fn(() => Promise.resolve({})) }))
const stage = vi.hoisted(() => vi.fn(() => Promise.resolve('disabled')))
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => native.enabled,
  getPlatform: () => native.platform, isPluginAvailable: () => native.available } }))
vi.mock('@capawesome/capacitor-live-update', () => ({ LiveUpdate: plugin }))
vi.mock('./android-ota-runner', () => ({ stageAndroidOta: stage }))
beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); native.enabled = true; native.platform = 'android'; native.available = true })
describe('native OTA startup boundary', () => {
  it('does nothing on web and on old native shells without the updater', async () => {
    const { initializeNativeOta } = await import('./android-ota')
    native.enabled = false; await initializeNativeOta(); native.enabled = true; native.available = false; await initializeNativeOta()
    expect(plugin.ready).not.toHaveBeenCalled(); expect(stage).not.toHaveBeenCalled()
  })
  it('marks the rendered native app ready before staging, once even under StrictMode', async () => {
    const { initializeNativeOta } = await import('./android-ota')
    await Promise.all([initializeNativeOta(), initializeNativeOta()])
    expect(plugin.ready).toHaveBeenCalledOnce(); expect(stage).toHaveBeenCalledOnce()
    expect(plugin.ready.mock.invocationCallOrder[0]).toBeLessThan(stage.mock.invocationCallOrder[0]!)
  })
  it('does not request an Android bundle on iOS', async () => {
    native.platform = 'ios'
    const { initializeNativeOta } = await import('./android-ota'); await initializeNativeOta()
    expect(plugin.ready).toHaveBeenCalledOnce(); expect(stage).not.toHaveBeenCalled()
  })
  it('leaves native rollback armed when ready fails and emits only a stable diagnostic', async () => {
    plugin.ready.mockRejectedValueOnce(new Error('private details'))
    const log = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const { initializeNativeOta } = await import('./android-ota'); await initializeNativeOta()
      expect(stage).not.toHaveBeenCalled(); expect(log).toHaveBeenCalledWith('FIT_ANDROID_OTA_CHECK_FAILED')
    } finally { log.mockRestore() }
  })
})
