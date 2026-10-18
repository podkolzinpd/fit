function key(userId: string, workoutId: string): string {
  return `fit.live-note-drafts.${userId}.${workoutId}`
}

export function readPendingLiveNotes(userId: string, workoutId: string): Map<string, string> {
  try {
    const raw = localStorage.getItem(key(userId, workoutId))
    const parsed: unknown = raw ? JSON.parse(raw) : null
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return new Map()
    return new Map(Object.entries(parsed).filter((entry): entry is [string, string] =>
      typeof entry[1] === 'string' && entry[1].length <= 5000))
  } catch { return new Map() }
}

export function writePendingLiveNote(userId: string, workoutId: string, exerciseId: string, value: string): void {
  try {
    const drafts = readPendingLiveNotes(userId, workoutId)
    drafts.set(exerciseId, value)
    localStorage.setItem(key(userId, workoutId), JSON.stringify(Object.fromEntries(drafts)))
  } catch { /* Restricted storage: the current form still retains its draft. */ }
}

/** A late acknowledgement must not erase a newer draft written by another tab. */
export function acknowledgePendingLiveNote(userId: string, workoutId: string, exerciseId: string, value: string): void {
  try {
    const drafts = readPendingLiveNotes(userId, workoutId)
    if (drafts.get(exerciseId)?.trim() !== value.trim()) return
    drafts.delete(exerciseId)
    if (drafts.size) localStorage.setItem(key(userId, workoutId), JSON.stringify(Object.fromEntries(drafts)))
    else localStorage.removeItem(key(userId, workoutId))
  } catch { /* The server result remains authoritative when storage is blocked. */ }
}
