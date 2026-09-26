import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { createSignedUrl } = vi.hoisted(() => ({
  createSignedUrl: vi.fn(),
}))
const backend = vi.hoisted(() => ({ source: 'supabase' as 'supabase' | 'yandex' }))

vi.mock('../../app/data-backend-context', () => ({
  useDataBackend: () => ({ source: backend.source, exercises: { createVitalMediaUrl: createSignedUrl } }),
}))

import { useVitalMediaState, useVitalMediaUrl } from './vitalMedia'

describe('useVitalMediaUrl', () => {
  afterEach(() => {
    cleanup()
    backend.source = 'supabase'
    createSignedUrl.mockReset()
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    vi.useRealTimers()
  })

  it('keeps ordinary assets unchanged', () => {
    const { result } = renderHook(() => useVitalMediaUrl('/exercises/free/squat.jpg'))
    expect(result.current).toBe('/exercises/free/squat.jpg')
    expect(createSignedUrl).not.toHaveBeenCalled()
  })

  it('keeps Gym Pro paths local in tests', () => {
    const { result } = renderHook(() => useVitalMediaUrl('/exercises/vital-pro/squat.mp4'))
    expect(result.current).toBe('/exercises/vital-pro/squat.mp4')
    expect(createSignedUrl).not.toHaveBeenCalled()
  })

  it('retries a failed public file once with the same path and a fresh cache key', async () => {
    const { result } = renderHook(() => useVitalMediaState('/exercises/vital/stationary-bike-end.jpg'))
    expect(result.current.url).toBe('/exercises/vital/stationary-bike-end.jpg')
    act(() => { expect(result.current.retry(new URL(result.current.url!, window.location.href).href)).toBe(true) })
    expect(result.current.url).toMatch(/^\/exercises\/vital\/stationary-bike-end.jpg\?fit-media-retry=\d+-1$/)
    const retried = result.current.url
    act(() => { expect(result.current.retry(result.current.url)).toBe(false) })
    expect(result.current.url).toBe(retried)
    await act(async () => { window.dispatchEvent(new Event('online')); await Promise.resolve() })
    expect(result.current.url).toMatch(/fit-media-retry=\d+-2$/)
    act(() => { expect(result.current.retry(result.current.url)).toBe(false) })
    await act(async () => { window.dispatchEvent(new Event('online')); await Promise.resolve() })
    expect(result.current.url).toMatch(/fit-media-retry=\d+-2$/)
    expect(createSignedUrl).not.toHaveBeenCalled()
  })

  it('does not retry public files while the app is hidden or the media is disabled', async () => {
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    const { result, rerender } = renderHook(
      ({ enabled }) => useVitalMediaState('/exercises/vital/leg-press-machine-end.jpg', enabled),
      { initialProps: { enabled: true } },
    )
    act(() => { expect(result.current.retry()).toBe(true) })
    expect(result.current.url).toBe('/exercises/vital/leg-press-machine-end.jpg')
    visibility.mockReturnValue('visible')
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); await Promise.resolve() })
    expect(result.current.url).toContain('?fit-media-retry=')
    rerender({ enabled: false })
    expect(result.current.retry()).toBe(false)
    expect(createSignedUrl).not.toHaveBeenCalled()
  })

  it('does not change arbitrary custom signed photo URLs', () => {
    const { result } = renderHook(() => useVitalMediaState('https://signed.example/custom.jpg?signature=fixture'))
    expect(result.current.retry()).toBe(false)
    expect(result.current.url).toBe('https://signed.example/custom.jpg?signature=fixture')
  })

  it('does not resolve disabled private media', () => {
    vi.stubEnv('MODE', 'production')
    vi.stubEnv('VITE_SUPABASE_URL', 'https://project.supabase.co')
    const { result } = renderHook(() => useVitalMediaUrl('/exercises/vital-pro/disabled.mp4', false))
    expect(result.current).toBeUndefined()
    expect(createSignedUrl).not.toHaveBeenCalled()
  })

  it('signs a production Gym Pro path for one hour', async () => {
    vi.stubEnv('MODE', 'production')
    vi.stubEnv('VITE_SUPABASE_URL', 'https://project.supabase.co')
    createSignedUrl.mockResolvedValue('https://signed.example/squat')

    const { result } = renderHook(() => useVitalMediaUrl('/exercises/vital-pro/squat.mp4'))
    await waitFor(() => expect(result.current).toBe('https://signed.example/squat'))
    expect(createSignedUrl).toHaveBeenCalledWith('vital-pro/squat.mp4', 3600)
  })

  it('signs Yandex Gym Pro media without Supabase environment variables', async () => {
    vi.stubEnv('MODE', 'production')
    vi.stubEnv('VITE_SUPABASE_URL', '')
    backend.source = 'yandex'
    createSignedUrl.mockResolvedValue('https://signed.example/yandex-squat')

    const { result } = renderHook(() => useVitalMediaUrl('/exercises/vital-pro/yandex-squat.mp4'))

    await waitFor(() => expect(result.current).toBe('https://signed.example/yandex-squat'))
    expect(createSignedUrl).toHaveBeenCalledWith('vital-pro/yandex-squat.mp4', 3600)
  })

  it('does not reuse a Supabase signed URL after the backend changes', async () => {
    vi.stubEnv('MODE', 'production')
    vi.stubEnv('VITE_SUPABASE_URL', 'https://project.supabase.co')
    createSignedUrl.mockResolvedValueOnce('https://signed.example/legacy')
      .mockResolvedValueOnce('https://signed.example/yandex')

    const { result, rerender } = renderHook(() => useVitalMediaUrl('/exercises/vital-pro/backend-switch.mp4'))
    await waitFor(() => expect(result.current).toBe('https://signed.example/legacy'))

    backend.source = 'yandex'
    rerender()

    await waitFor(() => expect(result.current).toBe('https://signed.example/yandex'))
    expect(createSignedUrl).toHaveBeenCalledTimes(2)
  })

  it('falls back silently when signing fails', async () => {
    vi.stubEnv('MODE', 'production')
    vi.stubEnv('VITE_SUPABASE_URL', 'https://project.supabase.co')
    createSignedUrl.mockRejectedValue(new Error('denied'))

    const { result } = renderHook(() => useVitalMediaUrl('/exercises/vital-pro/missing.mp4'))
    await waitFor(() => expect(createSignedUrl).toHaveBeenCalled())
    expect(result.current).toBeUndefined()
  })

  it('retries transient Yandex signing failures and keeps the recovered URL', async () => {
    vi.stubEnv('MODE', 'production')
    vi.stubEnv('VITE_SUPABASE_URL', '')
    backend.source = 'yandex'
    createSignedUrl.mockRejectedValueOnce(new Error('temporary'))
      .mockResolvedValueOnce('https://signed.example/recovered')

    const { result } = renderHook(() => useVitalMediaUrl('/exercises/vital-pro/recovered.jpg'))

    await waitFor(() => expect(result.current).toBe('https://signed.example/recovered'))
    expect(createSignedUrl).toHaveBeenCalledTimes(2)
  })

  it('exposes a terminal signing failure so the image can activate its fallback frame', async () => {
    vi.stubEnv('MODE', 'production')
    vi.stubEnv('VITE_SUPABASE_URL', '')
    backend.source = 'yandex'
    createSignedUrl.mockRejectedValue(new Error('temporary'))

    const { result } = renderHook(() => useVitalMediaState('/exercises/vital-pro/missing.jpg'))

    await waitFor(() => expect(result.current.status).toBe('error'), { timeout: 3_000 })
    expect(result.current.url).toBeUndefined()
    expect(createSignedUrl).toHaveBeenCalledTimes(3)
  })

  it('re-signs a failed image once, then lets the caller show its fallback', async () => {
    vi.stubEnv('MODE', 'production')
    backend.source = 'yandex'
    createSignedUrl.mockResolvedValueOnce('https://signed.example/failed-load-old')
      .mockResolvedValueOnce('https://signed.example/failed-load-new')
    const { result } = renderHook(() => useVitalMediaState('/exercises/vital-pro/failed-load.jpg'))
    await waitFor(() => expect(result.current.url).toBe('https://signed.example/failed-load-old'))

    await act(async () => { expect(result.current.retry(result.current.url)).toBe(true); await Promise.resolve() })
    expect(result.current.url).toBe('https://signed.example/failed-load-new')
    act(() => { expect(result.current.retry(result.current.url)).toBe(false) })
    expect(createSignedUrl).toHaveBeenCalledTimes(2)
  })

  it('deduplicates simultaneous recovery of the same media in two mounted cards', async () => {
    vi.stubEnv('MODE', 'production')
    backend.source = 'yandex'
    createSignedUrl.mockResolvedValueOnce('https://signed.example/shared-old')
      .mockResolvedValueOnce('https://signed.example/shared-new')
    const first = renderHook(() => useVitalMediaState('/exercises/vital-pro/shared-recovery.jpg'))
    const second = renderHook(() => useVitalMediaState('/exercises/vital-pro/shared-recovery.jpg'))
    await waitFor(() => expect(second.result.current.url).toBe('https://signed.example/shared-old'))

    await act(async () => {
      expect(first.result.current.retry('https://signed.example/shared-old')).toBe(true)
      expect(second.result.current.retry('https://signed.example/shared-old')).toBe(true)
      await Promise.resolve()
    })
    expect(first.result.current.url).toBe('https://signed.example/shared-new')
    expect(second.result.current.url).toBe('https://signed.example/shared-new')
    expect(createSignedUrl).toHaveBeenCalledTimes(2)
  })

  it('refreshes mounted media at the shared cache expiry, including an older cached URL', async () => {
    vi.useFakeTimers()
    vi.stubEnv('MODE', 'production')
    backend.source = 'yandex'
    createSignedUrl.mockResolvedValueOnce('https://signed.example/expiry-old')
      .mockResolvedValueOnce('https://signed.example/expiry-new')
    const first = renderHook(() => useVitalMediaState('/exercises/vital-pro/mounted-expiry.jpg'))
    await act(async () => {})
    expect(first.result.current.url).toBe('https://signed.example/expiry-old')
    first.unmount()

    await act(async () => { await vi.advanceTimersByTimeAsync(49 * 60 * 1_000) })
    const second = renderHook(() => useVitalMediaState('/exercises/vital-pro/mounted-expiry.jpg'))
    await act(async () => {})
    expect(second.result.current.url).toBe('https://signed.example/expiry-old')
    expect(createSignedUrl).toHaveBeenCalledTimes(1)

    await act(async () => { await vi.advanceTimersByTimeAsync(60 * 1_000) })
    expect(second.result.current.url).toBe('https://signed.example/expiry-new')
    expect(createSignedUrl).toHaveBeenCalledTimes(2)
  })

  it('defers hidden media and refreshes expired URLs when the app becomes visible', async () => {
    vi.useFakeTimers()
    vi.stubEnv('MODE', 'production')
    backend.source = 'yandex'
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    createSignedUrl.mockResolvedValueOnce('https://signed.example/resume-old')
      .mockResolvedValueOnce('https://signed.example/resume-new')
    const { result } = renderHook(() => useVitalMediaState('/exercises/vital-pro/resume-expiry.jpg'))
    await act(async () => {})
    expect(createSignedUrl).not.toHaveBeenCalled()

    visibility.mockReturnValue('visible')
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); await Promise.resolve() })
    expect(result.current.url).toBe('https://signed.example/resume-old')
    visibility.mockReturnValue('hidden')
    await act(async () => { await vi.advanceTimersByTimeAsync(61 * 60 * 1_000) })
    expect(createSignedUrl).toHaveBeenCalledTimes(1)

    visibility.mockReturnValue('visible')
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); await Promise.resolve() })
    expect(result.current.url).toBe('https://signed.example/resume-new')
    expect(createSignedUrl).toHaveBeenCalledTimes(2)
  })

  it('keeps the displayed URL when proactive renewal temporarily fails', async () => {
    vi.useFakeTimers()
    vi.stubEnv('MODE', 'production')
    backend.source = 'yandex'
    createSignedUrl.mockResolvedValueOnce('https://signed.example/renewal-old')
      .mockRejectedValue(new Error('temporary'))
    const { result } = renderHook(() => useVitalMediaState('/exercises/vital-pro/renewal-failure.jpg'))
    await act(async () => {})
    await act(async () => { await vi.advanceTimersByTimeAsync(50 * 60 * 1_000 + 2_000) })
    expect(createSignedUrl).toHaveBeenCalledTimes(4)
    expect(result.current).toMatchObject({ url: 'https://signed.example/renewal-old', status: 'ready' })
    createSignedUrl.mockResolvedValue('https://signed.example/renewal-new')
    await act(async () => { window.dispatchEvent(new Event('online')); await Promise.resolve() })
    expect(result.current.url).toBe('https://signed.example/renewal-new')
  })

  it('does not refresh healthy URLs on online or visibility events', async () => {
    vi.stubEnv('MODE', 'production')
    backend.source = 'yandex'
    createSignedUrl.mockResolvedValue('https://signed.example/healthy')
    const { result } = renderHook(() => useVitalMediaState('/exercises/vital-pro/healthy-events.jpg'))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
      window.dispatchEvent(new Event('online'))
      await Promise.resolve()
    })
    expect(createSignedUrl).toHaveBeenCalledTimes(1)
  })

  it('does not show a previous exercise when the next private source is deferred offline', async () => {
    vi.stubEnv('MODE', 'production')
    backend.source = 'yandex'
    createSignedUrl.mockResolvedValueOnce('https://signed.example/offline-first')
      .mockResolvedValueOnce('https://signed.example/offline-second')
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    const { result, rerender } = renderHook(({ source }) => useVitalMediaState(source), {
      initialProps: { source: '/exercises/vital-pro/offline-first.jpg' },
    })
    await waitFor(() => expect(result.current.url).toBe('https://signed.example/offline-first'))
    online.mockReturnValue(false)
    rerender({ source: '/exercises/vital-pro/offline-second.jpg' })
    expect(result.current).toMatchObject({ url: undefined, status: 'loading' })
    expect(createSignedUrl).toHaveBeenCalledTimes(1)
    online.mockReturnValue(true)
    await act(async () => { window.dispatchEvent(new Event('online')); await Promise.resolve() })
    expect(result.current.url).toBe('https://signed.example/offline-second')
  })

  it('bounds terminal signing recovery to one resume attempt', async () => {
    vi.useFakeTimers()
    vi.stubEnv('MODE', 'production')
    backend.source = 'yandex'
    createSignedUrl.mockRejectedValue(new Error('denied'))
    const { result } = renderHook(() => useVitalMediaState('/exercises/vital-pro/terminal-resume.jpg'))
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000) })
    expect(result.current.status).toBe('error')
    expect(createSignedUrl).toHaveBeenCalledTimes(3)

    await act(async () => {
      window.dispatchEvent(new Event('online'))
      await vi.advanceTimersByTimeAsync(2_000)
    })
    expect(result.current.status).toBe('error')
    expect(createSignedUrl).toHaveBeenCalledTimes(6)
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
      window.dispatchEvent(new Event('online'))
      await vi.advanceTimersByTimeAsync(60 * 60 * 1_000)
    })
    expect(createSignedUrl).toHaveBeenCalledTimes(6)
  })

  it('cancels expiry refresh and resume listeners when disabled or unmounted', async () => {
    vi.useFakeTimers()
    vi.stubEnv('MODE', 'production')
    backend.source = 'yandex'
    createSignedUrl.mockResolvedValue('https://signed.example/disabled-expiry')
    const { result, rerender, unmount } = renderHook(
      ({ enabled }) => useVitalMediaState('/exercises/vital-pro/disabled-expiry.jpg', enabled),
      { initialProps: { enabled: true } },
    )
    await act(async () => {})
    expect(result.current.status).toBe('ready')
    rerender({ enabled: false })
    expect(result.current.status).toBe('idle')
    expect(result.current.retry()).toBe(false)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60 * 60 * 1_000)
      window.dispatchEvent(new Event('online'))
    })
    expect(createSignedUrl).toHaveBeenCalledTimes(1)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('ignores a completed signing request after the card was disabled', async () => {
    vi.useFakeTimers()
    vi.stubEnv('MODE', 'production')
    backend.source = 'yandex'
    let finishSigning: (url: string) => void = () => {}
    createSignedUrl.mockImplementation(() => new Promise<string>((resolve) => { finishSigning = resolve }))
    const { result, rerender } = renderHook(
      ({ enabled }) => useVitalMediaState('/exercises/vital-pro/disabled-pending.jpg', enabled),
      { initialProps: { enabled: true } },
    )
    await act(() => Promise.resolve())
    expect(createSignedUrl).toHaveBeenCalledOnce()
    rerender({ enabled: false })
    await act(async () => {
      finishSigning('https://signed.example/too-late')
      await Promise.resolve()
    })
    expect(result.current.url).toBeUndefined()
    expect(result.current.status).toBe('idle')
    expect(vi.getTimerCount()).toBe(0)
  })
})
