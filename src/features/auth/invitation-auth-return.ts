const storageKey = 'fit.auth.invitationReturn.v1'
const maxAgeMs = 2 * 60 * 60 * 1000
const invitationCodePattern = /^[A-Z0-9]{12}$/

interface StoredInvitationReturn {
  path: string
  savedAt: number
}

function browserStorage(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.sessionStorage
  } catch {
    return undefined
  }
}

export function invitationAuthReturnPath(value: unknown): string | null {
  if (typeof value !== 'string' || value === '') return null
  if (value === '/invite') return value
  if (!value.startsWith('/join?') || value.includes('#')) return null

  const search = value.slice('/join?'.length)
  const params = new URLSearchParams(search)
  if ([...params.keys()].length !== 1 || !params.has('code')) return null
  const codes = params.getAll('code')
  if (codes.length !== 1) return null
  const code = codes[0]?.trim().toUpperCase() ?? ''
  return invitationCodePattern.test(code) ? `/join?code=${code}` : null
}

export function saveInvitationAuthReturn(
  value: unknown,
  storage: Storage | undefined = browserStorage(),
  now = Date.now(),
): string | null {
  const path = invitationAuthReturnPath(value)
  if (path === null || storage === undefined) return path
  try {
    storage.setItem(storageKey, JSON.stringify({ path, savedAt: now } satisfies StoredInvitationReturn))
  } catch {
    // The current in-memory route still works when browser storage is blocked.
  }
  return path
}

export function readInvitationAuthReturn(
  storage: Storage | undefined = browserStorage(),
  now = Date.now(),
): string | null {
  if (storage === undefined) return null
  try {
    const raw = storage.getItem(storageKey)
    if (raw === null) return null
    const value = JSON.parse(raw) as Partial<StoredInvitationReturn>
    const path = invitationAuthReturnPath(value.path)
    if (path === null
      || typeof value.savedAt !== 'number'
      || value.savedAt > now + 60_000
      || now - value.savedAt > maxAgeMs) {
      storage.removeItem(storageKey)
      return null
    }
    return path
  } catch {
    try { storage.removeItem(storageKey) } catch { /* Browser storage can be blocked. */ }
    return null
  }
}

export function consumeInvitationAuthReturn(
  storage: Storage | undefined = browserStorage(),
  now = Date.now(),
): string | null {
  const path = readInvitationAuthReturn(storage, now)
  try { storage?.removeItem(storageKey) } catch { /* Browser storage can be blocked. */ }
  return path
}
