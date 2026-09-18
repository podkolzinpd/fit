import type { InvitationLinkSource } from '../../shared/domain'

const storageKey = 'fit.pendingInvitationLink.v1'
const maxAgeMs = 7 * 24 * 60 * 60 * 1000
const tokenPattern = /^[A-F0-9]{12}\.[0-9a-f]{64}$/

export interface PendingInvitationLink {
  token: string
  source: InvitationLinkSource
  savedAt: number
}

function browserStorage(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage
  } catch {
    return undefined
  }
}

function validSource(value: unknown): value is InvitationLinkSource {
  return value === 'supabase' || value === 'yandex'
}

export function readPendingInvitationLink(
  storage: Storage | undefined = browserStorage(),
  now = Date.now(),
): PendingInvitationLink | null {
  if (storage === undefined) return null
  try {
    const raw = storage.getItem(storageKey)
    if (raw === null) return null
    const value = JSON.parse(raw) as Partial<PendingInvitationLink>
    if (typeof value.token !== 'string'
      || !tokenPattern.test(value.token)
      || !validSource(value.source)
      || typeof value.savedAt !== 'number'
      || now - value.savedAt > maxAgeMs
      || value.savedAt > now + 60_000) {
      storage.removeItem(storageKey)
      return null
    }
    return { token: value.token, source: value.source, savedAt: value.savedAt }
  } catch {
    try { storage.removeItem(storageKey) } catch { /* Storage can be blocked by the browser. */ }
    return null
  }
}

export function captureInvitationLink(
  hash: string,
  storage: Storage | undefined = browserStorage(),
  now = Date.now(),
): PendingInvitationLink | null {
  if (storage === undefined) return null
  const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash)
  const token = params.get('token')?.trim() ?? ''
  const sourceValue = params.get('source') ?? 'supabase'
  if (!tokenPattern.test(token) || !validSource(sourceValue)) {
    return readPendingInvitationLink(storage, now)
  }
  const invitation = { token, source: sourceValue, savedAt: now }
  try { storage.setItem(storageKey, JSON.stringify(invitation)) } catch { /* Continue in the current page if storage is blocked. */ }
  return invitation
}

export function clearPendingInvitationLink(storage: Storage | undefined = browserStorage()): void {
  try { storage?.removeItem(storageKey) } catch { /* Storage can be blocked by the browser. */ }
}

export function hasPendingInvitationLink(storage: Storage | undefined = browserStorage()): boolean {
  return readPendingInvitationLink(storage) !== null
}
