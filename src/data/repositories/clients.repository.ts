import type { Client, CreateClientInput, Gender, UpdateClientInput } from '../../shared/domain'
import { localDate } from '../../shared/local-date'
import { clientQueries } from '../queries/clients.queries'
import { repositoryError } from './error'

type ClientRow = Awaited<ReturnType<typeof clientQueries.get>>['data']

async function enrich(row: NonNullable<ClientRow>): Promise<Client> {
  const [note, weight] = await Promise.all([clientQueries.getNote(row.id), clientQueries.getLatestWeight(row.id)])
  if (note.error) throw repositoryError(note.error)
  if (weight.error) throw repositoryError(weight.error)
  return {
    id: row.id, fullName: row.full_name, gender: row.gender as Gender,
    ageYears: row.age_years, ageUpdatedAt: localDate(row.age_updated_at), heightCm: Number(row.height_cm),
    goal: row.goal, note: note.data?.note ?? null, currentWeightKg: weight.data?.weight_kg === null || weight.data?.weight_kg === undefined ? null : Number(weight.data.weight_kg),
    archivedAt: row.archived_at, version: row.version,
  }
}

export const clientsRepository = {
  async list(includeArchived = false): Promise<Client[]> {
    const result = await clientQueries.list(includeArchived)
    if (result.error) throw repositoryError(result.error)
    return Promise.all(result.data.map(enrich))
  },
  async get(id: string): Promise<Client> {
    const result = await clientQueries.get(id)
    if (result.error) throw repositoryError(result.error)
    return enrich(result.data)
  },
  async create(input: CreateClientInput): Promise<string> {
    const result = await clientQueries.create(input)
    if (result.error) throw repositoryError(result.error)
    return result.data
  },
  async update(input: UpdateClientInput): Promise<void> {
    const result = await clientQueries.update(input)
    if (result.error) throw repositoryError(result.error)
  },
  async setArchived(client: Client, archived: boolean): Promise<Client> {
    const result = await clientQueries.setArchived(client.id, client.version, archived)
    if (result.error) throw repositoryError(result.error)
    return enrich(result.data)
  },
}
