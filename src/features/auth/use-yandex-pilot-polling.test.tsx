import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  useYandexPilotPolling,
  YANDEX_PILOT_POLL_INTERVAL_MS,
} from './use-yandex-pilot-polling'

function visibility(value: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value })
  document.dispatchEvent(new Event('visibilitychange'))
}

describe('Yandex pilot polling', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    visibility('visible')
  })

  afterEach(() => {
    vi.useRealTimers()
    visibility('visible')
  })

  it('refreshes a visible pilot at a bounded interval without overlapping requests', async () => {
    let resolveRefresh: (() => void) | undefined
    const refresh = vi.fn(() => new Promise<void>((resolve) => { resolveRefresh = resolve }))
    renderHook(() => useYandexPilotPolling(true, refresh))

    await act(() => vi.advanceTimersByTimeAsync(YANDEX_PILOT_POLL_INTERVAL_MS))
    expect(refresh).toHaveBeenCalledOnce()
    await act(() => vi.advanceTimersByTimeAsync(YANDEX_PILOT_POLL_INTERVAL_MS))
    expect(refresh).toHaveBeenCalledOnce()

    await act(async () => { resolveRefresh?.(); await Promise.resolve() })
    await act(() => vi.advanceTimersByTimeAsync(YANDEX_PILOT_POLL_INTERVAL_MS))
    expect(refresh).toHaveBeenCalledTimes(2)
  })

  it('stops while hidden and refetches once when the tab becomes visible', async () => {
    const refresh = vi.fn().mockResolvedValue(undefined)
    renderHook(() => useYandexPilotPolling(true, refresh))

    act(() => visibility('hidden'))
    await act(() => vi.advanceTimersByTimeAsync(YANDEX_PILOT_POLL_INTERVAL_MS * 2))
    expect(refresh).not.toHaveBeenCalled()

    act(() => visibility('visible'))
    expect(refresh).toHaveBeenCalledOnce()
  })

  it('does not poll before a pilot session exists', async () => {
    const refresh = vi.fn().mockResolvedValue(undefined)
    renderHook(() => useYandexPilotPolling(false, refresh))
    await act(() => vi.advanceTimersByTimeAsync(YANDEX_PILOT_POLL_INTERVAL_MS * 2))
    expect(refresh).not.toHaveBeenCalled()
  })
})
