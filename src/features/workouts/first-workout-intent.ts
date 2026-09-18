export type FirstWorkoutIntent =
  | { mode: 'voice'; transcript: string }
  | { mode: 'text' }
  | { mode: 'preset'; presetId: string }

function key(userId: string) {
  return `fit.firstWorkoutIntent.${userId}`
}

export function storeFirstWorkoutIntent(userId: string, intent: FirstWorkoutIntent): void {
  sessionStorage.setItem(key(userId), JSON.stringify(intent))
}

export function takeFirstWorkoutIntent(userId: string): FirstWorkoutIntent | null {
  const stored = sessionStorage.getItem(key(userId))
  if (!stored) return null
  sessionStorage.removeItem(key(userId))
  try {
    const intent = JSON.parse(stored) as FirstWorkoutIntent
    if (intent.mode === 'text') return intent
    if (intent.mode === 'voice' && typeof intent.transcript === 'string' && intent.transcript.trim()) return intent
    if (intent.mode === 'preset' && typeof intent.presetId === 'string' && intent.presetId) return intent
  } catch {
    // Повреждённое одноразовое состояние не должно блокировать главную.
  }
  return null
}
