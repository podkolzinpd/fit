import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { createSignedUrl } = vi.hoisted(() => ({
  createSignedUrl: vi.fn(),
}))

vi.mock('../../app/data-backend-context', () => ({
  useDataBackend: () => ({ exercises: { createVitalMediaUrl: createSignedUrl } }),
}))

import { useVitalMediaUrl } from './vitalMedia'

describe('useVitalMediaUrl', () => {
  afterEach(() => {
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

  it('falls back silently when signing fails', async () => {
    vi.stubEnv('MODE', 'production')
    vi.stubEnv('VITE_SUPABASE_URL', 'https://project.supabase.co')
    createSignedUrl.mockRejectedValue(new Error('denied'))

    const { result } = renderHook(() => useVitalMediaUrl('/exercises/vital-pro/missing.mp4'))
    await waitFor(() => expect(createSignedUrl).toHaveBeenCalled())
    expect(result.current).toBeUndefined()
  })
})
