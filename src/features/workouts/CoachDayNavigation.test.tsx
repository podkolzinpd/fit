import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Workout } from '../../shared/domain'
import { localDate, type LocalDate } from '../../shared/local-date'
import { CoachDayHeading, useCoachDaySwipe, type DaySlotTap, type DayCardDrag } from './CoachDayNavigation'

beforeEach(() => {
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => false)
  HTMLElement.prototype.setPointerCapture = vi.fn()
  HTMLElement.prototype.releasePointerCapture = vi.fn()
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })))
})
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })
function pointer(target: Element, type: string, x: number, y = 100, primary = true, id = 1) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y })
  Object.defineProperties(event, { pointerId: { value: id }, isPrimary: { value: primary } })
  fireEvent(target, event)
}
function Surface({ enabled = true, open = vi.fn(), tap, drag }: { enabled?: boolean; open?: (date: LocalDate) => void; tap?: DaySlotTap; drag?: DayCardDrag }) {
  const ref = useCoachDaySwipe(enabled, localDate('2026-12-31'), open, tap, drag)
  return <div className="schedule-day-view"><header ref={ref}><span className="coach-day-heading">Дата</span></header><main data-testid="space" className="schedule-v2-timeline">Пустое место<a className="schedule-v2-event" data-testid="card" href="/workouts/card"><b>Имя спортсмена</b><time>10:00</time><span>План</span></a></main><button>Календарь</button><a href="/workouts/id">Тренировка</a></div>
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
  swipe(screen.getByRole('button')); swipe(screen.getByRole('link', { name: 'Тренировка' }))
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

it('opens one booking on release and gives scroll, inertia, swipe, cancellation and hold priority', () => {
  let now = 1000
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  const book = vi.fn(), open = vi.fn()
  render(<Surface open={open} tap={{ resolve: () => '14:00', open: book }} />)
  const space = screen.getByTestId('space')
  const tap = () => { pointer(space, 'pointerdown', 180); pointer(space, 'pointerup', 182) }
  pointer(space, 'pointerdown', 180)
  expect(book).not.toHaveBeenCalled()
  pointer(space, 'pointerup', 182)
  expect(book).toHaveBeenCalledExactlyOnceWith('14:00')
  fireEvent.click(space)
  expect(book).toHaveBeenCalledTimes(1)
  book.mockClear()
  pointer(space, 'pointerdown', 180); pointer(space, 'pointermove', 200); pointer(space, 'pointermove', 180); pointer(space, 'pointerup', 180)
  pointer(space, 'pointerdown', 180); space.scrollTop = 2; fireEvent.scroll(space); pointer(space, 'pointerup', 180)
  tap() // Contact stopping the scroll cannot turn into a tap.
  now += 201
  pointer(space, 'pointerdown', 180); now += 451; pointer(space, 'pointerup', 180)
  pointer(space, 'pointerdown', 180); pointer(space, 'pointercancel', 180); pointer(space, 'pointerup', 180)
  pointer(space, 'pointerdown', 180); pointer(space, 'pointerdown', 180, 100, false, 2); pointer(space, 'pointerup', 180)
  swipe(space)
  expect(open).toHaveBeenCalledTimes(1)
  expect(book).not.toHaveBeenCalled()
  tap()
  expect(book).toHaveBeenCalledTimes(1)
  vi.restoreAllMocks()
})

it('blocks a booking when scroll position changes before its queued scroll event', () => {
  let now = 1000
  const clock = vi.spyOn(performance, 'now').mockImplementation(() => now)
  try {
    const book = vi.fn()
    render(<Surface tap={{ resolve: () => '14:00', open: book }} />)
    const space = screen.getByTestId('space')
    const tap = () => { pointer(space, 'pointerdown', 180); pointer(space, 'pointerup', 180) }
    // WebKit can update the position before delivering the scroll notification.
    space.scrollTop = 1
    tap()
    expect(book).not.toHaveBeenCalled()
    now += 201
    tap()
    expect(book).toHaveBeenCalledExactlyOnceWith('14:00')
    book.mockClear()
    pointer(space, 'pointerdown', 180)
    space.scrollTop = 2
    pointer(space, 'pointerup', 180)
    tap()
    expect(book).not.toHaveBeenCalled()
    now += 201
    tap()
    expect(book).toHaveBeenCalledTimes(1)
    book.mockClear()
    space.scrollLeft = 1
    tap()
    expect(book).not.toHaveBeenCalled()
  } finally {
    clock.mockRestore()
  }
})

const cardWorkout = { id: 'card', workoutDate: localDate('2026-12-31'), startTime: '10:00', endTime: '11:00', version: 1 } as Workout
function cardControls() {
  return { hourHeight: 60, resolve: () => cardWorkout, preview: vi.fn(), drop: vi.fn() }
}
it('accepts a short directional flick from card text and suppresses its accidental click', () => {
  const open = vi.fn(), book = vi.fn()
  render(<Surface open={open} tap={{ resolve: () => '10:00', open: book }} drag={cardControls()} />)
  const name = screen.getByText('Имя спортсмена'), card = screen.getByTestId('card')
  swipe(name, 180, 144)
  expect(open).toHaveBeenCalledExactlyOnceWith('2027-01-01')
  const click = new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 })
  fireEvent(card, click)
  expect(click.defaultPrevented).toBe(true)
  expect(book).not.toHaveBeenCalled()
})
it.each(['Имя спортсмена', '10:00', 'План'])('holds the entire card at %s and drops one preserved interval', text => {
  vi.useFakeTimers()
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  const drag = cardControls(), open = vi.fn()
  render(<Surface open={open} drag={drag} />)
  const target = screen.getByText(text)
  pointer(target, 'pointerdown', 180)
  act(() => vi.advanceTimersByTime(419))
  expect(drag.preview).not.toHaveBeenCalled()
  act(() => vi.advanceTimersByTime(1))
  expect(drag.preview).toHaveBeenLastCalledWith({ workout: cardWorkout, slot: { workoutDate: '2026-12-31', startTime: '10:00', endTime: '11:00' } })
  pointer(target, 'pointermove', 180, 160)
  pointer(target, 'pointerup', 180, 160)
  expect(drag.drop).toHaveBeenCalledExactlyOnceWith(cardWorkout, { workoutDate: '2026-12-31', startTime: '11:00', endTime: '12:00' })
  expect(drag.preview).toHaveBeenLastCalledWith(null)
  expect(open).not.toHaveBeenCalled()
})
it('gives early vertical motion, outside release and cancel priority over hold', () => {
  vi.useFakeTimers()
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  const drag = cardControls()
  render(<Surface drag={drag} />)
  const target = screen.getByTestId('card')
  pointer(target, 'pointerdown', 180); pointer(target, 'pointermove', 180, 125)
  act(() => vi.advanceTimersByTime(500))
  expect(drag.preview).not.toHaveBeenCalled()
  pointer(target, 'pointerdown', 180); pointer(document.body, 'pointerup', 180)
  act(() => vi.advanceTimersByTime(500))
  expect(drag.preview).not.toHaveBeenCalled()
  pointer(target, 'pointerdown', 180)
  act(() => vi.advanceTimersByTime(420))
  pointer(target, 'pointermove', 180, 160); pointer(target, 'pointercancel', 180, 160); pointer(target, 'pointerup', 180, 160)
  expect(drag.preview).toHaveBeenLastCalledWith(null)
  expect(drag.drop).not.toHaveBeenCalled()
})

