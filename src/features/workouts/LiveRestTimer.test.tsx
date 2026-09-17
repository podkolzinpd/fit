import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LiveRestTimer, formatRest } from './LiveRestTimer'
import { readLiveRestOverrides } from './LiveExerciseRest'
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
    fireEvent.click(screen.getByRole('button', { name: 'Начать отдых' }))
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
    expect(screen.getByRole('button', { name: 'Начать отдых' })).toBeDisabled()

    fireEvent.click(screen.getByRole('option', { name: '60 минуты' }))
    expect(screen.getByRole('listbox', { name: 'секунды' })).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Начать отдых' }))
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
    fireEvent.click(screen.getByRole('button', { name: 'Запустить заново' }))
    expect(onChange).toHaveBeenLastCalledWith(220_000)
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

  it('ignores corrupt or invalid session rest overrides', () => {
    sessionStorage.setItem('test', '{')
    expect(readLiveRestOverrides('test')).toEqual({})
    sessionStorage.setItem('test', JSON.stringify({ good: 90, off: 0, bad: -2, huge: 100000, text: '30' }))
    expect(readLiveRestOverrides('test')).toEqual({ good: 90, off: 0 })
  })
})
