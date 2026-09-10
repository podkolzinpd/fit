import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const native = vi.hoisted(() => vi.fn(() => false))
const notifications = vi.hoisted(() => ({
  addListener: vi.fn(), cancel: vi.fn(), checkPermissions: vi.fn(),
  getDeliveredNotifications: vi.fn(), getPending: vi.fn(), registerActionTypes: vi.fn(),
  removeDeliveredNotifications: vi.fn(), requestPermissions: vi.fn(), schedule: vi.fn(),
}))
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: native } }))
vi.mock('@capacitor/local-notifications', () => ({ LocalNotifications: notifications }))

import { WORKOUT_INACTIVITY_DELAY_MS } from './workout-inactivity-reminder'
import { useWorkoutInactivityReminder } from './use-workout-inactivity-reminder'

const USER_ID = 'user-1'
const WORKOUT_ID = 'workout-1'

function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() { return values.size },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key) },
    setItem: (key, value) => { values.set(key, value) },
  }
}

function Harness({
  status = 'active',
  enabled = true,
  activeUntil = null,
  onFinish = vi.fn(),
}: {
  status?: 'loading' | 'active' | 'inactive'
  enabled?: boolean | null
  activeUntil?: number | null
  onFinish?: () => void
}) {
  const reminder = useWorkoutInactivityReminder({
    userId: USER_ID,
    workoutId: WORKOUT_ID,
    status,
    enabled,
    activeUntil,
    onFinishIntent: onFinish,
  })
  return <>{reminder.visible && <div role="alert"><span>Тренировка ещё идёт</span><button onClick={reminder.dismiss}>Продолжить</button></div>}</>
}

describe('useWorkoutInactivityReminder', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-10T10:00:00Z'))
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: memoryStorage() })
    native.mockReturnValue(false)
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    window.history.replaceState({}, '', '/')
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('shows one inline fallback after twenty minutes and lets the user continue', async () => {
    render(<Harness />)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    await act(async () => {
      vi.advanceTimersByTime(WORKOUT_INACTIVITY_DELAY_MS)
      await Promise.resolve()
    })
    expect(screen.getByRole('alert')).toHaveTextContent('Тренировка ещё идёт')
    fireEvent.click(screen.getByRole('button', { name: 'Продолжить' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    await act(async () => {
      vi.advanceTimersByTime(WORKOUT_INACTIVITY_DELAY_MS * 2)
      await Promise.resolve()
    })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('waits until a running rest timer ends before starting the twenty-minute window', async () => {
    const now = Date.now()
    render(<Harness activeUntil={now + 5 * 60_000} />)
    await act(async () => {
      vi.advanceTimersByTime(WORKOUT_INACTIVITY_DELAY_MS)
      await Promise.resolve()
    })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await act(async () => {
      vi.advanceTimersByTime(5 * 60_000)
      await Promise.resolve()
    })
    expect(screen.getByRole('alert')).toBeVisible()
  })

  it('clears a pending reminder when the workout is no longer active', () => {
    const { rerender } = render(<Harness />)
    expect(localStorage.length).toBe(1)
    rerender(<Harness status="inactive" />)
    expect(localStorage.length).toBe(0)
  })

  it('preserves an already scheduled reminder while the preference is loading', () => {
    const key = `fit:workout-inactivity:${USER_ID}:${WORKOUT_ID}`
    localStorage.setItem(key, JSON.stringify({ version: 1, userId: USER_ID, workoutId: WORKOUT_ID, dueAt: Date.now() + 60_000 }))
    const { rerender } = render(<Harness enabled={null} />)
    expect(localStorage.getItem(key)).not.toBeNull()

    rerender(<Harness enabled />)
    expect(localStorage.getItem(key)).not.toBeNull()
  })

  it('opens the existing finish confirmation for a notification finish action', () => {
    const onFinish = vi.fn()
    window.history.replaceState({}, '', `/workouts/${WORKOUT_ID}/live?reminder=finish`)
    render(<Harness onFinish={onFinish} />)
    expect(onFinish).toHaveBeenCalledOnce()
  })
})
