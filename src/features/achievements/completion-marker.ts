const PREFIX = 'fit.new-achievement-completion.'

export function markAchievementCompletion(userId: string, workoutId: string): void {
  try { sessionStorage.setItem(`${PREFIX}${userId}.${workoutId}`, String(Date.now())) } catch { /* Storage can be unavailable. */ }
}

export function takeAchievementCompletion(userId: string, workoutId: string): boolean {
  try {
    const key = `${PREFIX}${userId}.${workoutId}`
    const value = sessionStorage.getItem(key)
    sessionStorage.removeItem(key)
    return value !== null && Date.now() - Number(value) < 10 * 60_000
  } catch { return false }
}