it('does not auto-scroll a held edge card before it is actually moved', () => {
  vi.useFakeTimers()
  let frame: FrameRequestCallback = () => undefined
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => { frame = callback; return 1 }))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  const drag = cardControls()
  render(<Surface drag={drag} />)
  const space = screen.getByTestId('space'), card = screen.getByTestId('card')
  Object.defineProperties(space, { scrollHeight: { value: 2000 }, clientHeight: { value: 500 } })
  vi.spyOn(space, 'getBoundingClientRect').mockReturnValue({ top: 0, bottom: 500 } as DOMRect)
  space.scrollTop = 500
  pointer(card, 'pointerdown', 180, 20)
  act(() => vi.advanceTimersByTime(420))
  act(() => frame(16))
  expect(space.scrollTop).toBe(500)
  pointer(card, 'pointermove', 180, 10)
  act(() => frame(32))
  expect(space.scrollTop).toBe(492)
  pointer(card, 'pointercancel', 180, 10)
  expect(drag.drop).not.toHaveBeenCalled()
})

it.each([['23:00', '01:00', '22:00', '00:00'], ['10:00', null, '09:00', null]])('preserves overnight or unknown duration during a drag from %s', (startTime, endTime, nextStart, nextEnd) => {
  vi.useFakeTimers()
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  const workout = { ...cardWorkout, startTime, endTime }, drag = { ...cardControls(), resolve: () => workout }
  render(<Surface drag={drag} />)
  const target = screen.getByTestId('card')
  pointer(target, 'pointerdown', 180)
  act(() => vi.advanceTimersByTime(420))
  pointer(target, 'pointermove', 180, 40); pointer(target, 'pointerup', 180, 40)
  expect(drag.drop).toHaveBeenCalledExactlyOnceWith(workout, { workoutDate: '2026-12-31', startTime: nextStart, endTime: nextEnd })
})
