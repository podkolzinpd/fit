import { yandexAppSessionTransport } from '../yandex-app-session-transport'
import { createYandexMainQueries } from '../queries/yandex-main.queries'
import { z } from 'zod'

const explorer = z.object({
  retentionMeasured:z.boolean(), revision:z.string(), computedAt:z.iso.datetime({offset:true}), observationStartedAt:z.iso.datetime({offset:true}),
  total:z.number().int().nonnegative(), rows:z.array(z.record(z.string(),z.union([z.string(),z.number(),z.boolean(),z.null()]))),
  summary:z.record(z.string(),z.number()),
  trend:z.array(z.object({date:z.string(),actions:z.number(),users:z.number(),registrations:z.number()})),
  features:z.array(z.record(z.string(),z.union([z.string(),z.number(),z.boolean(),z.null()]))),
})
export async function explorePrivateAnalytics(filters: import('../../features/private-analytics/analytics-model').AnalyticsFilters) {
  const transport = yandexAppSessionTransport()
  if (!transport) throw new Error('Сессия завершена. Войдите снова.')
  const response=await createYandexMainQueries(transport.apiBaseUrl,transport.sessionToken).write('/v1/private-analytics/explore','POST',filters)
  if(response.status===403) throw new Error('Нет доступа к аналитике. Войдите разрешённым аккаунтом.')
  if(response.status===401) throw new Error('Сессия завершена. Войдите снова.')
  if(response.status===422) throw new Error('Проверьте фильтры: период от 1 дня до 3 лет.')
  if(!response.ok) throw new Error('Не удалось загрузить аналитику. Попробуйте ещё раз.')
  const parsed=explorer.safeParse(await response.json())
  if(!parsed.success) throw new Error('Ответ аналитики имеет неверный формат.')
  return parsed.data
}
