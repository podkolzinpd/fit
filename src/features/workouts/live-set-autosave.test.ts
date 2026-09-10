import { describe, expect, it, vi } from 'vitest'
import { createLiveSetAutosave, LIVE_SET_AUTOSAVE_DELAY_MS } from './live-set-autosave'

describe('live set autosave', () => {
  it('coalesces input into one delayed save and flushes blur immediately', () => {
    vi.useFakeTimers()
    const save = vi.fn()
    const autosave = createLiveSetAutosave()

    autosave.schedule('set-1', save)
    autosave.schedule('set-1', save)
    vi.advanceTimersByTime(LIVE_SET_AUTOSAVE_DELAY_MS - 1)
    expect(save).not.toHaveBeenCalled()
    autosave.flush('set-1', save)
    expect(save).toHaveBeenCalledOnce()
    vi.advanceTimersByTime(LIVE_SET_AUTOSAVE_DELAY_MS)
    expect(save).toHaveBeenCalledOnce()
    vi.useRealTimers()
  })

  it('keeps timers independent per set and disposes pending work', () => {
    vi.useFakeTimers()
    const first = vi.fn()
    const second = vi.fn()
    const autosave = createLiveSetAutosave()
    autosave.schedule('set-1', first)
    autosave.schedule('set-2', second)
    autosave.clear('set-1')
    vi.advanceTimersByTime(LIVE_SET_AUTOSAVE_DELAY_MS)
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledOnce()
    autosave.schedule('set-3', first)
    autosave.dispose()
    vi.advanceTimersByTime(LIVE_SET_AUTOSAVE_DELAY_MS)
    expect(first).not.toHaveBeenCalled()
    vi.useRealTimers()
  })
})
