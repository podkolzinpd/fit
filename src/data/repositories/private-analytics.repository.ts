import { yandexAppSessionTransport } from '../yandex-app-session-transport'
import { createYandexMainQueries } from '../queries/yandex-main.queries'
import { z } from 'zod'

export type AnalyticsRow = Record<string, unknown>
export type PrivateAnalyticsBundle = { trainersTotal: number; trainers: AnalyticsRow[]; clients: AnalyticsRow[]; feedback: AnalyticsRow[]; computedAt: string }
const row = z.record(z.string(), z.unknown())
const bundle = z.object({ trainersTotal: z.number().int().nonnegative(), trainers: z.array(row), clients: z.array(row), feedback: z.array(row), computedAt: z.iso.datetime({ offset: true }) })

export async function loadPrivateAnalytics(): Promise<PrivateAnalyticsBundle> {
  const transport = yandexAppSessionTransport()
  if (!transport) throw new Error('Сессия завершена. Войдите снова.')
  const response = await createYandexMainQueries(transport.apiBaseUrl, transport.sessionToken).read('/v1/private-analytics')
  if (response.status === 403) throw new Error('Нет доступа к аналитике. Если доступ вам уже назначен, выйдите из ФИТ и войдите снова через Яндекс ID.')
  if (response.status === 401) throw new Error('Сессия завершена. Войдите снова.')
  if (!response.ok) throw new Error('Не удалось загрузить аналитику. Попробуйте ещё раз.')
  const parsed = bundle.safeParse(await response.json())
  if (!parsed.success) throw new Error('Ответ аналитики имеет неверный формат.')
  return parsed.data
}
