import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  isNativePlatform: vi.fn(),
  keepAwake: vi.fn(),
  allowSleep: vi.fn(),
}))

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: mocks.isNativePlatform } }))
vi.mock('@capacitor-community/keep-awake', () => ({ KeepAwake: { keepAwake: mocks.keepAwake, allowSleep: mocks.allowSleep } }))

import { setLiveScreenAwake } from './live-keep-awake'

function stubWakeLock() {
  const sentinels: Array<{ released: boolean; release: ReturnType<typeof vi.fn> }> = []
  const request = vi.fn(() => {
    const sentinel = { released: false, release: vi.fn(() => { sentinel.released = true; return Promise.resolve() }) }
    sentinels.push(sentinel)
    return Promise.resolve(sentinel)
  })
  Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request } })
  return { request, sentinels }
}

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: state })
  document.dispatchEvent(new Event('visibilitychange'))
}

describe('setLiveScreenAwake', () => {
  afterEach(async () => {
    await setLiveScreenAwake(false)
    Reflect.deleteProperty(navigator, 'wakeLock')
    setVisibility('visible')
    vi.clearAllMocks()
  })

  it('keeps the browser screen awake in Live and releases it afterwards', async () => {
    mocks.isNativePlatform.mockReturnValue(false)
    const { request, sentinels } = stubWakeLock()
    await setLiveScreenAwake(true)
    expect(request).toHaveBeenCalledWith('screen')
    await setLiveScreenAwake(false)
    expect(sentinels[0]?.release).toHaveBeenCalledOnce()
    expect(mocks.keepAwake).not.toHaveBeenCalled()
  })

  // Браузер снимает блокировку при уходе вкладки в фон; при возврате в Live берём её снова.
  it('takes the browser lock again when the person returns to the Live tab', async () => {
    mocks.isNativePlatform.mockReturnValue(false)
    const { request, sentinels } = stubWakeLock()
    await setLiveScreenAwake(true)
    sentinels[0]!.released = true
    setVisibility('hidden')
    setVisibility('visible')
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2))
  })

  it('leaves Live working in a browser without screen wake lock', async () => {
    mocks.isNativePlatform.mockReturnValue(false)
    await expect(setLiveScreenAwake(true)).resolves.toBeUndefined()
  })

  it('keeps the native screen awake during live mode and releases it afterwards', async () => {
    mocks.isNativePlatform.mockReturnValue(true)
    await setLiveScreenAwake(true)
    await setLiveScreenAwake(false)
    expect(mocks.keepAwake).toHaveBeenCalledOnce()
    expect(mocks.allowSleep).toHaveBeenCalledOnce()
  })
})
