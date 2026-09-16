import { afterEach, expect, it, vi } from 'vitest'
import { isAssistantProgramEnabled } from './feature-flags'
afterEach(() => vi.unstubAllEnvs())
it('enables every signed-in trainer independently of the obsolete pilot list', () => {
  vi.stubEnv('VITE_ASSISTANT_PROGRAM_ENABLED', 'true')
  vi.stubEnv('VITE_ASSISTANT_PROGRAM_PILOT_USER_IDS', 'old-pilot')
  expect(isAssistantProgramEnabled('old-pilot')).toBe(true)
  expect(isAssistantProgramEnabled('another-trainer')).toBe(true)
  expect(isAssistantProgramEnabled('')).toBe(false)
  expect(isAssistantProgramEnabled('   ')).toBe(false)
})
it.each(['', 'false'])('keeps the independent kill switch: %s', (enabled) => {
  vi.stubEnv('VITE_ASSISTANT_PROGRAM_ENABLED', enabled)
  expect(isAssistantProgramEnabled('trainer')).toBe(false)
})
