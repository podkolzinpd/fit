import { createHash } from 'node:crypto'
import type { DatabaseClient, DatabasePool } from './db/types.js'
import type { ProfileResponse } from './profile.js'

const hashPattern = /^[0-9a-f]{64}$/
export interface NutritionPilot { clients: readonly string[]; trainers: readonly string[]; native?: true }

// Nutrition-specific normalization: do not change the shared login hash used
// by other experiments. Yandex treats dots/hyphens as equivalent in native
// logins; external-email logins remain exact, including their domain.
export function nutritionLoginHash(login: string): string | undefined {
  let key = login.trim().toLowerCase()
  if (key.endsWith('@yandex.ru')) key = key.slice(0, -10)
  if (!key.includes('@')) {
    if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(key)) return undefined
    // Verified legacy underscore identities are literal, not dot/hyphen aliases.
    key = key.replaceAll('.', '-')
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(key)) return undefined
  return createHash('sha256').update(key).digest('hex')
}

export function readNativeNutritionPilot(enabled: string | undefined, raw: string | undefined): NutritionPilot | null {
  if (enabled !== 'true') return null
  let value: unknown
  try { value = JSON.parse(raw ?? '') } catch { return null }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const input = value as Record<string, unknown>
  const clients: unknown = input.clients, trainers: unknown = input.trainers
  if (Object.keys(input).sort().join(',') !== 'clients,trainers'
    || !Array.isArray(clients) || !Array.isArray(trainers)
    || ![3, 4, 5].includes(clients.length) || trainers.length !== 2
    || (clients as unknown[]).concat(trainers as unknown[]).some(x => typeof x !== 'string' || !hashPattern.test(x))
    || new Set((clients as unknown[]).concat(trainers as unknown[])).size !== clients.length + trainers.length) return null
  return { clients: clients as string[], trainers: trainers as string[], native: true }
}

export async function nutritionProfileAllowed(client: DatabaseClient, pilot: NutritionPilot | null,
  profileId: string, role: 'client' | 'trainer'): Promise<boolean> {
  if (pilot === null) return false
  const cohort = role === 'client' ? pilot.clients : pilot.trainers
  if (!pilot.native) return cohort.includes(profileId)
  const rows = await client.query<{ login_hash: string | null }>(
    'select app_private.nutrition_login_for_profile($1, $2) login_hash', [profileId, role])
  return typeof rows[0]?.login_hash === 'string' && cohort.includes(rows[0].login_hash)
}

export async function withNutritionProfileDecision(client: DatabaseClient, profile: ProfileResponse | undefined,
  pilot: NutritionPilot | null): Promise<ProfileResponse | undefined> {
  if (profile === undefined || pilot === null) return profile
  const enabled = await nutritionProfileAllowed(client, pilot, profile.profile.id, profile.profile.accountRole)
  return { ...profile, profile: { ...profile.profile, experiments: { ...profile.profile.experiments, nutrition: enabled } } }
}

export interface NutritionAutoActivator { bind(subjectHash: string, loginHash: string): Promise<{ bound: boolean }> }
export class DatabaseNutritionAutoActivator implements NutritionAutoActivator {
  constructor(private readonly pool: DatabasePool, private readonly pilot: NutritionPilot | null) {}
  async bind(subjectHash: string, loginHash: string): Promise<{ bound: boolean }> {
    if (!this.pilot?.native || !hashPattern.test(subjectHash) || !hashPattern.test(loginHash)) return { bound: false }
    const role = this.pilot.clients.includes(loginHash) ? 'client'
      : this.pilot.trainers.includes(loginHash) ? 'trainer' : undefined
    if (role === undefined) return { bound: false }
    const client = await this.pool.connect()
    try {
      const rows = await client.query<{ bound: boolean }>(
        'select app_private.bind_nutrition_for_yandex_login($1, $2, $3) bound', [subjectHash, loginHash, role])
      return { bound: rows[0]?.bound === true }
    } finally { client.release() }
  }
}
