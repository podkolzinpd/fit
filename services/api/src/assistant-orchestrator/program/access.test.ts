import { afterEach, expect, it, vi } from 'vitest'
import { isProgramPilotEnabled } from './model.js'
import { handler } from '../../yandex-program-generator-function.js'
afterEach(() => vi.unstubAllEnvs())
it('denies direct generation with a different actor or an empty/broad allowlist', async () => {
  vi.stubEnv('ASSISTANT_PROGRAM_ENABLED', 'true')
  vi.stubEnv('ASSISTANT_PROGRAM_PILOT_USER_IDS', 'trainer')
  expect(isProgramPilotEnabled('trainer')).toBe(true)
  expect((await handler({ httpMethod: 'POST', body: JSON.stringify({ actorId: 'other' }) })).statusCode).toBe(403)
  vi.stubEnv('ASSISTANT_PROGRAM_PILOT_USER_IDS', 'trainer,other')
  expect(isProgramPilotEnabled('trainer')).toBe(false)
  vi.stubEnv('ASSISTANT_PROGRAM_PILOT_USER_IDS', '')
  expect(isProgramPilotEnabled('trainer')).toBe(false)
  vi.stubEnv('ASSISTANT_PROGRAM_ENABLED', 'false')
  expect(isProgramPilotEnabled('trainer')).toBe(false)
})
