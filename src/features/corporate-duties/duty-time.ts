import type { CorporateDuty } from '../../data/repositories/corporate-duties.repository'
export function dutyDuration(seconds:number){
 const minutes=Math.floor(seconds/60),hours=Math.floor(minutes/60)
 return `${hours} ч ${minutes%60} мин`
}
export function dutyMoment(value:string,zone:string){return new Intl.DateTimeFormat('ru-RU',{timeZone:zone,day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(value))}
export const dutyStatus:Record<CorporateDuty['status'],string>={open:'Открыто',completed:'Завершено',review:'Требует проверки',void:'Аннулировано'}
export function dutyLocalInput(value:string,zone:string){
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(value))
 const get=(key:string)=>parts.find(p=>p.type===key)!.value
 return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`
}
