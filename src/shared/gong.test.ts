import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('rest gong', () => {
  it('preloads on a user gesture and reuses the decoded local sound at expiry', async () => {
    const resume = vi.fn().mockResolvedValue(undefined)
    const decodeAudioData = vi.fn().mockResolvedValue({ duration: 1.45 })
    const source = { buffer: null, connect: vi.fn(), start: vi.fn() }
    const gain = { gain: { setValueAtTime: vi.fn() }, connect: vi.fn() }
    const audioContext = {
      state: 'suspended', currentTime: 5, destination: {}, resume, decodeAudioData,
      createBufferSource: vi.fn(() => source), createGain: vi.fn(() => gain),
    }
    const AudioContext = vi.fn(function () { return audioContext })
    const fetch = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)) })
    vi.stubGlobal('AudioContext', AudioContext)
    vi.stubGlobal('fetch', fetch)

    const { playGong, prepareGong } = await import('./gong')
    prepareGong()
    await playGong()

    expect(AudioContext).toHaveBeenCalledTimes(1)
    expect(resume).toHaveBeenCalled()
    expect(fetch).toHaveBeenCalledOnce()
    expect(fetch).toHaveBeenCalledWith('/rest-gong.wav')
    expect(decodeAudioData).toHaveBeenCalledOnce()
    expect(source.buffer).toEqual({ duration: 1.45 })
    expect(source.connect).toHaveBeenCalledWith(gain)
    expect(gain.connect).toHaveBeenCalledWith(audioContext.destination)
    expect(gain.gain.setValueAtTime).toHaveBeenCalledWith(0.9, 5)
    expect(source.start).toHaveBeenCalledOnce()
  })

  it('keeps the timer usable when audio is unavailable', async () => {
    vi.stubGlobal('AudioContext', vi.fn(() => { throw new Error('blocked') }))
    const { playGong, prepareGong } = await import('./gong')

    expect(() => prepareGong()).not.toThrow()
    await expect(playGong()).resolves.toBeUndefined()
  })
})
