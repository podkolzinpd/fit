const storageKey = (workoutId: string) => `fit:live-rest-until:${workoutId}`

export function restDeadline(seconds: number, now = Date.now()): number | null {
  return seconds > 0 ? now + seconds * 1000 : null
}

// Отдых — краткоживущее состояние одной live-сессии. sessionStorage переживает
// навигацию и reload WebView, но не возвращает старый таймер в следующую сессию.
export function restoreRestDeadline(workoutId: string): number | null {
  const raw = sessionStorage.getItem(storageKey(workoutId))
  const deadline = raw === null ? null : Number(raw)
  if (deadline === null || !Number.isFinite(deadline) || deadline <= 0) {
    sessionStorage.removeItem(storageKey(workoutId))
    return null
  }
  return deadline
}

export function storeRestDeadline(workoutId: string, deadline: number | null) {
  if (deadline === null) sessionStorage.removeItem(storageKey(workoutId))
  else sessionStorage.setItem(storageKey(workoutId), String(deadline))
}

export function readLiveRestOverrides(key: string): Record<string, number> {
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(key) ?? '{}')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(Object.entries(parsed).filter(([, value]) => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 3600))
  } catch { return {} }
}
