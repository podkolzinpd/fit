import { useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

export type WorkoutNavigationState = {
  returnTo?: string
  fromWorkoutDetailId?: string
  justCompleted?: boolean
  firstPlanClient?: { id: string; fullName: string }
}

export function safeWorkoutReturnTo(value: unknown): string | undefined {
  return typeof value === 'string' && /^\/(?:me|today|schedule|clients|progress|workouts)(?:[/?#]|$)/.test(value)
    && !value.includes('\\') ? value : undefined
}

// React Router's index counts entries in this app, unlike history.length,
// which also includes other sites. A new tab/direct link must stay in Fit.
export function hasWorkoutBackEntry(): boolean {
  const state = window.history.state as { idx?: unknown } | null
  return typeof state?.idx === 'number' && state.idx > 0
}

export function workoutListFallback(clientMode: boolean, clientId?: string): string {
  return clientMode ? '/me/workouts' : clientId ? `/clients/${clientId}/workouts` : '/clients'
}

export function useWorkoutBack(fallback: string) {
  const navigate = useNavigate()
  const location = useLocation()
  const state = location.state as WorkoutNavigationState | null
  const returnTo = safeWorkoutReturnTo(state?.returnTo) ?? fallback
  return useCallback(() => {
    if (hasWorkoutBackEntry()) void navigate(-1)
    else void navigate(returnTo, { replace: true })
  }, [navigate, returnTo])
}
