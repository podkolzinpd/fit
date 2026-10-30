import { expect, it, vi } from 'vitest'
import { dayBookingTime } from './QuickDayBooking'

it('resolves a scrolled slot in both densities without accepting the hour gutter or outside the grid', () => {
  document.body.innerHTML = '<div class="schedule-v2-timeline"><div class="day-grid"><span class="day-grid-hour-line"></span></div></div>'
  const grid = document.querySelector<HTMLElement>('.day-grid')!
  const line = grid.firstElementChild!
  for (const height of [48, 64]) {
    const top = -9 * height
    vi.spyOn(grid, 'getBoundingClientRect').mockReturnValue({ left: 20, right: 390, top } as DOMRect)
    vi.spyOn(line, 'getBoundingClientRect').mockReturnValue({ left: 76 } as DOMRect)
    expect(dayBookingTime(grid, 180, top + 14.5 * height, height)).toBe('14:30')
    expect(dayBookingTime(grid, 30, top + 14.5 * height, height)).toBeNull()
    expect(dayBookingTime(grid, 180, top + 24 * height, height)).toBeNull()
  }
  vi.restoreAllMocks()
})
