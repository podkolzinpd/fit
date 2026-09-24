import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { createSignedUrl } = vi.hoisted(() => ({
  createSignedUrl: vi.fn(),
}))
const backend = vi.hoisted(() => ({ source: 'supabase' as 'supabase' | 'yandex' }))

vi.mock('../../app/data-backend-context', () => ({
  useDataBackend: () => ({ source: backend.source, exercises: { createVitalMediaUrl: createSignedUrl } }),
}))

import { useVitalMediaUrl } from './vitalMedia'

describe('useVitalMediaUrl', () => {
  afterEach(() => {
    backend.source = 'supabase'
    createSignedUrl.mockReset()
    vi.unstubAllEnvs()
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
})
