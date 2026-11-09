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
    return typeof window === 'undefined' ? undefined : window.sessionStorage
  } catch {
    return undefined
  }
}

function validSource(value: unknown): value is InvitationLinkSource {
  return value === 'supabase' || value === 'yandex'
}

interface ParsedInvitationInput {
  addressed: boolean
  invitation: PendingInvitationLink | null
}

function parseInvitationInput(value: string, now: number): ParsedInvitationInput {
  const params = new URLSearchParams(value.startsWith('#') || value.startsWith('?') ? value.slice(1) : value)
  const keys = [...params.keys()]
  const addressed = keys.some((key) => key === 'token' || key === 'source')
  if (!addressed) return { addressed: false, invitation: null }

  const tokens = params.getAll('token')
  const sources = params.getAll('source')
  const token = tokens[0]?.trim() ?? ''
  const sourceValue = sources[0] ?? 'supabase'
  if (keys.some((key) => key !== 'token' && key !== 'source')
    || tokens.length !== 1
    || sources.length > 1
    || !tokenPattern.test(token)
    || !validSource(sourceValue)) {
    return { addressed: true, invitation: null }
  }
  return { addressed: true, invitation: { token, source: sourceValue, savedAt: now } }
}

function persistInvitationLink(invitation: PendingInvitationLink, storage: Storage | undefined): PendingInvitationLink {
  try { storage?.setItem(storageKey, JSON.stringify(invitation)) } catch { /* Continue in the current page if storage is blocked. */ }
  return invitation
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
  value: string,
  storage: Storage | undefined = browserStorage(),
  now = Date.now(),
): PendingInvitationLink | null {
  const parsed = parseInvitationInput(value, now)
  if (!parsed.addressed) return readPendingInvitationLink(storage, now)
  return parsed.invitation === null ? null : persistInvitationLink(parsed.invitation, storage)
}

export function captureInvitationLocation(
  search: string,
  hash: string,
  storage: Storage | undefined = browserStorage(),
  now = Date.now(),
): PendingInvitationLink | null {
  const queryInput = parseInvitationInput(search, now)
  const hashInput = parseInvitationInput(hash, now)
  if ((queryInput.addressed && queryInput.invitation === null)
    || (hashInput.addressed && hashInput.invitation === null)) return null

  if (queryInput.invitation !== null && hashInput.invitation !== null
    && (queryInput.invitation.token !== hashInput.invitation.token
      || queryInput.invitation.source !== hashInput.invitation.source)) return null

  const invitation = queryInput.invitation ?? hashInput.invitation
  return invitation === null
    ? readPendingInvitationLink(storage, now)
    : persistInvitationLink(invitation, storage)
}

export function hasInvitationLocationParameters(search: string, hash: string): boolean {
  return parseInvitationInput(search, Date.now()).addressed
    || parseInvitationInput(hash, Date.now()).addressed
}

export function clearPendingInvitationLink(storage: Storage | undefined = browserStorage()): void {
  try { storage?.removeItem(storageKey) } catch { /* Storage can be blocked by the browser. */ }
}

export function hasPendingInvitationLink(storage: Storage | undefined = browserStorage()): boolean {
  return readPendingInvitationLink(storage) !== null
}
