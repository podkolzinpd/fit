import {expect,type Page} from '@playwright/test'
import {clientId,trainerId,coachGestureWorkout,mockPilot} from './fit-lime-fixtures'
import {observeEditorImages} from './lime-editor-skin.probe'

export type HomeSkinSample={role:'client'|'trainer';theme:'light'|'dark';width:number;mode:string;lime:boolean;density?:'comfortable'|'compact';reference?:boolean}
export const homeToday='2026-11-14'
export const homeWeek='2026-11-09'
export const homeLongExerciseName='Приседания со штангой с контролем техники, темпа и полного диапазона движения'
export async function prepareHomeSkin(page:Page,sample:HomeSkinSample){
 observeEditorImages(page)
 const actor=sample.role==='client'?(sample.reference===false?'10000000-0000-4000-8000-000000000002':'c11e0000-6010-4000-8000-000000000001'):'c0ac0000-6010-4000-8000-000000000001'
 await page.setViewportSize({width:sample.width,height:sample.width===1440?1000:844})
 await page.emulateMedia({reducedMotion:'reduce'})
 await page.addInitScript(({actor,theme,mode})=>{
  const NativeDate=Date,fixed=NativeDate.parse('2026-11-14T09:30:00Z')
  window.Date=new Proxy(NativeDate,{construct:(t,a,n)=>Reflect.construct(t,a.length?a:[fixed],n)as Date,apply:()=>new NativeDate(fixed).toString(),get:(t,k,r)=>k==='now'?()=>fixed:Reflect.get(t,k,r)as unknown})
  localStorage.setItem('fit.appTheme',theme);localStorage.setItem('fit.clientLime.theme.'+actor,theme)
  if(mode==='draft'){
   const id='mc55-retained',draft={screen:'compose',text:'Приседания 3 по 10, 60 кг',choices:{},items:[],clientId:'10000000-0000-4000-8000-000000000002',workoutDate:'2026-11-14',recordMode:'planned'}
   localStorage.setItem('fit.client-today-drafts.'+actor,JSON.stringify([id]));localStorage.setItem('fit.today-draft.'+actor+'.plan.client-'+id,JSON.stringify(draft))
  }
 },{actor,theme:sample.theme,mode:sample.mode})
 const base=coachGestureWorkout(false,3),owner=sample.role==='trainer'?actor:trainerId
 if(sample.role==='client'&&sample.mode==='long')base.exercises[0]!.name=homeLongExerciseName
 const make=(index:number,status:typeof base.status,date:string,startTime:string|null)=>({...structuredClone(base),id:index===0?base.id:`55000000-0000-4000-8000-${String(index).padStart(12,'0')}`,trainerId:owner,createdBy:owner,workoutDate:date,startTime,endTime:startTime?String(Number(startTime.slice(0,2))+1).padStart(2,'0')+startTime.slice(2):null,status,title:sample.mode==='long'?'Длинное название персональной тренировки: техника, сила и восстановление без потери сохранённых значений':'Тренировка MC55',clientName:sample.mode==='long'?'Алексей Александрович Смирнов-Задонский':'Алексей Смирнов'})
 let workouts=[make(0,'planned',homeToday,'12:30'),make(1,'done','2026-11-13','11:00'),make(2,'planned','2026-11-16','10:00'),make(3,'cancelled',homeToday,'15:00'),make(4,'planned',homeToday,null)]
 if(sample.mode==='active')workouts[0]={...workouts[0]!,status:'in_progress'}
 if(sample.mode==='future')workouts=[make(0,'planned','2026-11-16','10:00'),make(1,'done','2026-11-13','11:00')]
 if(sample.role==='trainer'&&sample.mode==='statuses')workouts=[
  {...make(0,'done','2026-11-13','10:00'),trainingFormat:'with_trainer'},
  {...make(1,'planned','2026-11-13','12:00'),trainingFormat:'with_trainer'},
  {...make(2,'cancelled','2026-11-13','15:00'),trainingFormat:'with_trainer'},
  {...make(3,'planned','2026-11-13','16:00'),trainingFormat:'self'},
 ]
 if(sample.mode==='past')workouts=[make(0,'planned','2026-11-12','12:30'),make(1,'done','2026-11-11','11:00')]
 if(sample.mode==='empty'||sample.mode==='first'||sample.mode==='preset')workouts=[]
 if(sample.role==='trainer'&&sample.mode==='day')workouts.push(make(5,'in_progress',homeToday,'12:30'))
 await page.route('**/v1/**',route=>route.abort())
 const backend=await mockPilot(page,{role:sample.role,profileId:actor,clientTrainerId:sample.mode==='empty'||sample.mode==='first'||sample.mode==='preset'?actor:trainerId,clientLime:sample.role==='client'&&sample.lime,fitLime:sample.role==='trainer'&&sample.lime,pilot:sample.mode!=='v1',scheduleDensity:sample.density??'comfortable',workouts,withGoal:true,withMeasurements:true,failTrainingData:sample.mode==='error',failClients:sample.mode==='queue-error',failWorkspace:sample.mode==='inbox-error'})
 await page.route('**/v1/push-notifications/status',route=>route.fulfill({json:{status:{subscribed:false,preferences:{workout_reminder:true,workout_scheduled:true,chat_message:true}}}}))
 const initialWorkouts=structuredClone(backend.getWorkouts()),initialHistory=JSON.stringify(initialWorkouts)
 if(sample.mode==='first')await page.route('**/v1/clients',route=>route.fulfill({json:{clients:[]}}))
 await page.route(`**/v1/clients/${clientId}/progress/regularity`,route=>route.fulfill({json:{regularity:[{period:'week',periodStart:homeWeek,periodEnd:'2026-11-15',plannedCount:2,completedCount:1,completedPlannedCount:1,partialCount:0,skippedCount:0,completionPercent:50}]}}))
 let release=()=>{},held=0
 const gate=new Promise<void>(resolve=>{release=resolve})
 if(sample.mode==='loading')await page.route('**/v1/training-data?*',async route=>{held++;await gate;await route.fallback()})
 const writes:{method:string;path:string;body:unknown}[]=[],reads:string[]=[],errors:string[]=[],failed:{method:string;path:string;error:string|null}[]=[],responses:{method:string;path:string;status:number}[]=[]
 page.on('request',request=>{const u=new URL(request.url());if(u.pathname.startsWith('/v1/')&&request.method()==='GET')reads.push(u.pathname+u.search)})
 page.on('pageerror',error=>errors.push(error.message))
 page.on('requestfailed',request=>failed.push({method:request.method(),path:new URL(request.url()).pathname,error:request.failure()?.errorText??null}))
 page.on('response',response=>{if(response.status()>=400)responses.push({method:response.request().method(),path:new URL(response.url()).pathname,status:response.status()})})
 // No action in this paint matrix may mutate even the synthetic backend.
 await page.route('**/v1/**',async route=>{
  const request=route.request(),method=request.method()
  if(method==='GET'||method==='OPTIONS')return route.fallback()
  const raw=request.postDataBuffer(),type=request.headers()['content-type']??''
  writes.push({method,path:new URL(request.url()).pathname,body:raw?(type.includes('json')?JSON.parse(raw.toString()):{contentType:type,encoding:'base64',raw:raw.toString('base64')}):null})
  await route.abort('blockedbyclient')
 })
 return {actor,backend,initialWorkouts,reads,writes,diagnostics:{errors,failed,responses},release:()=>release(),held:()=>held,recover:()=>{backend.setTrainingDataFailure(false);backend.setClientsFailure(false);backend.setWorkspaceFailure(false);backend.setThreadsFailure(false)},workouts:()=>structuredClone(backend.getWorkouts()),unchanged:()=>JSON.stringify(backend.getWorkouts())===initialHistory,assertDiagnostics:()=>{
  expect(errors).toEqual([]);expect(failed).toEqual([]);expect(writes).toEqual([])
  const allowed=sample.mode==='error'?new Set(['/v1/training-data','/v1/workouts/home',`/v1/clients/${clientId}/workout-stats`]):sample.mode==='queue-error'?new Set(['/v1/clients']):sample.mode==='inbox-error'?new Set(['/v1/trainer-workspace']):new Set<string>()
  expect(responses.filter(response=>response.status!==503||!allowed.has(response.path))).toEqual([])
 }}
}
