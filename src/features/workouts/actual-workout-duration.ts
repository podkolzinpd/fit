/** Empty means unknown, never the time spent filling in the form. */
export function actualWorkoutDurationSeconds(minutes: string): number | null {
  if (!minutes.trim()) return null
  minutes = minutes.trim()
  const value = Number(minutes.replace(',', '.'))
  const seconds = Math.round(value * 60)
  if (!/^\d+(?:[.,]\d+)?$/.test(minutes) || !Number.isFinite(value) || seconds < 1 || seconds > 43_200) {
    throw new Error('Укажите длительность тренировки от 1 секунды до 720 минут')
  }
  return seconds
}

export function workoutDurationMinutes(workout: {
  actualDurationSec?: number | null; startedAt: string | null; completedAt: string | null
}): string {
  if (workout.actualDurationSec) return String(workout.actualDurationSec / 60)
  if (!workout.startedAt || !workout.completedAt) return ''
  const seconds = (Date.parse(workout.completedAt) - Date.parse(workout.startedAt)) / 1000
  return Number.isFinite(seconds) && seconds >= 1 && seconds <= 43_200
    ? String(Math.max(1, Math.round(seconds / 60))) : ''
}
