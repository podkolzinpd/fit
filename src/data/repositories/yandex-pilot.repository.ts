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

export type YandexPilotProfile = z.infer<typeof profileSchema>

function responseError(status: number): Error {
  if (status === 401) return new Error('Yandex ID не подтвердил вход. Начните заново.')
  if (status === 403) return new Error('Этот аккаунт пока не добавлен в пилот.')
  if (status === 404) return new Error('Профиль для пилота не найден.')
  if (status === 503) return new Error('Пилот временно недоступен. Попробуйте позднее.')
  return new Error('Не удалось проверить доступ к пилоту.')
}

export const yandexPilotRepository = {
  async exchangeCodeForProfile(apiBaseUrl: string, code: string, codeVerifier: string): Promise<YandexPilotProfile> {
    let response: Response
    try {
      response = await yandexPilotQueries.exchangeCodeForProfile(apiBaseUrl, code, codeVerifier)
    } catch {
      throw new Error('Не удалось подключиться к Yandex Cloud stage.')
    }
    if (!response.ok) throw responseError(response.status)
    const result = profileSchema.safeParse(await response.json())
    if (!result.success) throw new Error('Stage вернул неподдерживаемый формат профиля.')
    return result.data
  },
}
