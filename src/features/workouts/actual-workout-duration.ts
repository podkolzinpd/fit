/** Empty means unknown, never the time spent filling in the form. */
export function actualWorkoutDurationSeconds(minutes: string): number | null {
  if (!minutes.trim()) return null
  const value = Number(minutes.replace(',', '.'))
  const seconds = Math.round(value * 60)
  if (!/^\d+(?:[.,]\d+)?$/.test(minutes) || !Number.isFinite(value) || seconds < 1 || seconds > 43_200) {
    throw new Error('Укажите длительность тренировки от 1 секунды до 720 минут')
  }
  return seconds
}
