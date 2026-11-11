import { z } from 'zod'
import { corporateInvitationPreview, corporateInvitationRequest } from '../queries/corporate-invitations.queries'
const status=z.enum(['active','claimed','approved','revoked','expired'])
const invitation=z.object({id:z.uuid(),status,createdAt:z.iso.datetime({offset:true}),expiresAt:z.iso.datetime({offset:true}),officeIds:z.array(z.uuid()),trainerName:z.string().nullable(),recipientEmail:z.string().nullable().optional()})
export type CorporateInvitation=z.infer<typeof invitation>
const preview=z.object({status,expiresAt:z.iso.datetime({offset:true}),offices:z.array(z.object({city:z.string(),name:z.string()}))})
async function read(response:Response):Promise<unknown> {
  const body:unknown=await response.json().catch(()=>null)
  if (response.ok) return body
  const code=z.object({error:z.string()}).safeParse(body)
  const messages:Record<string,string>={
    corporate_forbidden:'Нет доступа к этому действию.',unauthorized:'Войдите в ФИТ снова.',
    corporate_not_found:'Приглашение не найдено.',corporate_invalid:'Выберите действующие офисы. Если офис архивирован, создайте новое приглашение.',
    corporate_trainer_required:'Откройте приглашение из аккаунта тренера.',
    corporate_email_invalid:'Проверьте адрес почты тренера.',
    corporate_recipient_pending:'Для этой почты уже есть активное приглашение. Найдите его в списке или отмените перед созданием нового.',
    corporate_testing_managed:'Сначала выключите управление анкетой администратором.',
    corporate_invitation_unavailable:'Приглашение уже использовано, отменено или срок его действия истёк. Обновите страницу.',
    corporate_conflict:'Данные изменились. Обновите страницу и повторите действие.',corporate_invitation_limit:'Сначала отмените ненужные приглашения.',
  }
  throw new Error(code.success?messages[code.data.error]??'Не удалось выполнить действие. Повторите попытку.':'Не удалось выполнить действие. Повторите попытку.')
}
export const corporateInvitationsRepository={
  async list(){return z.object({invitations:z.array(invitation)}).parse(await read(await corporateInvitationRequest('/v1/admin/invitations'))).invitations},
  async create(id:string,officeIds:string[],recipientEmail?:string){return z.object({id:z.uuid(),token:z.string().regex(/^[a-zA-Z0-9_-]{43}$/)}).parse(await read(await corporateInvitationRequest('/v1/admin/invitations',{id,officeIds,...(recipientEmail?{recipientEmail}:{})})))},
  async decide(id:string,approve:boolean,enableTesting=false){z.object({saved:z.literal(true)}).parse(await read(await corporateInvitationRequest(`/v1/admin/invitations/${id}/${approve?'approve':'revoke'}`,approve?{enableTesting}:{})))},
  async preview(token:string){return z.object({invitation:preview}).parse(await read(await corporateInvitationPreview(token))).invitation},
  async claim(token:string){return z.object({status:z.enum(['claimed','approved','already_member'])}).parse(await read(await corporateInvitationRequest('/v1/corporate-invitations/claim',{token}))).status},
}
