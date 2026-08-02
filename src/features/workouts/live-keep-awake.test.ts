import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  isNativePlatform: vi.fn(),
  keepAwake: vi.fn(),
  allowSleep: vi.fn(),
}))

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: mocks.isNativePlatform } }))
vi.mock('@capacitor-community/keep-awake', () => ({ KeepAwake: { keepAwake: mocks.keepAwake, allowSleep: mocks.allowSleep } }))

import { setLiveScreenAwake } from './live-keep-awake'

describe('setLiveScreenAwake', () => {
  it('does not call a native plugin in the browser', async () => {
    mocks.isNativePlatform.mockReturnValue(false)
    await setLiveScreenAwake(true)
    expect(mocks.keepAwake).not.toHaveBeenCalled()
  })

  it('keeps the native screen awake during live mode and releases it afterwards', async () => {
    mocks.isNativePlatform.mockReturnValue(true)
    await setLiveScreenAwake(true)
    await setLiveScreenAwake(false)
    expect(mocks.keepAwake).toHaveBeenCalledOnce()
    expect(mocks.allowSleep).toHaveBeenCalledOnce()
  })
})
