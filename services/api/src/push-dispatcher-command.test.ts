import { describe, expect, it, vi } from 'vitest'
import type { QueryResultRow } from 'pg'
import { enqueueWorkoutReminders } from './push-dispatcher-command.js'

describe('reminder producer timezone diagnostics', () => {
  const client = (result: unknown) => ({
    query: <Row extends QueryResultRow>(): Promise<readonly Row[]> =>
      Promise.resolve([{ result }] as unknown as readonly Row[]),
  })
  it('preserves the integer result and reports only the invalid-profile count', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      expect(await enqueueWorkoutReminders(client({ enqueued: 2, invalidTimezoneProfiles: 1,
        timezone: 'private-zone', userId: 'private-user' }), new Date())).toBe(2)
      expect(warn).toHaveBeenCalledExactlyOnceWith(JSON.stringify({ event: 'background_push_invalid_timezone_profiles', count: 1 }))
      expect(JSON.stringify(warn.mock.calls)).not.toContain('private-')
    } finally { warn.mockRestore() }
  })
  it('does not warn when every eligible timezone is valid', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      expect(await enqueueWorkoutReminders(client({ enqueued: 0, invalidTimezoneProfiles: 0 }), new Date())).toBe(0)
      expect(warn).not.toHaveBeenCalled()
    } finally { warn.mockRestore() }
  })
  it.each([null, [], 2, {}, { enqueued: -1, invalidTimezoneProfiles: 0 },
    { enqueued: 1, invalidTimezoneProfiles: 'private' }, { enqueued: 0, invalidTimezoneProfiles: 1.5 }])(
    'rejects malformed producer metadata instead of hiding an unexpected database result', async result => {
      await expect(enqueueWorkoutReminders(client(result), new Date())).rejects.toThrow(/Reminder/)
    })
})
