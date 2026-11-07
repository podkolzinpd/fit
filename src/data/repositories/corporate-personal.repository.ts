import { z } from 'zod'
import { yandexAppSessionTransport } from '../yandex-app-session-transport'
import { createYandexMainQueries } from '../queries/yandex-main.queries'
import type { ServiceRange } from './corporate-services.repository'

export class CorporatePersonalError extends Error {
  constructor(public readonly status: number, message: string) { super(message) }
}
async function request(path: string, body?: object): Promise<Response> {
  const session = yandexAppSessionTransport()
  if (!session) return new Response(null, { status: 401 })
  const queries = createYandexMainQueries(session.apiBaseUrl, session.sessionToken)
  try { return await (body === undefined ? queries.read(path) : queries.write(path, 'PUT', body)) }
  catch { throw new CorporatePersonalError(503, 'Ответ не получен. Проверьте сохранённую отметку или повторите сохранение.') }
}
async function read<T>(schema: z.ZodType<T>, response: Response): Promise<T> {
  if (!response.ok) {
    const messages: Record<number,string> = {401:'Войдите в ФИТ снова.',403:'Доступ к корпоративному учёту закрыт.',
      404:'Карточка недоступна для изменения.',409:'Отметка уже изменилась. Загрузите сохранённую версию.',422:'Не удалось сохранить изменение. Обновите карточку.'}
    throw new CorporatePersonalError(response.status,messages[response.status] ?? 'Не удалось загрузить данные. Повторите попытку.')
  }
  let body: unknown
  try { body = await response.json() } catch { throw new CorporatePersonalError(503,'Не удалось прочитать ответ сервера. Повторите попытку.') }
  const result = schema.safeParse(body)
  if (!result.success) throw new CorporatePersonalError(503,'Не удалось прочитать ответ сервера. Повторите попытку.')
  return result.data
}
const date = z.iso.date()
const mark = z.object({marked:z.boolean(),version:z.number().int().nonnegative(),fromDate:date.nullable()})
export type EmployeeMark = z.infer<typeof mark>
export interface EmployeeCommand {commandId:string;marked:boolean;version:number}
const trainer = z.object({id:z.uuid().nullable(),name:z.string(),count:z.number().int().nonnegative()})
const cursor = z.object({date,id:z.uuid()})
const statistics = z.object({count:z.number().int().nonnegative(),trainers:z.array(trainer),
  records:z.array(z.object({id:z.uuid(),date,trainerId:z.uuid().nullable(),trainerName:z.string(),status:z.literal('done')})),nextCursor:cursor.nullable()})
export type PersonalCursor = z.infer<typeof cursor>
export const corporatePersonalRepository = {
  async access() {
    const response = await request('/v1/corporate-personal/access')
    if ([401,403].includes(response.status)) return false
    return (await read(z.object({allowed:z.boolean()}),response)).allowed
  },
  async mark(clientId: string) { return read(mark,await request(`/v1/corporate-personal/clients/${encodeURIComponent(clientId)}`)) },
  async save(clientId: string, command: EmployeeCommand) { return read(mark,await request(`/v1/corporate-personal/clients/${encodeURIComponent(clientId)}`,command)) },
  async statistics(range: ServiceRange, trainerId: string, after?: PersonalCursor) {
    const params = new URLSearchParams({...range})
    if (trainerId) params.set('trainerId',trainerId)
    if (after) { params.set('cursorDate',after.date); params.set('cursorId',after.id) }
    return read(statistics,await request(`/v1/admin/corporate-personal?${params}`))
  },
}
