import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readScheduleScroll, writeScheduleScroll } from './schedule-scroll'

describe('pilot calendar scroll', () => {
  beforeEach(() => sessionStorage.clear())
  it('keeps actor/day/filter positions separate', () => {
    writeScheduleScroll('actor-a:2026-09-24:all', 12.5)
    expect(readScheduleScroll('actor-a:2026-09-24:all')).toBe(12.5)
    expect(readScheduleScroll('actor-b:2026-09-24:all')).toBeNull()
    expect(readScheduleScroll('actor-a:2026-09-25:all')).toBeNull()
  })
  it('ignores invalid storage and remains usable when unavailable', () => {
    writeScheduleScroll('a', NaN)
    expect(readScheduleScroll('a')).toBeNull()
    sessionStorage.setItem('fit.lime-calendar-scroll.a', '-1')
    expect(readScheduleScroll('a')).toBeNull()
    const fail = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
    expect(() => writeScheduleScroll('a', 10)).not.toThrow()
    fail.mockRestore()
  })
})
