import { afterEach, expect, it, vi } from 'vitest'
import { isProgramEnabled } from './model.js'
import { handler } from '../../yandex-program-generator-function.js'
afterEach(() => vi.unstubAllEnvs())
it('enables non-pilot actors after authorization by the orchestrator', () => {
  vi.stubEnv('ASSISTANT_PROGRAM_ENABLED', 'true')
  vi.stubEnv('ASSISTANT_PROGRAM_PILOT_USER_IDS', 'old-pilot')
  expect(isProgramEnabled('old-pilot')).toBe(true)
  expect(isProgramEnabled('another-trainer')).toBe(true)
  expect(isProgramEnabled('')).toBe(false)
  expect(isProgramEnabled('   ')).toBe(false)
})
it.each(['', 'false'])('blocks private generator calls while disabled: %s', async (enabled) => {
  vi.stubEnv('ASSISTANT_PROGRAM_ENABLED', enabled)
  expect(isProgramEnabled('trainer')).toBe(false)
  expect((await handler({ httpMethod: 'POST', body: JSON.stringify({ actorId: 'trainer' }) })).statusCode).toBe(403)
})
