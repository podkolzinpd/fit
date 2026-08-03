const storageKey = (workoutId: string) => `fit:live-rest-until:${workoutId}`

// Отдых — краткоживущее состояние одной live-сессии. sessionStorage переживает
// навигацию и reload WebView, но не возвращает старый таймер в следующую сессию.
export function restoreRestDeadline(workoutId: string, now = Date.now()): number | null {
  const raw = sessionStorage.getItem(storageKey(workoutId))
  const deadline = raw === null ? null : Number(raw)
  if (deadline === null || !Number.isFinite(deadline) || deadline <= now) {
    sessionStorage.removeItem(storageKey(workoutId))
    return null
  }
  return deadline
}

export function storeRestDeadline(workoutId: string, deadline: number | null) {
  if (deadline === null) sessionStorage.removeItem(storageKey(workoutId))
  else sessionStorage.setItem(storageKey(workoutId), String(deadline))
}
