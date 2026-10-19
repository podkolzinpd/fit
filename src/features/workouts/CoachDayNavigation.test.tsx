import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { localDate, type LocalDate } from '../../shared/local-date'
import { CoachDayHeading, useCoachDaySwipe } from './CoachDayNavigation'

beforeEach(() => {
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => false)
  HTMLElement.prototype.setPointerCapture = vi.fn()
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })))
})
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })
function pointer(target: Element, type: string, x: number, y = 100, primary = true, id = 1) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y })
  Object.defineProperties(event, { pointerId: { value: id }, isPrimary: { value: primary } })
  fireEvent(target, event)
}
function Surface({ enabled = true, open = vi.fn() }: { enabled?: boolean; open?: (date: LocalDate) => void }) {
  const ref = useCoachDaySwipe(enabled, localDate('2026-12-31'), open)
  return <div className="schedule-day-view"><header ref={ref}><span className="coach-day-heading">Дата</span></header><main data-testid="space">Пустое место</main><button>Календарь</button><a href="/workouts/id">Тренировка</a></div>
}
function swipe(target: Element, from = 220, to = 80, dy = 0) {
  pointer(target, 'pointerdown', from)
  pointer(target, 'pointermove', to, 100 + dy)
  pointer(target, 'pointerup', to, 100 + dy)
}
it('navigates exactly one local day and supports fast reversal over the year boundary', () => {
  const open = vi.fn<(date: LocalDate) => void>()
  render(<Surface open={open} />)
  const space = screen.getByTestId('space')
  swipe(space); swipe(space); swipe(space, 80, 220)
  expect(open.mock.calls.map(call => call[0])).toEqual(['2027-01-01', '2027-01-02', '2027-01-01'])
})
it('preserves vertical/short/cancelled gestures, edge Back and interactive controls', () => {
  const open = vi.fn()
  const { rerender } = render(<Surface open={open} />)
  const space = screen.getByTestId('space')
  swipe(space, 100, 120); swipe(space, 220, 180, 160); swipe(space, 20, 180)
  swipe(screen.getByRole('button')); swipe(screen.getByRole('link'))
  pointer(space, 'pointerdown', 220); pointer(space, 'pointermove', 80); pointer(space, 'pointercancel', 80); pointer(space, 'pointerup', 80)
  pointer(space, 'pointerdown', 220, 100, false); pointer(space, 'pointermove', 80); pointer(space, 'pointerup', 80)
  expect(open).not.toHaveBeenCalled()
  const selection = window.getSelection()!, range = document.createRange()
  range.selectNodeContents(screen.getByText('Дата')); selection.addRange(range)
  swipe(space)
  expect(open).toHaveBeenCalledExactlyOnceWith('2027-01-01')
  open.mockClear()
  selection.removeAllRanges(); range.selectNodeContents(space); selection.addRange(range)
  swipe(space)
  expect(open).not.toHaveBeenCalled()
  selection.removeAllRanges()
  rerender(<Surface enabled={false} open={open} />)
  swipe(space)
  expect(open).not.toHaveBeenCalled()
})
it('retains touch capture handoff but cancels a real matching root capture loss', () => {
  const open = vi.fn<(date: LocalDate) => void>()
  render(<Surface open={open} />)
  const child = screen.getByTestId('space'), root = child.closest('.schedule-day-view')!
  pointer(child, 'pointerdown', 220); pointer(child, 'pointermove', 80)
  pointer(child, 'lostpointercapture', 80); pointer(root, 'pointerup', 80)
  expect(open).toHaveBeenCalledExactlyOnceWith('2027-01-01')
  pointer(child, 'pointerdown', 220); pointer(child, 'pointermove', 80)
  pointer(root, 'lostpointercapture', 80); pointer(root, 'pointerup', 80)
  expect(open).toHaveBeenCalledTimes(1)
  pointer(child, 'pointerdown', 220); pointer(child, 'pointermove', 80)
  pointer(root, 'lostpointercapture', 80, 100, true, 99); pointer(root, 'pointerup', 80)
  expect(open).toHaveBeenLastCalledWith('2027-01-02')
})
it('keeps one accessible date, replaces the outgoing label on reversal and honors reduced motion', () => {
  vi.useFakeTimers()
  const labels = (date: string) => ({ date: localDate(date), title: date, weekday: 'воскресенье' })
  const { container, rerender } = render(<CoachDayHeading {...labels('2026-10-18')} />)
  rerender(<CoachDayHeading {...labels('2026-10-19')} />)
  expect(screen.getAllByRole('heading')).toHaveLength(1)
  expect(container.querySelector('[aria-hidden]')).toHaveTextContent('2026-10-18')
  rerender(<CoachDayHeading {...labels('2026-10-18')} />)
  expect(container.firstChild).toHaveAttribute('data-direction', 'previous')
  expect(container.querySelector('[aria-hidden]')).toHaveTextContent('2026-10-19')
  act(() => vi.advanceTimersByTime(220))
  expect(container.querySelector('[aria-hidden]')).toBeNull()
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })))
  rerender(<CoachDayHeading {...labels('2026-10-19')} />)
  expect(container.querySelector('[aria-hidden]')).toBeNull()
  expect(screen.getByRole('heading')).toHaveTextContent('2026-10-19')
})
