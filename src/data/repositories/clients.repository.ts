import type { Client, ClientAttentionPreference, CreateClientInput, Gender, UpdateClientInput, UpdateClientTrainerPreferencesInput } from '../../shared/domain'
import { localDate } from '../../shared/local-date'
import { clientQueries } from '../queries/clients.queries'
import { repositoryError } from './error'

type ClientRow = Awaited<ReturnType<typeof clientQueries.get>>['data']
type ClientListRow = NonNullable<Awaited<ReturnType<typeof clientQueries.list>>['data']>[number]
type MyClientRow = NonNullable<Awaited<ReturnType<typeof clientQueries.getMine>>['data']>[number]

function fromListRow(row: ClientListRow): Client {
  return {
    id: row.id, hasAccount: row.has_account, fullName: row.full_name, canonicalFullName: row.canonical_full_name,
    gender: row.gender as Gender | null,
    ageYears: row.age_years, ageUpdatedAt: row.age_updated_at ? localDate(row.age_updated_at) : null, heightCm: row.height_cm === null ? null : Number(row.height_cm),
    goal: row.goal, note: row.note, currentWeightKg: row.current_weight_kg === null ? null : Number(row.current_weight_kg),
    lastActivityAt: row.last_activity_at,
    archivedAt: row.archived_at, version: row.version, membershipVersion: row.membership_version,
  }
}

async function enrich(row: NonNullable<ClientRow>): Promise<Client> {
  const [note, weight] = await Promise.all([clientQueries.getNote(row.id), clientQueries.getLatestWeight(row.id)])
  if (note.error) throw repositoryError(note.error)
  if (weight.error) throw repositoryError(weight.error)
  return {
    id: row.id, hasAccount: row.auth_user_id !== null, fullName: row.full_name, canonicalFullName: row.full_name,
    gender: row.gender as Gender | null,
    ageYears: row.age_years, ageUpdatedAt: row.age_updated_at ? localDate(row.age_updated_at) : null, heightCm: row.height_cm === null ? null : Number(row.height_cm),
    goal: row.goal, note: note.data?.note ?? null, currentWeightKg: weight.data?.weight_kg === null || weight.data?.weight_kg === undefined ? null : Number(weight.data.weight_kg),
    archivedAt: row.archived_at, version: row.version, membershipVersion: null,
  }
}

const MAX_CLIENT_MERGE_DEPTH = 8

async function resolveClientId(id: string): Promise<string> {
  let currentId = id
  const visited = new Set<string>()
  for (let depth = 0; depth < MAX_CLIENT_MERGE_DEPTH; depth += 1) {
    if (visited.has(currentId)) throw new Error('Не удалось открыть актуальную карточку клиента')
    visited.add(currentId)
    const result = await clientQueries.get(currentId)
    if (result.error) throw repositoryError(result.error)
    const mergedIntoClientId = result.data.merged_into_client_id
    if (!mergedIntoClientId) return currentId
    currentId = mergedIntoClientId
  }
  throw new Error('Не удалось открыть актуальную карточку клиента')
}

export const clientsRepository = {
  async getMine(): Promise<Client | null> {
    const result = await clientQueries.getMine()
    if (result.error) throw repositoryError(result.error)
    const row: MyClientRow | undefined = result.data[0]
    if (!row) return null
    return {
      id: row.id, hasAccount: true, fullName: row.full_name, canonicalFullName: row.full_name,
      gender: row.gender as Gender | null,
      ageYears: row.age_years, ageUpdatedAt: row.age_updated_at ? localDate(row.age_updated_at) : null, heightCm: row.height_cm === null ? null : Number(row.height_cm),
      goal: row.goal, note: null, currentWeightKg: row.current_weight_kg === null ? null : Number(row.current_weight_kg),
      archivedAt: row.archived_at, version: row.version, membershipVersion: null,
    }
  },
  resolveId: resolveClientId,
  async list(includeArchived = false): Promise<Client[]> {
    const result = await clientQueries.list(includeArchived)
    if (result.error) throw repositoryError(result.error)
    return result.data.map(fromListRow)
  },
  async listAttentionPreferences(trainerId: string): Promise<ClientAttentionPreference[]> {
    const result = await clientQueries.listAttentionPreferences(trainerId)
    if (result.error) throw repositoryError(result.error)
    return result.data.map((row) => ({
      clientId: row.client_id,
      snoozedUntil: row.attention_snoozed_until ?? undefined,
    }))
  },
  async get(id: string): Promise<Client> {
    const canonicalId = await resolveClientId(id)
    const ownResult = await clientQueries.getMine()
    if (ownResult.error) throw repositoryError(ownResult.error)
    const ownRow: MyClientRow | undefined = ownResult.data[0]
    if (ownRow?.id === canonicalId) {
      return {
        id: ownRow.id, hasAccount: true, fullName: ownRow.full_name, canonicalFullName: ownRow.full_name,
        gender: ownRow.gender as Gender | null,
        ageYears: ownRow.age_years, ageUpdatedAt: ownRow.age_updated_at ? localDate(ownRow.age_updated_at) : null, heightCm: ownRow.height_cm === null ? null : Number(ownRow.height_cm),
        goal: ownRow.goal, note: null,
        currentWeightKg: ownRow.current_weight_kg === null ? null : Number(ownRow.current_weight_kg),
        archivedAt: ownRow.archived_at, version: ownRow.version, membershipVersion: null,
      }
    }
    const result = await clientQueries.list(true)
    if (result.error) throw repositoryError(result.error)
    const client = result.data.map(fromListRow).find((item) => item.id === canonicalId)
    if (!client) throw new Error('Карточка клиента не найдена')
    return client
  },
  async create(input: CreateClientInput): Promise<string> {
    const result = await clientQueries.create(input)
    if (result.error) throw repositoryError(result.error)
    return result.data
  },
  async createQuick(fullName: string): Promise<string> {
    const result = await clientQueries.createQuick(fullName)
    if (result.error) throw repositoryError(result.error)
    return result.data
  },
  async createQuickOwn(fullName: string): Promise<string> {
    const result = await clientQueries.createQuickOwn(fullName)
    if (result.error) throw repositoryError(result.error)
    return result.data
  },
  async createOwn(input: CreateClientInput): Promise<string> {
    const result = await clientQueries.createOwn(input)
    if (result.error) throw repositoryError(result.error)
    return result.data
  },
  async update(input: UpdateClientInput): Promise<void> {
    const result = await clientQueries.update(input)
    if (result.error) throw repositoryError(result.error)
  },
  async updateOwn(input: UpdateClientInput): Promise<void> {
    const result = await clientQueries.updateOwn(input)
    if (result.error) throw repositoryError(result.error)
  },
  async updatePreferences(input: UpdateClientTrainerPreferencesInput): Promise<void> {
    const result = await clientQueries.updatePreferences(input)
    if (result.error) throw repositoryError(result.error)
  },
  async setArchived(client: Client, archived: boolean): Promise<Client> {
    const result = await clientQueries.setArchived(client.id, client.version, archived)
    if (result.error) throw repositoryError(result.error)
    return enrich(result.data)
  },
}
