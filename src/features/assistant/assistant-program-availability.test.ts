import { afterEach, describe, expect, it, vi } from 'vitest'
import { isAssistantProgramSurfaceEnabled } from './assistant-program-availability'

afterEach(() => vi.unstubAllEnvs())

describe('assistant program surface availability', () => {
  it.each(['supabase', 'yandex'])('enables programs on the %s backend', (cacheKey) => {
    vi.stubEnv('VITE_ASSISTANT_PROGRAM_ENABLED', 'true')

    expect(isAssistantProgramSurfaceEnabled(cacheKey, 'client-account')).toBe(true)
  })

  it('keeps the kill switch and unknown backends closed', () => {
    vi.stubEnv('VITE_ASSISTANT_PROGRAM_ENABLED', 'false')
    expect(isAssistantProgramSurfaceEnabled('yandex', 'client-account')).toBe(false)

    vi.stubEnv('VITE_ASSISTANT_PROGRAM_ENABLED', 'true')
    expect(isAssistantProgramSurfaceEnabled('unknown', 'client-account')).toBe(false)
    expect(isAssistantProgramSurfaceEnabled('yandex')).toBe(false)
  })
})
