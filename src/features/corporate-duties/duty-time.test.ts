import {expect,it} from 'vitest'
import {dutyDuration,dutyLocalInput,dutyMoment} from './duty-time'
it('rounds down only the aggregate display, not every recorded shift',()=>{
 expect(dutyDuration(59.99)).toBe('0 ч 0 мин');expect(dutyDuration(119.98)).toBe('0 ч 1 мин');expect(dutyDuration(90001)).toBe('25 ч 0 мин')
})
it('formats in stored office timezone independent of the device and preserves the local date',()=>{
 expect(dutyLocalInput('2026-10-31T22:30:45Z','Europe/Moscow')).toBe('2026-11-01T01:30')
 expect(dutyLocalInput('2026-11-01T06:30:00Z','America/New_York')).toBe('2026-11-01T01:30')
 expect(dutyMoment('2026-10-31T22:30:00Z','Europe/Moscow')).toContain('01.11.2026')
})
