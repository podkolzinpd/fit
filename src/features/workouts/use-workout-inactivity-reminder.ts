import { useCallback, useEffect, useRef, useState } from 'react'
import {
  cancelNativeWorkoutInactivityReminder,
  clearWorkoutInactivityReminder,
  consumeWorkoutInactivityAction,
  ensureWorkoutInactivityReminder,
  isNativeWorkoutInactivityReminderSupported,
  markWorkoutInactivityReminderNotified,
  readWorkoutInactivityReminder,
  recordWorkoutInactivityActivity,
  scheduleNativeWorkoutInactivityReminder,
  showBrowserWorkoutInactivityReminder,
  WORKOUT_INACTIVITY_DELAY_MS,
  type WorkoutInactivityReminderState,
} from './workout-inactivity-reminder'

const MAX_TIMEOUT_MS = 2_147_000_000

export function useWorkoutInactivityReminder({
  userId,
  workoutId,
  status,
  enabled,
  activeUntil,
  onFinishIntent,
}: {
  userId?: string
  workoutId: string
  status: 'loading' | 'active' | 'inactive'
  enabled: boolean | null
  activeUntil: number | null
  onFinishIntent: () => void
}) {
  const [visible, setVisible] = useState(false)
  const timer = useRef<number | null>(null)
  const current = useRef<WorkoutInactivityReminderState | null>(null)
  const finishIntent = useRef(onFinishIntent)
  useEffect(() => { finishIntent.current = onFinishIntent }, [onFinishIntent])

  const clearTimer = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
  }, [])

  const evaluate = useCallback(async function evaluateReminder() {
    const state = current.current
    if (!state || state.notifiedAt !== undefined) return
    const remaining = state.dueAt - Date.now()
    if (remaining > 0) {
      clearTimer()
      timer.current = window.setTimeout(() => { void evaluateReminder() }, Math.min(remaining, MAX_TIMEOUT_MS))
      return
    }

    if (document.visibilityState === 'visible') {
      current.current = markWorkoutInactivityReminderNotified(state)
      await cancelNativeWorkoutInactivityReminder(state.workoutId)
      setVisible(true)
      return
    }

    // Native delivery is already scheduled independently by the OS. On the
    // web we can display through the service worker while the page is hidden.
    if (isNativeWorkoutInactivityReminderSupported()) return
    if (await showBrowserWorkoutInactivityReminder(state)) {
      current.current = markWorkoutInactivityReminderNotified(state)
    }
  }, [clearTimer])

  const arm = useCallback((state: WorkoutInactivityReminderState) => {
    current.current = state
    clearTimer()
    if (state.notifiedAt !== undefined) return
    void scheduleNativeWorkoutInactivityReminder(state)
    const remaining = Math.max(0, state.dueAt - Date.now())
    timer.current = window.setTimeout(() => { void evaluate() }, Math.min(remaining, MAX_TIMEOUT_MS))
  }, [clearTimer, evaluate])

  const noteActivity = useCallback((activeThrough: number | null = null) => {
    if (!userId || status !== 'active' || enabled !== true) return
    setVisible(false)
    arm(recordWorkoutInactivityActivity(userId, workoutId, activeThrough))
  }, [arm, enabled, status, userId, workoutId])

  const dismiss = useCallback(() => setVisible(false), [])

  useEffect(() => {
    if (!userId || status === 'loading' || enabled === null) return
    if (status === 'inactive' || enabled === false) {
      clearTimer()
      clearWorkoutInactivityReminder(userId, workoutId)
      current.current = null
      setVisible(false)
      return
    }

    const state = ensureWorkoutInactivityReminder(userId, workoutId)
    arm(state)
    void evaluate()
    const wake = () => {
      const latest = readWorkoutInactivityReminder(userId, workoutId)
      if (latest) current.current = latest
      void evaluate()
    }
    window.addEventListener('pageshow', wake)
    document.addEventListener('visibilitychange', wake)

    const pendingAction = consumeWorkoutInactivityAction(workoutId)
      ?? (new URLSearchParams(window.location.search).get('reminder') === 'finish' ? 'finish' : null)
    if (pendingAction === 'finish') finishIntent.current()

    return () => {
      clearTimer()
      window.removeEventListener('pageshow', wake)
      document.removeEventListener('visibilitychange', wake)
    }
  }, [arm, clearTimer, enabled, evaluate, status, userId, workoutId])

  useEffect(() => {
    if (!userId || status !== 'active' || enabled !== true || activeUntil === null || activeUntil <= Date.now()) return
    const state = readWorkoutInactivityReminder(userId, workoutId)
    if (!state || state.notifiedAt !== undefined || state.dueAt >= activeUntil + WORKOUT_INACTIVITY_DELAY_MS) return
    arm(recordWorkoutInactivityActivity(userId, workoutId, activeUntil))
  }, [activeUntil, arm, enabled, status, userId, workoutId])

  return { visible, noteActivity, dismiss }
}
