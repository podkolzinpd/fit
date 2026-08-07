import type { Client } from '../../shared/domain'

const STORAGE_KEY_PREFIX = 'fit.recent-clients.'
const MAX_RECENT = 8

export function pushRecentClient(current: readonly string[], clientId: string): string[] {
  return [clientId, ...current.filter((id) => id !== clientId)].slice(0, MAX_RECENT)
}

export function resolveRecentClients(ids: readonly string[], clients: readonly Client[]): Client[] {
  const byId = new Map(clients.map((client) => [client.id, client]))
  return ids.map((id) => byId.get(id)).filter((client): client is Client => client !== undefined)
}

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

export function recentClientIds(userId: string | undefined): string[] {
  return read(userId)
}

export function recordRecentClient(userId: string | undefined, clientId: string): void {
  if (!userId) return
  try {
    localStorage.setItem(`${STORAGE_KEY_PREFIX}${userId}`, JSON.stringify(pushRecentClient(read(userId), clientId)))
  } catch {
    // В приватном режиме выбор остаётся рабочим, только список недавних не сохраняется.
  }
}
