import { afterEach, expect, it, vi } from 'vitest'
import { isAssistantProgramEnabled } from './feature-flags'
afterEach(() => vi.unstubAllEnvs())
it('enables every signed-in account when the kill switch is on', () => {
  vi.stubEnv('VITE_ASSISTANT_PROGRAM_ENABLED', 'true')
  expect(isAssistantProgramEnabled('signed-in-account')).toBe(true)
  expect(isAssistantProgramEnabled('')).toBe(false)
  expect(isAssistantProgramEnabled('   ')).toBe(false)
})
it.each(['', 'false'])('keeps the independent kill switch: %s', (enabled) => {
  vi.stubEnv('VITE_ASSISTANT_PROGRAM_ENABLED', enabled)
  expect(isAssistantProgramEnabled('trainer')).toBe(false)
})
