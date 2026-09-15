import { afterEach, expect, it, vi } from 'vitest'
import { isAssistantProgramPilotEnabled } from './feature-flags'
afterEach(() => vi.unstubAllEnvs())
it('requires an independent enabled flag and exactly one matching actor', () => {
  vi.stubEnv('VITE_ASSISTANT_PROGRAM_PILOT_USER_IDS', 'trainer')
  vi.stubEnv('VITE_ASSISTANT_PROGRAM_ENABLED', '')
  expect(isAssistantProgramPilotEnabled('trainer')).toBe(false)
  vi.stubEnv('VITE_ASSISTANT_PROGRAM_ENABLED', 'true')
  expect(isAssistantProgramPilotEnabled('trainer')).toBe(true)
  expect(isAssistantProgramPilotEnabled('other')).toBe(false)
  vi.stubEnv('VITE_ASSISTANT_PROGRAM_PILOT_USER_IDS', 'trainer,other')
  expect(isAssistantProgramPilotEnabled('trainer')).toBe(false)
})
