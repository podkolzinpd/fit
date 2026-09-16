import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LiveRestTimer, formatRest } from './LiveRestTimer'
import { readLiveRestOverrides } from './LiveExerciseRest'
import { playGong } from '../../shared/gong'

vi.mock('../../shared/gong', () => ({ playGong: vi.fn() }))
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); sessionStorage.clear() })

describe('Live rest timer', () => {
  it('opens a manual timer without changing workout state on each tick', () => {
    vi.useFakeTimers()
    vi.setSystemTime(100000)
    const onChange = vi.fn()
    const view = render(<LiveRestTimer deadline={null} completedSetCount={0} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Таймер отдыха' }))
    fireEvent.click(screen.getByRole('button', { name: 'Начать отдых' }))
    expect(onChange).toHaveBeenCalledWith(190000)
    view.rerender(<LiveRestTimer deadline={190000} completedSetCount={0} onChange={onChange} />)
    onChange.mockClear()
    act(() => vi.advanceTimersByTime(1000))
    expect(screen.getByRole('button', { name: 'Таймер отдыха: 1:29' })).toBeVisible()
    expect(onChange).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(90000))
    expect(onChange).toHaveBeenCalledExactlyOnceWith(null)
    expect(playGong).toHaveBeenCalledTimes(1)
  })
  it('rejects empty duration and closes by Escape', () => {
    const onChange = vi.fn()
    render(<LiveRestTimer deadline={null} completedSetCount={0} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Таймер отдыха' }))
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '' } })
    expect(screen.getByRole('button', { name: 'Начать отдых' })).toBeDisabled()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(formatRest(90)).toBe('1:30')
  })
  it('adjusts the deadline and catches up once after returning from background', () => {
    vi.useFakeTimers()
    vi.setSystemTime(100000)
    const onChange = vi.fn()
    render(<LiveRestTimer deadline={190000} completedSetCount={0} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Таймер отдыха: 1:30' }))
    fireEvent.click(screen.getByRole('button', { name: 'Плюс 15 секунд' }))
    expect(onChange).toHaveBeenLastCalledWith(205000)
    fireEvent.click(screen.getByRole('button', { name: 'Минус 15 секунд' }))
    expect(onChange).toHaveBeenLastCalledWith(175000)
    onChange.mockClear()
    vi.setSystemTime(250000)
    fireEvent(window, new Event('pageshow'))
    fireEvent(window, new Event('pageshow'))
    expect(onChange).toHaveBeenCalledExactlyOnceWith(null)
    expect(playGong).toHaveBeenCalledTimes(1)
  })
  it('keeps a visible finished state until the next set or rest starts', () => {
    vi.useFakeTimers()
    vi.setSystemTime(100000)
    const onChange = vi.fn()
    const view = render(<LiveRestTimer deadline={101000} completedSetCount={2} onChange={onChange} />)

    act(() => vi.advanceTimersByTime(1000))
    expect(screen.getByRole('button', { name: 'Отдых завершён' })).toHaveClass('rest-finished')
    expect(onChange).toHaveBeenCalledExactlyOnceWith(null)
    expect(playGong).toHaveBeenCalledTimes(1)

    view.rerender(<LiveRestTimer deadline={null} completedSetCount={2} onChange={onChange} />)
    expect(screen.getByRole('button', { name: 'Отдых завершён' })).toBeVisible()

    view.rerender(<LiveRestTimer deadline={null} completedSetCount={3} onChange={onChange} />)
    expect(screen.getByRole('button', { name: 'Таймер отдыха' })).toBeVisible()

    view.rerender(<LiveRestTimer deadline={200000} completedSetCount={3} onChange={onChange} />)
    expect(screen.getByRole('button', { name: 'Таймер отдыха: 1:39' })).toHaveClass('resting')
  })
  it('restores the finished state when a persisted deadline elapsed in background', () => {
    vi.useFakeTimers()
    vi.setSystemTime(200000)
    const onChange = vi.fn()

    render(<LiveRestTimer deadline={190000} completedSetCount={2} onChange={onChange} />)

    expect(screen.getByRole('button', { name: 'Отдых завершён' })).toHaveClass('rest-finished')
    expect(onChange).toHaveBeenCalledExactlyOnceWith(null)
    expect(playGong).toHaveBeenCalledTimes(1)
  })
  it('ignores corrupt or invalid session rest overrides', () => {
    sessionStorage.setItem('test', '{')
    expect(readLiveRestOverrides('test')).toEqual({})
    sessionStorage.setItem('test', JSON.stringify({ good: 90, off: 0, bad: -2, huge: 100000, text: '30' }))
    expect(readLiveRestOverrides('test')).toEqual({ good: 90, off: 0 })
  })
})
