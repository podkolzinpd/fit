/** Corporate duty API contract. Capabilities are checked independently of UI pilots. */
export interface CorporateDuty {
 id:string; trainerId:string; officeId:string; officeName:string; officeCity:string; timeZone:string
 startedAt:string; endedAt:string|null; version:number; status:'open'|'completed'|'review'|'void'; seconds:number|null
}
export interface CorporateDutyAccess {
 allowed:boolean; hasHistory:boolean; active:CorporateDuty|null
 offices:Array<{id:string;name:string;city:string;timeZone:string|null}>
}
export interface CorporateDutyCommand {
 commandId:string; id:string; action:'start'|'stop'|'correct'|'void'|'restore'|'confirm'; version:number
 officeId?:string; startedAt?:string; endedAt?:string; reason?:string
}
export interface CorporateDutyOffice {id:string;name:string;city:string;archived:boolean;timeZone:string|null;zoneVersion:number}
export interface CorporateDutyCounts {seconds:number;days:number;completed:number}
export interface CorporateDutyReport extends CorporateDutyCounts {
 open:number;review:number;records:CorporateDuty[];nextCursor:{at:string;id:string}|null
 trainers:Array<{id:string;name:string}>;offices:CorporateDutyOffice[]
 byTrainer:Array<CorporateDutyCounts&{trainerId:string}>;byOffice:Array<CorporateDutyCounts&{officeId:string}>
}
