import { describe, expect, it } from 'vitest'
import { serviceInstant, servicePeriod } from './service-time'

describe('corporate service account time', () => {
  it('uses account day and Monday week across the UTC boundary and Sunday', () => {
    expect(servicePeriod('Europe/Moscow', 'today', new Date('2026-11-01T22:00:00Z'))).toEqual({ from: '2026-11-02', until: '2026-11-03' })
    expect(servicePeriod('Europe/Moscow', 'week', new Date('2026-11-01T12:00:00Z'))).toEqual({ from: '2026-10-26', until: '2026-11-02' })
    expect(servicePeriod('Europe/Moscow', 'week', new Date('2026-11-02T12:00:00Z'))).toEqual({ from: '2026-11-02', until: '2026-11-03' })
  })
  it('resolves account wall time independently from device time, including fractional offsets', () => {
    expect(serviceInstant('2026-11-02', '10:30', 'Europe/Moscow')).toBe('2026-11-02T07:30:00.000Z')
    expect(serviceInstant('2026-11-02', '10:30', 'Asia/Kathmandu')).toBe('2026-11-02T04:45:00.000Z')
    expect(serviceInstant('2026-07-02', '10:30', 'America/New_York')).toBe('2026-07-02T14:30:00.000Z')
  })
  it('rejects absent and ambiguous DST time while preserving an unchanged original instant', () => {
    expect(() => serviceInstant('2026-03-08', '02:30', 'America/New_York')).toThrow('переводе часов')
    expect(() => serviceInstant('2026-11-01', '01:30', 'America/New_York')).toThrow('переводе часов')
    for (const at of ['2026-11-01T05:30:42Z', '2026-11-01T06:30:13Z']) expect(serviceInstant('2026-11-01', '01:30', 'America/New_York', at)).toBe(at)
    expect(() => serviceInstant('2026-02-30', '10:00', 'Europe/Moscow')).toThrow()
    expect(() => serviceInstant('2026-11-02', '24:00', 'Europe/Moscow')).toThrow()
    expect(() => serviceInstant('2026-11-02', '10:00', 'invalid/zone')).toThrow()
  })
})
