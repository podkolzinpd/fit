import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LiveRestTimer, formatRest, formatReferenceClock } from './LiveRestTimer'
import { playGong, prepareGong } from '../../shared/gong'
import { wasNativeRestTimerNotificationScheduled } from './rest-timer-notification'

vi.mock('../../shared/gong', () => ({ playGong: vi.fn(), prepareGong: vi.fn() }))
vi.mock('./rest-timer-notification', () => ({ wasNativeRestTimerNotificationScheduled: vi.fn(() => false) }))

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
  sessionStorage.clear()
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
})

describe('Live rest timer', () => {
  it('formats the reference digits without losing negative time or hours', () => {
    expect(formatReferenceClock(0)).toBe('00:00')
    expect(formatReferenceClock(3599)).toBe('59:59')
    expect(formatReferenceClock(3661)).toBe('1:01:01')
    expect(formatReferenceClock(-61)).toBe('−01:01')
  })

  it('keeps a single rest expiry and gong owner in the reference view', () => {
    vi.useFakeTimers()
    vi.setSystemTime(100_000)
    const onExpire = vi.fn(), onChange = vi.fn()
    const view = render(<LiveRestTimer workoutId="reference" deadline={101_000} referenceStartedAt={new Date(0).toISOString()} onChange={onChange} onRestExpire={onExpire} />)
    expect(screen.getByLabelText('Отдых: 00:01')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Таймер отдыха: 0:01' })).toHaveTextContent('Отдых 0:01')
    act(() => vi.advanceTimersByTime(2_000))
    expect(screen.getByLabelText('Тренировка: 01:42')).toBeVisible()
    expect(document.querySelector('.coach-live-clock')).not.toHaveClass('coach-live-clock-rest')
    expect(screen.getByRole('button', { name: 'Отдых превышен на 0:01' })).toHaveTextContent('Отдых −0:01')
    expect(playGong).toHaveBeenCalledTimes(1)
    expect(onExpire).toHaveBeenCalledTimes(1)
    expect(onChange).not.toHaveBeenCalled()
    view.rerender(<LiveRestTimer workoutId="reference" deadline={null} referenceStartedAt={new Date(0).toISOString()} onChange={onChange} />)
    expect(screen.getByLabelText('Тренировка: 01:42')).toBeVisible()
    act(() => vi.advanceTimersByTime(1_000))
    expect(screen.getByLabelText('Тренировка: 01:43')).toBeVisible()
  })

  it('counts through zero into negative time and plays the gong exactly once', () => {
    vi.useFakeTimers()
    vi.setSystemTime(100_000)
    const onChange = vi.fn()
    render(<LiveRestTimer workoutId="workout-1" deadline={101_000} onChange={onChange} />)

    expect(screen.getByRole('button', { name: 'Таймер отдыха: 0:01' })).toBeVisible()
    act(() => vi.advanceTimersByTime(1_000))
    expect(screen.getByRole('button', { name: 'Отдых превышен на 0:00' })).toHaveClass('rest-overdue')
    expect(playGong).toHaveBeenCalledTimes(1)
    expect(onChange).not.toHaveBeenCalled()

    act(() => vi.advanceTimersByTime(1_000))
    expect(screen.getByRole('button', { name: 'Отдых превышен на 0:01' })).toHaveTextContent('Отдых −0:01')
    expect(playGong).toHaveBeenCalledTimes(1)
  })

  it('switches the reference clock and header at zero while the button keeps its deadline', () => {
    vi.useFakeTimers()
    vi.setSystemTime(100_000)
    const onChange = vi.fn(), onActive = vi.fn()
    const view = render(<LiveRestTimer workoutId="reference-boundary" deadline={101_000}
      referenceStartedAt={new Date(0).toISOString()} onChange={onChange} onReferenceRestActiveChange={onActive} />)
    expect(onActive).toHaveBeenLastCalledWith(true)
    act(() => vi.advanceTimersByTime(1_000))
    expect(screen.getByLabelText('Тренировка: 01:41')).toBeVisible()
    expect(onActive).toHaveBeenLastCalledWith(false)
    act(() => vi.advanceTimersByTime(15_000))
    expect(screen.getByLabelText('Тренировка: 01:56')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Отдых превышен на 0:15' })).toHaveTextContent('Отдых −0:15')
    expect(onActive).toHaveBeenCalledTimes(2)
    expect(onChange).not.toHaveBeenCalled()
    expect(playGong).toHaveBeenCalledTimes(1)
    view.rerender(<LiveRestTimer workoutId="reference-boundary" deadline={121_000}
      referenceStartedAt={new Date(0).toISOString()} onChange={onChange} onReferenceRestActiveChange={onActive} />)
    expect(screen.getByLabelText('Отдых: 00:05')).toBeVisible()
    expect(onActive).toHaveBeenLastCalledWith(true)
  })

  it('mounts an overdue reference deadline as workout time without dropping the negative button', () => {
    vi.useFakeTimers()
    vi.setSystemTime(120_000)
    const onChange = vi.fn()
    render(<LiveRestTimer workoutId="reference-reload" deadline={101_000}
      referenceStartedAt={new Date(0).toISOString()} onChange={onChange} />)
    expect(screen.getByLabelText('Тренировка: 02:00')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Отдых превышен на 0:19' })).toHaveTextContent('Отдых −0:19')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('opens two time wheels, keeps quick presets and accepts exact seconds', () => {
    vi.useFakeTimers()
    vi.setSystemTime(100_000)
    const onChange = vi.fn()
    render(<LiveRestTimer workoutId="workout-1" deadline={null} onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'Таймер отдыха' }))
    expect(prepareGong).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('listbox', { name: 'минуты' })).toBeVisible()
    expect(screen.getByRole('listbox', { name: 'секунды' })).toBeVisible()
    fireEvent.click(screen.getByRole('option', { name: '02 минуты' }))
    fireEvent.click(screen.getByRole('option', { name: '05 секунды' }))
    fireEvent.click(screen.getByRole('button', { name: 'Начать отдых · 2:05' }))
    expect(onChange).toHaveBeenCalledWith(225_000)
    expect(prepareGong).toHaveBeenCalledTimes(2)
  })

  it('disables zero duration and supports the 60:00 upper boundary', () => {
    vi.useFakeTimers()
    vi.setSystemTime(100_000)
    const onChange = vi.fn()
    render(<LiveRestTimer workoutId="workout-1" deadline={null} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Таймер отдыха' }))

    fireEvent.click(screen.getByRole('option', { name: '00 минуты' }))
    fireEvent.click(screen.getByRole('option', { name: '00 секунды' }))
    expect(screen.getByRole('button', { name: 'Начать отдых · 0:00' })).toBeDisabled()

    fireEvent.click(screen.getByRole('option', { name: '60 минуты' }))
    expect(screen.getByRole('listbox', { name: 'секунды' })).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Начать отдых · 60:00' }))
    expect(onChange).toHaveBeenLastCalledWith(3_700_000)
  })

  it('adjusts, stops or restarts an active and overdue timer from the same sheet', () => {
    vi.useFakeTimers()
    vi.setSystemTime(100_000)
    const onChange = vi.fn()
    const view = render(<LiveRestTimer workoutId="workout-1" deadline={190_000} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Таймер отдыха: 1:30' }))
    fireEvent.click(screen.getByRole('button', { name: 'Плюс 15 секунд' }))
    expect(onChange).toHaveBeenLastCalledWith(205_000)
    fireEvent.click(screen.getByRole('button', { name: 'Минус 15 секунд' }))
    expect(onChange).toHaveBeenLastCalledWith(175_000)
    fireEvent.click(screen.getByRole('button', { name: 'Остановить отдых' }))
    expect(onChange).toHaveBeenLastCalledWith(null)

    view.rerender(<LiveRestTimer workoutId="workout-1" deadline={99_000} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Отдых превышен на 0:01' }))
    fireEvent.click(screen.getByRole('button', { name: '2:00' }))
    fireEvent.click(screen.getByRole('button', { name: 'Применить время · 2:00' }))
    expect(onChange).toHaveBeenLastCalledWith(220_000)
  })

  it('applies the physical wheel position immediately and reports the duration for future rests', () => {
    vi.useFakeTimers()
    vi.setSystemTime(100_000)
    const onChange = vi.fn()
    const onDurationChange = vi.fn()
    render(<LiveRestTimer workoutId="workout-1" deadline={190_000} defaultDurationSeconds={45} onChange={onChange} onDurationChange={onDurationChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'Таймер отдыха: 1:30' }))
    expect(screen.getByRole('option', { name: '00 минуты' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('option', { name: '45 секунды' })).toHaveAttribute('aria-selected', 'true')

    const minutesWheel = screen.getByRole('listbox', { name: 'минуты' })
    minutesWheel.scrollTop = 2 * 44
    fireEvent.scroll(minutesWheel)
    const secondsWheel = screen.getByRole('listbox', { name: 'секунды' })
    secondsWheel.scrollTop = 5 * 44
    fireEvent.scroll(secondsWheel)
    fireEvent.click(screen.getByRole('button', { name: 'Применить время · 2:05' }))

    expect(onDurationChange).toHaveBeenCalledWith(125)
    expect(onChange).toHaveBeenCalledWith(225_000)
  })

  it('does not replay the web gong after a native background signal', () => {
    vi.useFakeTimers()
    vi.setSystemTime(100_000)
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    vi.mocked(wasNativeRestTimerNotificationScheduled).mockReturnValue(true)
    render(<LiveRestTimer workoutId="workout-1" deadline={101_000} onChange={vi.fn()} />)

    fireEvent(document, new Event('visibilitychange'))
    act(() => vi.advanceTimersByTime(2_000))
    expect(playGong).not.toHaveBeenCalled()

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    fireEvent(document, new Event('visibilitychange'))
    expect(screen.getByRole('button', { name: 'Отдых превышен на 0:01' })).toBeVisible()
    expect(playGong).not.toHaveBeenCalled()
  })

  it('plays once on foreground catch-up and does not replay after remount', () => {
    vi.useFakeTimers()
    vi.setSystemTime(200_000)
    const first = render(<LiveRestTimer workoutId="workout-1" deadline={190_000} onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Отдых превышен на 0:10' })).toBeVisible()
    expect(playGong).toHaveBeenCalledTimes(1)
    first.unmount()

    render(<LiveRestTimer workoutId="workout-1" deadline={190_000} onChange={vi.fn()} />)
    expect(playGong).toHaveBeenCalledTimes(1)
  })

  it('closes by Escape and formats positive and negative values', () => {
    render(<LiveRestTimer workoutId="workout-1" deadline={null} onChange={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Таймер отдыха' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(formatRest(90)).toBe('1:30')
    expect(formatRest(-90)).toBe('−1:30')
  })
})

describe('Live phase timer', () => {
  const work = { kind: 'work', setId: 'set-1', startedAt: 100_000, endsAt: 145_000 } as const

  it('shows the phase, runs the short-tap action and keeps the sheet behind a long press', () => {
    vi.useFakeTimers()
    vi.setSystemTime(100_000)
    const onPrimary = vi.fn(() => true)
    render(<LiveRestTimer workoutId="workout-1" deadline={null} onChange={vi.fn()} phase={work} onPrimary={onPrimary} />)

    const trigger = screen.getByRole('button', { name: /Таймер подхода: 0:45/ })
    expect(trigger).toHaveTextContent('Подход 0:45')
    expect(trigger).toHaveClass('phase-work')
    fireEvent.click(trigger)
    expect(onPrimary).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    fireEvent.pointerDown(trigger)
    act(() => vi.advanceTimersByTime(500))
    fireEvent.pointerUp(trigger)
    fireEvent.click(trigger)
    expect(onPrimary).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('dialog', { name: 'Таймер подхода' })).toBeVisible()
    expect(screen.queryByRole('listbox', { name: 'минуты' })).not.toBeInTheDocument()
  })

  it('opens the sheet when the short tap has nothing to do', () => {
    const onPrimary = vi.fn(() => false)
    render(<LiveRestTimer workoutId="workout-1" deadline={null} onChange={vi.fn()} onPrimary={onPrimary} />)
    fireEvent.click(screen.getByRole('button', { name: 'Таймер отдыха' }))
    expect(onPrimary).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('dialog', { name: 'Таймер отдыха' })).toBeVisible()
  })

  it('opens the sheet from the context menu and adjusts or stops the phase', () => {
    vi.useFakeTimers()
    vi.setSystemTime(100_000)
    const onPhaseChange = vi.fn()
    render(<LiveRestTimer workoutId="workout-1" deadline={null} onChange={vi.fn()} phase={work} onPrimary={() => true} onPhaseChange={onPhaseChange} />)

    fireEvent.contextMenu(screen.getByRole('button', { name: /Таймер подхода/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Плюс 15 секунд' }))
    expect(onPhaseChange).toHaveBeenLastCalledWith({ ...work, endsAt: 160_000 })
    fireEvent.click(screen.getByRole('button', { name: 'Остановить подход' }))
    expect(onPhaseChange).toHaveBeenLastCalledWith(null)
  })

  it('reports an expired phase once and rings the gong', () => {
    vi.useFakeTimers()
    vi.setSystemTime(100_000)
    const onPhaseExpire = vi.fn()
    render(<LiveRestTimer workoutId="workout-1" deadline={null} onChange={vi.fn()} phase={work} onPrimary={() => true} onPhaseExpire={onPhaseExpire} />)

    act(() => vi.advanceTimersByTime(45_000))
    act(() => vi.advanceTimersByTime(1_000))
    expect(onPhaseExpire).toHaveBeenCalledTimes(1)
    expect(onPhaseExpire).toHaveBeenCalledWith(work)
    expect(playGong).toHaveBeenCalledTimes(1)
  })

  it('reports the end of rest so the next timed set can start', () => {
    vi.useFakeTimers()
    vi.setSystemTime(100_000)
    const onRestExpire = vi.fn()
    render(<LiveRestTimer workoutId="workout-1" deadline={101_000} onChange={vi.fn()} onPrimary={() => true} onRestExpire={onRestExpire} />)
    act(() => vi.advanceTimersByTime(2_000))
    expect(onRestExpire).toHaveBeenCalledExactlyOnceWith(101_000)
  })
})
