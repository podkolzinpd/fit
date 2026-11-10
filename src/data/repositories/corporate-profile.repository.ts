import { z } from 'zod'
import type { TrainerProfileEditorRepository } from '../contracts/trainer-profiles'
import { corporateProfileRequest } from '../queries/corporate-profile.queries'
import { trainerProfessionalProfileSchema, trainerProfileManagementSchema } from '../../shared/trainer-profile'
import type { TrainerProfileWriteContext } from '../../shared/domain'
import { RepositoryError } from './error'

const view = z.object({ profile: trainerProfessionalProfileSchema.nullable(), management: trainerProfileManagementSchema })
const auditEntry = z.object({ id:z.uuid(), actor_id:z.uuid().nullable(), actor_name:z.string(), action:z.string(), before_data:z.unknown(), after_data:z.unknown(), occurred_at:z.string() })
export type CorporateProfileAuditEntry = z.infer<typeof auditEntry>

async function response(target:string,suffix='',body?:object):Promise<unknown> {
  const result=await corporateProfileRequest(target,suffix,body)
  if(!result.ok) {
    if(result.status===401) throw new RepositoryError('session_expired','Сессия завершена. Войдите в ФИТ снова.')
    if(result.status===403) throw new RepositoryError('profile_forbidden','Редактирование недоступно. Проверьте статус тренера и обновите список.')
    if(result.status===409) throw new RepositoryError('PT409','Анкета или права уже изменились. Ваш текст сохранён в открытой форме; загрузите актуальную версию перед продолжением.')
    if(result.status===422) throw new RepositoryError('invalid','Проверьте поля и ограничения фотографий.')
    throw new RepositoryError('unavailable','Не удалось выполнить действие с анкетой. Повторите попытку.')
  }
  return result.json()
}
export const corporateProfilesRepository={
  async read(target:string){return view.parse(await response(target))},
  async setManagement(target:string,managed:boolean,version:number,commandId:string){return trainerProfileManagementSchema.parse(await response(target,'/management',{managed,version,commandId}))},
  async history(target:string,offset=0){return z.object({entries:z.array(auditEntry)}).parse(await response(target,`/history?offset=${offset}`)).entries},
  editor(target:string):TrainerProfileEditorRepository {
    const command=async(action:string,payload:object,context?:TrainerProfileWriteContext)=>{
      if(!context) throw new RepositoryError('invalid','Загрузите актуальную анкету перед редактированием.')
      return trainerProfessionalProfileSchema.parse(await response(target,'/command',{action,...payload,...context}))
    }
    return {
      getOwn:async()=> (await corporateProfilesRepository.read(target)).profile,
      getManagement:async()=> (await corporateProfilesRepository.read(target)).management,
      saveDraft:(draft,context)=>command('save',{draft},context),
      uploadPhoto:(draft,photo,replaceLegacy=false,context)=>command('upload',{draft,photo,replaceLegacy},context),
      reorderPhotos:(photoIds,context)=>command('reorder',{photoIds},context),
      deletePhoto:(photoId,context)=>command('delete',{photoId},context),
      publish:context=>command('publish',{},context),unpublish:context=>command('unpublish',{},context),
      setCatalogListing:(listed,context)=>command('catalog',{listed},context),
    }
  },
}
