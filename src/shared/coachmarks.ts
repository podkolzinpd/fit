const STORAGE_KEY_PREFIX = 'fit.coachmarks-seen.'

function read(userId: string | undefined): string[] {
  if (!userId) return []
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY_PREFIX}${userId}`)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

export function isCoachmarkSeen(userId: string | undefined, coachmarkId: string): boolean {
  return read(userId).includes(coachmarkId)
}

export function markCoachmarkSeen(userId: string | undefined, coachmarkId: string): void {
  if (!userId) return
  try {
    const seen = read(userId)
    if (seen.includes(coachmarkId)) return
    localStorage.setItem(`${STORAGE_KEY_PREFIX}${userId}`, JSON.stringify([...seen, coachmarkId]))
  } catch {
    // В приватном режиме подсказка останется рабочей, просто будет показываться снова.
  }
}
