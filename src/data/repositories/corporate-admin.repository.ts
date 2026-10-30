import { z } from 'zod'
import type { CorporateAdminBundle, CorporateOffice, CorporateTrainer } from '../../shared/corporate-admin'
import { corporateAdminRequest } from '../queries/corporate-admin.queries'
import { RepositoryError } from './error'

const office = z.object({ id: z.uuid(), city: z.string(), name: z.string(), address: z.string(), archived: z.boolean(), version: z.number().int().nonnegative() })
const trainer = z.object({ id: z.uuid(), name: z.string(), isYandex: z.boolean(), officeIds: z.array(z.uuid()), version: z.number().int().nonnegative(),
  publicId: z.uuid().nullable().optional(), publishedName: z.string().nullable().optional(), photoUrl: z.string().nullable().optional(), photoUnavailable: z.boolean().optional() })
const bundle = z.object({ offices: z.array(office), trainers: z.array(trainer) })

async function response(path: Parameters<typeof corporateAdminRequest>[0], body?: object): Promise<unknown> {
  const result = await corporateAdminRequest(path, body)
  if (!result.ok) {
    const error = z.object({ error: z.string() }).safeParse(await result.json().catch(() => null))
    const code = error.success ? error.data.error : 'unavailable'
    const messages: Record<string, string> = {
      corporate_forbidden: 'Нет доступа к кабинету администратора.',
      unauthorized: 'Сессия завершена. Войдите в ФИТ снова.',
      corporate_conflict: 'Данные уже изменены. Обновите список и повторите изменение.',
      corporate_office_in_use: 'Это единственный активный офис у тренера Яндекса. Сначала назначьте другой офис или отключите отметку тренера.',
      corporate_office_duplicate: 'Такой офис уже есть в справочнике.',
      corporate_invalid: 'Проверьте поля и выберите действующие офисы.',
    }
    throw new RepositoryError(code, messages[code] ?? 'Не удалось выполнить действие. Повторите попытку.')
  }
  return result.json()
}
export const corporateAdminRepository = {
  async access(): Promise<boolean> {
    const result = await corporateAdminRequest('access')
    if (result.status === 401 || result.status === 403) return false
    if (!result.ok) throw new Error('Не удалось проверить доступ. Повторите попытку.')
    return z.object({ allowed: z.boolean() }).parse(await result.json()).allowed
  },
  async bundle(): Promise<CorporateAdminBundle> { return bundle.parse(await response('bundle')) },
  async saveOffice(draft: CorporateOffice): Promise<void> {
    z.object({ saved: z.literal(true) }).parse(await response('offices', draft))
  },
  async saveTrainer(draft: CorporateTrainer): Promise<void> {
    z.object({ saved: z.literal(true) }).parse(await response('trainers', { id: draft.id, isYandex: draft.isYandex, officeIds: draft.officeIds, version: draft.version }))
  },
}
