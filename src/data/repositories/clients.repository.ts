import type { Client, CreateClientInput, Gender, UpdateClientInput, UpdateClientTrainerPreferencesInput } from '../../shared/domain'
import { localDate } from '../../shared/local-date'
import { clientQueries } from '../queries/clients.queries'
import { repositoryError } from './error'

type ClientRow = Awaited<ReturnType<typeof clientQueries.get>>['data']
type ClientListRow = NonNullable<Awaited<ReturnType<typeof clientQueries.list>>['data']>[number]
type MyClientRow = NonNullable<Awaited<ReturnType<typeof clientQueries.getMine>>['data']>[number]

function fromListRow(row: ClientListRow): Client {
  return {
    id: row.id, hasAccount: row.has_account, fullName: row.full_name, canonicalFullName: row.canonical_full_name,
    gender: row.gender as Gender,
    ageYears: row.age_years, ageUpdatedAt: localDate(row.age_updated_at), heightCm: Number(row.height_cm),
    goal: row.goal, note: row.note, currentWeightKg: row.current_weight_kg === null ? null : Number(row.current_weight_kg),
    archivedAt: row.archived_at, version: row.version, membershipVersion: row.membership_version,
  }
}

async function enrich(row: NonNullable<ClientRow>): Promise<Client> {
  const [note, weight] = await Promise.all([clientQueries.getNote(row.id), clientQueries.getLatestWeight(row.id)])
  if (note.error) throw repositoryError(note.error)
  if (weight.error) throw repositoryError(weight.error)
  return {
    id: row.id, hasAccount: row.auth_user_id !== null, fullName: row.full_name, canonicalFullName: row.full_name,
    gender: row.gender as Gender,
    ageYears: row.age_years, ageUpdatedAt: localDate(row.age_updated_at), heightCm: Number(row.height_cm),
    goal: row.goal, note: note.data?.note ?? null, currentWeightKg: weight.data?.weight_kg === null || weight.data?.weight_kg === undefined ? null : Number(weight.data.weight_kg),
    archivedAt: row.archived_at, version: row.version, membershipVersion: null,
  }
}

export const clientsRepository = {
  async getMine(): Promise<Client | null> {
    const result = await clientQueries.getMine()
    if (result.error) throw repositoryError(result.error)
    const row: MyClientRow | undefined = result.data[0]
    if (!row) return null
    return {
      id: row.id, hasAccount: true, fullName: row.full_name, canonicalFullName: row.full_name,
      gender: row.gender as Gender,
      ageYears: row.age_years, ageUpdatedAt: localDate(row.age_updated_at), heightCm: Number(row.height_cm),
      goal: row.goal, note: null, currentWeightKg: row.current_weight_kg === null ? null : Number(row.current_weight_kg),
      archivedAt: row.archived_at, version: row.version, membershipVersion: null,
    }
  },
  async list(includeArchived = false): Promise<Client[]> {
    const result = await clientQueries.list(includeArchived)
    if (result.error) throw repositoryError(result.error)
    return result.data.map(fromListRow)
  },
  async get(id: string): Promise<Client> {
    const result = await clientQueries.list(true)
    if (result.error) throw repositoryError(result.error)
    const client = result.data.map(fromListRow).find((item) => item.id === id)
    if (!client) throw new Error('Карточка клиента не найдена')
    return client
  },
  async create(input: CreateClientInput): Promise<string> {
    const result = await clientQueries.create(input)
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
  async invite(clientId: string, email: string): Promise<void> {
    const result = await clientQueries.invite(clientId, email)
    if (result.error) throw repositoryError(result.error)
    const payload = result.data as { error?: string } | null
    if (payload?.error) throw new Error(inviteErrorMessage(payload.error))
  },
}

function inviteErrorMessage(code: string): string {
  if (code === 'client_already_linked') return 'У клиента уже есть доступ к приложению.'
  if (code === 'email_already_registered') {
    return 'Этот email уже зарегистрирован. Для безопасности существующий аккаунт нельзя привязать без подтверждения владельца.'
  }
  if (code === 'invite_delivery_failed') return 'Не удалось отправить приглашение. Попробуйте ещё раз.'
  if (code === 'client_link_conflict') return 'Доступ уже был изменён. Обновите карточку клиента.'
  return 'Не удалось пригласить клиента.'
}
