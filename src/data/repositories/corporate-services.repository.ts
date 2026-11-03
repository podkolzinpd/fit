import { z } from 'zod'
import { corporateServiceRequest as request } from '../queries/corporate-services.queries'

export const corporateServiceKind = z.enum(['tour', 'consultation', 'instruction', 'intro'])
export type CorporateServiceKind = z.infer<typeof corporateServiceKind>
const instant = z.iso.datetime({ offset: true })
const office = z.object({ id: z.uuid(), city: z.string(), name: z.string() })
const service = z.object({ id: z.uuid(), kind: corporateServiceKind, officeId: z.uuid().nullable(), city: z.string(), officeName: z.string(), occurredAt: instant, version: z.number().int().positive(), voidedAt: instant.nullable(), createdAt: instant, updatedAt: instant })
export type CorporateService = z.infer<typeof service>
export type ServiceOffice = z.infer<typeof office>
export interface ServiceRange { from: string; until: string }
export interface ServiceDraft { commandId: string; id: string; kind: CorporateServiceKind; officeId: string; occurredAt: string; version: number }
export interface ServiceCursor { at: string; id: string }
const receipt = z.object({ saved: z.literal(true), id: z.uuid(), version: z.number().int().positive() })
export class CorporateServiceError extends Error {
  constructor(public readonly status: number, message: string) { super(message) }
}
async function read(response: Response): Promise<unknown> {
  if (response.ok) {
    try { return await response.json() } catch { throw new CorporateServiceError(503, 'Ответ сервера повреждён. Повторите попытку.') }
  }
  const messages: Record<number, string> = {
    401: 'Войдите в ФИТ снова.', 403: 'Нет доступа к учёту услуг.', 404: 'Запись не найдена.',
    409: 'Запись уже изменилась. Загрузите сохранённую версию перед новым исправлением.',
    422: 'Проверьте дату, время и действующий офис. Будущую услугу сохранить нельзя.',
  }
  throw new CorporateServiceError(response.status, messages[response.status] ?? 'Не удалось выполнить действие. Ввод сохранён — повторите попытку.')
}
function validated<T>(schema: z.ZodType<T>, body: unknown): T {
  const value = schema.safeParse(body)
  if (!value.success) throw new CorporateServiceError(503, 'Не удалось прочитать ответ сервера. Повторите попытку.')
  return value.data
}
const params = (range: ServiceRange) => new URLSearchParams({ from: range.from, until: range.until })
export const corporateServicesRepository = {
  async access() {
    const response = await request('/v1/corporate-services/access')
    if ([401, 403].includes(response.status)) return false
    return validated(z.object({ allowed: z.boolean() }), await read(response)).allowed
  },
  async list(range: ServiceRange, cursor?: ServiceCursor) {
    const query = params(range)
    if (cursor) { query.set('cursorAt', cursor.at); query.set('cursorId', cursor.id) }
    return validated(z.object({ records: z.array(service), nextCursor: z.object({ at: instant, id: z.uuid() }).nullable(), offices: z.array(office), timeZone: z.string() }), await read(await request(`/v1/corporate-services?${query}`)))
  },
  async record(id: string) { return validated(service, await read(await request(`/v1/corporate-services/${encodeURIComponent(id)}`))) },
  async save(draft: ServiceDraft) { return validated(receipt, await read(await request('/v1/corporate-services', draft))) },
  async void(id: string, commandId: string, version: number) { return validated(receipt, await read(await request(`/v1/corporate-services/${encodeURIComponent(id)}/void`, { commandId, version }))) },
  async audit(id: string, beforeVersion?: number) {
    const suffix = beforeVersion === undefined ? '' : `?beforeVersion=${beforeVersion}`
    return validated(z.object({ events: z.array(z.object({ action: z.enum(['create', 'update', 'void']), at: instant, version: z.number().int().positive(), before: service.nullable(), after: service })), nextBeforeVersion: z.number().int().positive().nullable() }), await read(await request(`/v1/corporate-services/${encodeURIComponent(id)}/audit${suffix}`)))
  },
  async statistics(range: ServiceRange, trainerId: string, officeId: string) {
    const query = params(range)
    if (trainerId) query.set('trainerId', trainerId)
    if (officeId) query.set('officeId', officeId)
    return validated(z.object({ counts: z.object({ tour: z.number().int().nonnegative(), consultation: z.number().int().nonnegative(), instruction: z.number().int().nonnegative(), intro: z.number().int().nonnegative() }), timeZone: z.string(), offices: z.array(office.extend({ archived: z.boolean() })), trainers: z.array(z.object({ id: z.uuid(), name: z.string(), active: z.boolean() })) }), await read(await request(`/v1/admin/corporate-services?${query}`)))
  },
}
