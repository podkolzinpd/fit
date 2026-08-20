import { z } from 'zod'
import { yandexPilotQueries } from '../queries/yandex-pilot.queries'

const profileSchema = z.object({
  accessMode: z.literal('read_only'),
  profile: z.object({
    id: z.uuid(),
    firstName: z.string().nullable(),
    lastName: z.string().nullable(),
    timezone: z.string().min(1),
    accountRole: z.enum(['trainer', 'client']),
  }),
})

const sessionSchema = profileSchema.extend({
  session: z.object({
    token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    expiresAt: z.iso.datetime(),
  }),
})

const clientSchema = z.object({
  id: z.uuid(),
  hasAccount: z.boolean(),
  fullName: z.string().min(1),
  canonicalFullName: z.string().min(1),
  gender: z.enum(['male', 'female']).nullable(),
  ageYears: z.number().int().min(1).max(119).nullable(),
  ageUpdatedAt: z.iso.date().nullable(),
  heightCm: z.number().positive().max(260).nullable(),
  goal: z.string().nullable(),
  note: z.string().nullable(),
  currentWeightKg: z.null(),
  lastActivityAt: z.iso.datetime(),
  archivedAt: z.iso.datetime().nullable(),
  version: z.number().int().positive(),
  membershipVersion: z.number().int().positive(),
})

const clientsSchema = z.object({
  accessMode: z.literal('read_only'),
  clients: z.array(clientSchema),
})

export type YandexPilotSession = z.infer<typeof sessionSchema>
export type YandexPilotClient = z.infer<typeof clientSchema>

function responseError(status: number): Error {
  if (status === 401) return new Error('Yandex ID не подтвердил вход. Начните заново.')
  if (status === 403) return new Error('Этот аккаунт пока не добавлен в пилот.')
  if (status === 404) return new Error('Профиль для пилота не найден.')
  if (status === 503) return new Error('Пилот временно недоступен. Попробуйте позднее.')
  return new Error('Не удалось проверить доступ к пилоту.')
}

function clientsResponseError(status: number): Error {
  if (status === 401) return new Error('Сессия пилота истекла. Начните вход через Yandex ID заново.')
  if (status === 503) return new Error('Пилот временно недоступен. Попробуйте позднее.')
  return new Error('Не удалось загрузить клиентов из stage.')
}

export const yandexPilotRepository = {
  async exchangeCodeForSession(apiBaseUrl: string, code: string, codeVerifier: string): Promise<YandexPilotSession> {
    let response: Response
    try {
      response = await yandexPilotQueries.exchangeCodeForSession(apiBaseUrl, code, codeVerifier)
    } catch {
      throw new Error('Не удалось подключиться к Yandex Cloud stage.')
    }
    if (!response.ok) throw responseError(response.status)
    const result = sessionSchema.safeParse(await response.json())
    if (!result.success) throw new Error('Stage вернул неподдерживаемый формат сессии.')
    return result.data
  },
  async listClients(apiBaseUrl: string, sessionToken: string): Promise<YandexPilotClient[]> {
    let response: Response
    try {
      response = await yandexPilotQueries.listClients(apiBaseUrl, sessionToken)
    } catch {
      throw new Error('Не удалось подключиться к Yandex Cloud stage.')
    }
    if (!response.ok) throw clientsResponseError(response.status)
    const result = clientsSchema.safeParse(await response.json())
    if (!result.success) throw new Error('Stage вернул неподдерживаемый формат клиентов.')
    return result.data.clients
  },
}
