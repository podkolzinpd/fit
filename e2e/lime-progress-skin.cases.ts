import {expect,test,type Page,type Route,type Request} from '@playwright/test'
import {readFile,writeFile} from 'node:fs/promises'
import {mockPilot,coachGestureWorkout,clientId,trainerId,type MockWorkout} from './fit-lime-fixtures'
import {mockProgressBundle} from './native-progress-fixture'
import {localDate} from '../src/shared/local-date'
import {summaryPeriodRange} from '../src/features/progress/summary-period'
import type {InBodyMeasurement} from '../src/shared/domain'
import {observeEditorImages,probeEditorSkin,assertEditorOwnership} from './lime-editor-skin.probe'
import {progressContract} from './lime-progress-skin.contract'

type Bundle=Parameters<typeof mockProgressBundle>[1]
type Entry=NonNullable<Bundle['entries']>[number]&{inBody?:InBodyMeasurement}
type Metric=NonNullable<Bundle['customMetrics']>[number]
type Sample={role:'client'|'trainer';theme:'light'|'dark';width:number;mode:string;lime:boolean;reference?:boolean;gender?:'male'|'female'|null;list?:boolean;onePeriod?:boolean;shellOff?:boolean}
const samples:readonly Sample[]=[
 {role:'client',theme:'light',width:390,mode:'overview',lime:true},
 {role:'client',theme:'dark',width:430,mode:'overview',lime:true},
 {role:'client',theme:'light',width:375,mode:'empty',lime:true},
 {role:'client',theme:'dark',width:1440,mode:'one-period',lime:true,onePeriod:true},
 {role:'client',theme:'light',width:390,mode:'results',lime:true},
 {role:'client',theme:'dark',width:430,mode:'disclosures',lime:true},
 {role:'client',theme:'light',width:390,mode:'body',lime:true,gender:'male'},
 {role:'client',theme:'dark',width:430,mode:'body',lime:true,gender:'female'},
 {role:'client',theme:'dark',width:375,mode:'body-list',lime:true,gender:null,list:true},
 {role:'client',theme:'light',width:430,mode:'running',lime:true},
 {role:'client',theme:'light',width:390,mode:'analysis-generate',lime:true},
 {role:'client',theme:'light',width:390,mode:'measurement-save',lime:true},
 {role:'client',theme:'dark',width:430,mode:'history',lime:true},
 {role:'client',theme:'dark',width:375,mode:'delete-error',lime:true},
 {role:'client',theme:'light',width:375,mode:'metrics-create',lime:true},
 {role:'client',theme:'dark',width:430,mode:'metrics-archive',lime:true},
 {role:'client',theme:'light',width:390,mode:'inbody',lime:true},
 {role:'client',theme:'dark',width:430,mode:'inbody-error',lime:true},
 {role:'client',theme:'light',width:390,mode:'query-error',lime:true},
 {role:'client',theme:'dark',width:375,mode:'analysis-query-error',lime:true},
 {role:'client',theme:'dark',width:390,mode:'history',lime:true,reference:false},
 {role:'trainer',theme:'dark',width:390,mode:'overview',lime:true},
 {role:'trainer',theme:'light',width:430,mode:'overview',lime:true},
 {role:'trainer',theme:'dark',width:390,mode:'measurements',lime:true},
 {role:'trainer',theme:'dark',width:1440,mode:'chart',lime:true},
 {role:'trainer',theme:'light',width:430,mode:'measurement-save',lime:true},
 {role:'trainer',theme:'dark',width:375,mode:'history',lime:true},
 {role:'trainer',theme:'dark',width:430,mode:'delete-error',lime:true},
 {role:'trainer',theme:'light',width:390,mode:'metrics-create',lime:true},
 {role:'trainer',theme:'dark',width:390,mode:'running',lime:true},
 {role:'trainer',theme:'light',width:430,mode:'running-empty',lime:true},
 {role:'trainer',theme:'dark',width:375,mode:'running-query-error',lime:true},
 {role:'trainer',theme:'dark',width:430,mode:'analysis-copy',lime:true},
 {role:'trainer',theme:'dark',width:390,mode:'body',lime:true,gender:'male'},
 {role:'trainer',theme:'light',width:430,mode:'query-error',lime:true},
 {role:'trainer',theme:'dark',width:375,mode:'analysis-query-error',lime:true},
 {role:'client',theme:'light',width:390,mode:'focus',lime:true},
 {role:'client',theme:'dark',width:430,mode:'focus-negative',lime:true},
 {role:'trainer',theme:'dark',width:390,mode:'focus',lime:true},
 {role:'trainer',theme:'dark',width:430,mode:'measurement-focus',lime:true},
 {role:'client',theme:'light',width:390,mode:'body-focus',lime:true,gender:'male'},
 {role:'client',theme:'dark',width:430,mode:'body-focus',lime:true,gender:'female'},
 {role:'client',theme:'dark',width:390,mode:'overview',lime:false},
 {role:'trainer',theme:'dark',width:390,mode:'overview',lime:false},
 {role:'trainer',theme:'dark',width:430,mode:'measurements',lime:false,shellOff:true},
 {role:'client',theme:'dark',width:390,mode:'workouts-control',lime:true},
 {role:'trainer',theme:'dark',width:390,mode:'workouts-control',lime:true},
]
const today=localDate('2026-11-13'),range=summaryPeriodRange('1m',today)
const fixtureId=(n:number)=>'53000000-0000-4000-8000-'+String(n).padStart(12,'0')

async function prepareProgressSkin(page:Page,sample:Sample){
 observeEditorImages(page)
 const actor=sample.lime?(sample.role==='client'?(sample.reference===false?'10000000-0000-4000-8000-000000000002':'c11e0000-6010-4000-8000-000000000001'):'c0ac0000-6010-4000-8000-000000000001'):'10000000-0000-4000-8000-000000000001'
 await page.setViewportSize({width:sample.width,height:sample.width===1440?1000:844});await page.emulateMedia({reducedMotion:'reduce'})
 await page.addInitScript(({actor,theme,clientId,role,list})=>{
  const NativeDate=Date,fixed=NativeDate.parse('2026-11-13T09:00:00Z')
  window.Date=new Proxy(NativeDate,{construct:(t,a,n)=>Reflect.construct(t,a.length?a:[fixed],n) as Date,apply:()=>new NativeDate(fixed).toString(),get:(t,k,r)=>k==='now'?()=>fixed:Reflect.get(t,k,r) as unknown})
  localStorage.setItem('fit.appTheme',theme);localStorage.setItem('fit.clientLime.theme.'+actor,theme)
  localStorage.setItem('fit.bodyMapDisplay.v2.'+role+'.'+actor+'.'+(role==='trainer'?'account':clientId),list?'list':'real')
 },{actor,theme:sample.theme,clientId,role:sample.role,list:sample.list??false})
 const empty=sample.mode==='empty',dates=sample.onePeriod?['2026-11-10','2026-11-11']:['2026-04-20','2026-08-12','2026-09-20','2026-10-20','2026-11-01','2026-11-10']
 const workouts:MockWorkout[]=empty?[]:dates.map((date,i)=>{
  const w=coachGestureWorkout(false,3)
  Object.assign(w,{id:fixtureId(100+i),workoutDate:date,status:'done',createdBy:sample.role==='trainer'?actor:trainerId,trainerId:sample.role==='trainer'?actor:trainerId,startedAt:date+'T08:00:00Z',completedAt:date+'T09:00:00Z',actualDurationSec:3600,sessionRpe:7,wellbeing:'good',discomfort:false,title:'Сила и бег MC53 '+i})
  w.exercises=w.exercises.map((e,j)=>({...e,id:fixtureId(200+i*10+j),ref:j===0?'barbell-bench-press':j===1?'barbell-row':'running',name:j===0?'Жим лёжа':j===1?'Тяга в наклоне':'Бег',muscleGroup:j===0?'chest':j===1?'back':'cardio',inputKind:j===2?'distance':'strength',sets:e.sets.map((s,k)=>({...s,id:fixtureId(400+i*20+j*3+k),fact:j===2?{distanceKm:3+i*0.2,durationSec:1200,rpe:7}:{weightKg:40+i*2,reps:10,rpe:7},confirmedAt:date+'T09:00:00Z'}))}))
  return w
 })
 const backend=await mockPilot(page,{role:sample.role,profileId:actor,clientLime:sample.lime&&sample.role==='client',fitLime:sample.role==='trainer'&&(sample.lime||sample.shellOff),pilot:!sample.shellOff,workouts,clientGender:sample.gender??undefined,withMeasurements:false})
 const workoutHistory=JSON.stringify(backend.getWorkouts())
 const inBody:InBodyMeasurement={schemaVersion:1,skeletalMuscleMassKg:31.5,bodyFatMassKg:17,bodyFatPercent:22,totalBodyWaterL:42,visceralFatAreaCm2:75,deviceModel:'Синтетический InBody MC53',inBodyScore:79}
 let entries:Entry[]=empty?[]:['2026-11-10','2026-10-20','2026-09-20','2026-08-12','2026-05-20'].map((date,i)=>({id:fixtureId(600+i),clientId,createdBy:i===0?actor:trainerId,recordedOn:date,version:1,weightKg:78+i,chestCm:100-i,waistCm:80+i,hipCm:96+i,notes:i===0?'Исходная заметка замера с сохранением истории и версии':null,...(i<2?{inBody:{...inBody,bodyFatPercent:sample.mode==='focus-negative'?25-i:22+i,skeletalMuscleMassKg:31.5-i}}:{})}))
 let metrics:Metric[]=Array.from({length:7},(_,i)=>({id:fixtureId(700+i),clientId,name:['Бицепс Л','Бицепс П','Плечи','Сон','Пульс','Давление','Архивный показатель'][i]!,unit:i<3?'см':i===3?'ч':'уд/мин',version:1,position:i,archivedAt:i===6?'2026-11-01T09:00:00Z':null}))
 let customValues=entries.flatMap((e,i)=>metrics.filter(m=>!m.archivedAt).map((m,j)=>({progressId:e.id,metricId:m.id,value:30+j+i})))
 const goal=empty?null:{id:fixtureId(800),clientId,title:'Укрепить тело и сохранить комфортный вес',targetDate:'2026-12-31',status:'active',version:1,stages:[],criteria:[{id:fixtureId(801),goalId:fixtureId(800),metric:'weight',operation:'decrease_to',targetValue:77,rangeMin:null,rangeMax:null,unit:'кг',baselineValue:82,baselineRecordedOn:'2026-08-12',confirmationStatus:'confirmed',position:0,version:1},{id:fixtureId(802),goalId:fixtureId(800),metric:'waist',operation:'maintain_range',targetValue:null,rangeMin:78,rangeMax:82,unit:'см',confirmationStatus:'confirmed',position:1,version:1}]}
 const sync=()=>mockProgressBundle(page,{entries,customMetrics:metrics,customValues,goal})
 await sync()
 const copy={headline:'Рабочий вес в жиме вырос по подтверждённым тренировкам.',achievements:['Выполнены сопоставимые тренировки без потери фактов.'],consistency:'Тренировки распределены по периоду.',encouragement:'Продолжайте по согласованному плану.',goal_alignment:'Оценка цели основана на сохранённых замерах.',next_steps:['Следить за техникой и ощущениями.']}
 let version=1,published=true,generatedAt='2026-11-12T09:00:00Z'
 const summary=()=>sample.role==='client'?{id:fixtureId(901),source_summary_id:fixtureId(900),client_id:clientId,period_start:range.start,period_end:range.end,summary:copy,display_metrics:{completed_workouts:3,workouts_per_week:0.75,active_weeks:3,longest_gap_days:10},generated_at:generatedAt,published_at:'2026-11-12T09:00:00Z'}:{id:fixtureId(900),client_id:clientId,period_start:range.start,period_end:range.end,trainer_summary:{headline:copy.headline,progress:copy.achievements,consistency:copy.consistency,attention:['Внутренняя заметка тренера не входит в клиентскую версию.']},client_summary:copy,display_metrics:{completed_workouts:3,workouts_per_week:0.75,active_weeks:3,longest_gap_days:10},generated_at:generatedAt,version,published}
 const initialData=structuredClone({entries,metrics,customValues,goal,summary:empty?null:summary()})
 const writes:{method:string;path:string;body:unknown}[]=[],reads:string[]=[],errors:string[]=[],failed:{method:string;path:string;error:string|null;responseStatus:number|null}[]=[],responses:{method:string;path:string;status:number}[]=[],consoleErrors:{path:string;text:string}[]=[],responseStatuses=new WeakMap<Request,number>()
 page.on('request',r=>{const u=new URL(r.url());if(r.method()==='GET'&&u.pathname.startsWith('/v1/'))reads.push(u.pathname+u.search);if(['POST','PUT','PATCH','DELETE'].includes(r.method())){const raw=r.postDataBuffer(),contentType=r.headers()['content-type']??'';writes.push({method:r.method(),path:u.pathname,body:raw?(contentType.includes('json')?JSON.parse(raw.toString()):{contentType,encoding:'base64',raw:raw.toString('base64')}):null})}})
 page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{responseStatuses.set(r.request(),r.status());if(r.status()>=400)responses.push({method:r.request().method(),path:new URL(r.url()).pathname,status:r.status()})});page.on('requestfailed',r=>failed.push({method:r.method(),path:new URL(r.url()).pathname,error:r.failure()?.errorText??null,responseStatus:responseStatuses.get(r)??null}));page.on('console',m=>{if(m.type()==='error')consoleErrors.push({path:new URL(m.location().url||page.url()).pathname,text:m.text()})})
 await page.route('**/v1/favorite-workouts',r=>r.fulfill({json:{favorites:[]}}));await page.route('**/v1/push-notifications/status',r=>r.fulfill({json:{status:{subscribed:false,preferences:{workout_reminder:true,workout_scheduled:true,chat_message:true}}}}))
 let release=()=>{},held=0,queryFail=sample.mode.endsWith('query-error'),attempts=0
 const gate=new Promise<void>(resolve=>{release=resolve})
 await page.route('**/v1/clients/*/training-summaries',async r=>{if(queryFail&&sample.mode==='analysis-query-error'){held++;await gate;return r.fulfill({status:503,json:{error:'unavailable'}})}return r.fulfill({json:{summaries:empty?[]:[summary()]}})})
 await page.route('**/v1/clients/*/progress/running?*',async r=>{if(queryFail&&sample.mode==='running-query-error'){held++;await gate;return r.fulfill({status:503,json:{error:'unavailable'}})}return r.fulfill({json:{sessions:sample.mode==='running-empty'||empty?[]:workouts.filter(w=>w.workoutDate>=new URL(r.request().url()).searchParams.get('from')!).map((w,i)=>({workoutId:w.id,workoutDate:w.workoutDate,format:'easy',distanceKm:3+i*0.2,durationSec:1200,paceSecPerKm:400-i*10,rpe:7}))}})})
 await page.route('**/v1/clients/*/progress/regularity',r=>r.fulfill({json:{regularity:empty?[]:[{period:'week',periodStart:'2026-11-09',periodEnd:'2026-11-15',plannedCount:2,completedCount:1,completedPlannedCount:1,partialCount:0,skippedCount:0,completionPercent:50}]}}))
 if(sample.mode==='query-error')await page.route('**/v1/clients/*/progress',async r=>{if(queryFail){held++;await gate;return r.fulfill({status:503,json:{error:'unavailable'}})}return r.fallback()})
 const mutateFailModes=['measurement-save','delete-error','metrics-create','metrics-archive','analysis-generate','analysis-copy']
 const waitFirstMutation=async()=>{attempts++;if(mutateFailModes.includes(sample.mode)&&attempts===1){held++;await gate;return true}return false}
 const saveEntry=async(r:Route)=>{
  const method=r.request().method();if(!['POST','PUT','DELETE'].includes(method))return r.fallback()
  if(await waitFirstMutation())return r.fulfill({status:503,json:{error:'unavailable'}})
  const body=r.request().postDataJSON() as {draft?:Record<string,unknown>;expectedVersion:number|null},id=new URL(r.request().url()).pathname.split('/').at(-1)!
  if(method==='DELETE'){const stored=entries.find(e=>e.id===id);expect(body.expectedVersion).toBe(stored!.version);entries=entries.filter(e=>e.id!==id);await sync();return r.fulfill({json:{progress:{version:(stored?.version??1)+1}}})}
  const draft=body.draft!,target=method==='POST'?fixtureId(650):id,previous=entries.find(e=>e.id===target)
  expect(body.expectedVersion).toBe(previous?.version??null)
  const entry={...draft,id:target,clientId,createdBy:previous?.createdBy??actor,version:(previous?.version??0)+1} as Entry
  entries=[entry,...entries.filter(e=>e.id!==target)];customValues=[...customValues.filter(v=>v.progressId!==target),...((draft.customMetrics??[]) as {metricId:string;value:number}[]).map(v=>({...v,progressId:target}))];await sync();return r.fulfill({json:{progress:{id:target}}})
 }
 await page.route('**/v1/progress',saveEntry);await page.route('**/v1/progress/*',saveEntry)
 await page.route('**/v1/progress-metrics',async r=>{if(r.request().method()!=='POST')return r.fallback();if(await waitFirstMutation())return r.fulfill({status:503,json:{error:'unavailable'}});const body=r.request().postDataJSON() as {draft:{name:string;unit:string|null};expectedVersion:null};expect(body.expectedVersion).toBeNull();const m:Metric={...body.draft,id:fixtureId(750),clientId,version:1,position:metrics.length,archivedAt:null};metrics=[...metrics,m];await sync();return r.fulfill({json:{metric:m}})})
 await page.route('**/v1/progress-metrics/*/archive',async r=>{if(await waitFirstMutation())return r.fulfill({status:503,json:{error:'unavailable'}});const id=new URL(r.request().url()).pathname.split('/').at(-2)!,body=r.request().postDataJSON() as {archived:boolean;expectedVersion:number},m=metrics.find(m=>m.id===id)!;expect(body.expectedVersion).toBe(m.version);m.version++;m.archivedAt=body.archived?'2026-11-13T09:00:00Z':null;await sync();return r.fulfill({json:{metric:m}})})
 await page.route('**/v1/clients/*/training-summaries/generate',async r=>{if(await waitFirstMutation())return r.fulfill({status:503,json:{error:'unavailable'}});generatedAt='2026-11-13T09:00:00Z';return r.fulfill({json:{data:{generated_at:generatedAt},cached:false}})})
 await page.route('**/v1/training-summaries/*/publish',async r=>{if(await waitFirstMutation())return r.fulfill({status:503,json:{error:'unavailable'}});const body=r.request().postDataJSON() as {expectedVersion:number;clientSummary:Record<string,unknown>};expect(body.expectedVersion).toBe(version);Object.assign(copy,body.clientSummary);version++;published=true;return r.fulfill({status:204})})
 await page.route('**/v1/training-summaries/*/unpublish',async r=>{const body=r.request().postDataJSON() as {expectedVersion:number};expect(body.expectedVersion).toBe(version);version++;published=false;return r.fulfill({status:204})})
 let recognitionCount=0
 const recognitionPath='/d4eerma5vk3fqtahbbea'
 await page.route('https://functions.yandexcloud.net'+recognitionPath,async r=>{if(r.request().method()==='OPTIONS')return r.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'content-type,x-fit-session','access-control-allow-methods':'POST,OPTIONS'}});recognitionCount++;if(recognitionCount===1&&sample.mode==='inbody'){held++;await gate}if(recognitionCount===1&&sample.mode==='inbody-error')return r.fulfill({status:422,headers:{'access-control-allow-origin':'*'},json:{error:'not_found'}});return r.fulfill({headers:{'access-control-allow-origin':'*'},json:{recordedOn:'2026-11-12',weightKg:78,chestCm:100,waistCm:80,hipCm:96,inBody,recognizedFieldCount:9,warnings:['Проверьте значения перед сохранением.']}})})
 return {actor,entries:()=>entries,metrics:()=>metrics,initialData,finalData:()=>({entries,metrics,customValues,goal,summary:empty?null:summary()}),workoutHistory,backend,writes,reads,errors,failed,responses,consoleErrors,recognitionPath,recognitionCount:()=>recognitionCount,held:()=>held,release,queryRecover:()=>{queryFail=false},attempts:()=>attempts}
}

export function limeProgressSkinCases(){
 for(const sample of samples)test(`Progress Lime skin ownership ${sample.role}-${sample.theme}-${sample.width}-${sample.mode}-${sample.lime}`,async({page},info)=>{
  const f=await prepareProgressSkin(page,sample)
  const measurementMode=['measurements','chart','measurement-focus','measurement-save','history','delete-error','metrics-create','metrics-archive'].includes(sample.mode)
  const advanced=['results','disclosures','body','body-list','body-focus','running','running-query-error'].includes(sample.mode)
  const external=sample.mode==='workouts-control',queryError=sample.mode.endsWith('query-error')
  const route=external?(sample.role==='client'?'/me/workouts?tab=history':`/clients/${clientId}/workouts`):sample.role==='client'?'/me/progress'+(advanced?'?view=pro':measurementMode?'#measurements':''):`/progress/${clientId}`+(measurementMode?'?view=measurements':sample.mode.startsWith('running')?'?view=running':'')
  const selector=external?'.client-workouts-page,.trainer-client-workouts-page,.tab-bar':progressContract.selector
  const scope=page.locator(external?(sample.role==='client'?'.client-workouts-page':'.trainer-client-workouts-page'):sample.role==='client'?'.client-progress-page':'.progress-page')
  const states:(Awaited<ReturnType<typeof probeEditorSkin>>&{state:string;url:string})[]=[],observations:unknown[]=[]
  const probe=async(state:string,pointer=false)=>{if(!pointer)await page.mouse.move(0,0);states.push({...await probeEditorSkin(page,info.outputPath('progress-'+state+'.png'),selector,progressContract),state,url:new URL(page.url()).pathname+new URL(page.url()).search+new URL(page.url()).hash})}
  const management=()=>scope.locator('.measurement-actions').first()
  const form=()=>scope.locator(sample.role==='client'?'.client-progress-form':'.progress-form-card')
  const history=()=>scope.locator(sample.role==='client'?'.client-progress-history':'.progress-history')
  const ready=async()=>{
   if(external){await expect(scope.locator('.workout-chronicle-card').first()).toBeVisible();return}
   if(sample.mode==='empty'){await expect(scope.locator('.progress-overview-panel')).toBeVisible();await expect(scope.locator('.inbody-progress-card')).toHaveCount(0);return}
   if(sample.role==='trainer'&&measurementMode){await expect(scope.locator('.trainer-measurements-workspace')).toBeVisible();await expect(scope.locator('.chart .recharts-surface')).toBeVisible();return}
   if(sample.role==='trainer'&&sample.mode.startsWith('running')){await expect(scope.locator('.running-progress-card')).toBeVisible();if(sample.mode!=='running-empty')await expect(scope.locator('.running-progress-total')).toBeVisible();return}
   if(sample.role==='client'){await expect(scope.locator('.inbody-progress-card').first()).toBeVisible();if(advanced){await expect(scope.getByRole('tabpanel',{name:'ПРО',exact:true})).toBeVisible();await expect(scope.getByRole('button',{name:'Открыть анализ',exact:true,includeHidden:true})).toBeAttached()}else await expect(scope.getByRole('button',{name:'Открыть анализ',exact:true})).toBeVisible()}
   else{await expect(scope.locator('.client-copy-toggle')).toBeVisible();await expect(scope.locator('.trainer-progress-week')).toBeVisible()}
  }
  const openHistory=async()=>{await management().getByRole('button',{name:/История/}).click();await expect(history()).toBeVisible();await expect(history().locator('article.card')).toHaveCount(f.entries().length)}
  const openMetrics=async()=>{await management().getByRole('button',{name:'Настроить показатели',exact:true}).click();await expect(scope.locator('.metrics-manager')).toBeVisible()}
  const openClientRunning=async()=>{if(sample.role==='client'){const details=scope.locator('.progress-pro-section').filter({has:page.getByText('Бег',{exact:true})});await details.locator(':scope > summary').click();await expect(details.locator('.running-progress-card')).toBeVisible();await expect(details.locator('.running-progress-total')).toBeVisible()}}
  await page.goto(route);await expect(scope).toBeVisible()
  if(external){await expect(page.locator('.phone-frame')).not.toHaveClass(/(?:^|\s)(?:progress-identity|trainer-progress-identity)(?:\s|$)/)}
  else{
   await expect(page.locator('.phone-frame')).toHaveClass(sample.role==='client'?/progress-identity/:/trainer-progress-identity/)
   if(sample.lime){await expect(page.locator(sample.role==='client'?'.fit-client-lime.progress-identity':'.fit-lime-shell.trainer-progress-identity')).toBeVisible();if(sample.role==='trainer')await expect(page.locator('.phone-frame')).not.toHaveClass(/theme-light/)}
   else await expect(page.locator('.fit-client-lime,.fit-lime-shell')).toHaveCount(0)
   if(sample.role==='client'&&sample.lime){if(sample.reference===false)await expect(page.locator('.client-screen-reference')).toHaveCount(0);else await expect(page.locator('.client-screen-reference')).toBeVisible()}
  }
  if(queryError){
   await expect.poll(()=>f.held()).toBeGreaterThan(0)
   if(sample.mode==='query-error'&&sample.role==='trainer')await expect(scope.getByRole('status',{name:'Загрузка',exact:true})).toBeVisible()
   else if(sample.mode==='running-query-error'){await openClientRunning();await expect(scope.getByText('Загружаем беговой прогресс…',{exact:true})).toBeVisible()}
   else await expect(scope.locator(sample.mode==='analysis-query-error'?'.ai-progress-card':'.client-progress-measurements-story').first()).toBeVisible()
   await probe('loading');f.release()
   const failureScope=sample.mode==='running-query-error'?scope.locator('.running-progress-card'):sample.mode==='analysis-query-error'?scope.locator('.ai-progress-card'):sample.role==='client'?scope.locator('.client-progress-measurements-story'):scope
   const retry=failureScope.getByRole('button',{name:'Повторить',exact:true}).first();await expect(retry).toBeVisible();await probe('query-error');f.queryRecover();await retry.click();await expect(retry).toHaveCount(0)
   if(sample.mode==='query-error'&&sample.role==='client')await expect(scope.locator('.client-progress-measurements-story .measurement-story-state[role="alert"]')).toHaveCount(0)
   else await ready()
   await probe('recovered')
  }else{
   await ready()
   if(external||sample.mode==='empty'||sample.mode==='running-empty'){await probe(external?'external-control':'empty')}
   else if(sample.mode==='focus'||sample.mode==='focus-negative'||sample.mode==='measurement-focus'||sample.mode==='body-focus'){
    // Explicit keyboard interaction belongs to the scenario, never the probe.
    const focus=async(target:ReturnType<Page['locator']>,state:string)=>{await expect(target).toHaveCount(1);await expect(target).toBeVisible();await page.keyboard.press('Tab');await target.focus();await expect(target).toBeFocused();expect(await target.evaluate(n=>n.matches(':focus-visible'))).toBe(true);await probe(state)}
    const details=async()=>{const item=scope.locator('.inbody-progress-card .inbody-details').first();await item.locator(':scope > summary').press('Enter');await expect(item).toHaveAttribute('open','');await expect(item.locator('dl > div').first()).toBeVisible();await probe('inbody-details')}
    if(sample.mode==='body-focus'){
     const disclosure=scope.locator('#body-map');if(await disclosure.evaluate(n=>n instanceof HTMLDetailsElement&&!n.open))await disclosure.locator(':scope > summary').click()
     const map=scope.locator('.body-progress-map');await expect(map.locator('image.body-progress-figure-image')).toBeVisible();await focus(map.locator('.body-progress-region[tabindex="0"]').first(),'body-region-focus');const picker=map.locator('.body-progress-zone-picker');await focus(picker.locator(':scope > summary'),'zone-picker-focus');await picker.locator(':scope > summary').press('Enter');await expect(picker).toHaveAttribute('open','');await focus(picker.locator('.body-progress-zone-list button').first(),'zone-list-focus')
    }else if(sample.mode==='measurement-focus'){
     await management().getByRole('button',{name:'Добавить замер',exact:true}).click();await expect(form()).toBeVisible();await focus(form().locator('input[name="weightKg"]'),'measurement-field-focus');await form().getByRole('button',{name:'Отмена',exact:true}).click();await openMetrics();await focus(scope.locator('.metrics-manager select[aria-label="Готовый замер"]'),'measurement-select-focus');await details()
    }else if(sample.role==='client'){
     await focus(scope.locator('.athlete-achievements-preview a[href="/me/achievements"]'),'achievement-focus');if(sample.mode==='focus-negative')await expect(scope.locator('.inbody-progress-card .negative').first()).toBeVisible();await details()
    }else{
     await focus(scope.locator('.trainer-progress-route-card.measurements'),'route-focus');const signals=scope.locator('.trainer-progress-signals');await signals.getByRole('button',{name:'Показать',exact:true}).click();await expect(signals.locator('.trainer-progress-signals-content')).toBeVisible();await probe('trainer-signals');await scope.getByRole('button',{name:'Подробный анализ',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Подробный анализ',exact:true});await expect(dialog).toBeVisible();await probe('trainer-detailed-analysis');await dialog.getByRole('button',{name:'Закрыть',exact:true}).click()
    }
   }
   else if(sample.mode==='overview'||sample.mode==='one-period'){
    await probe('overview')
    const periods=scope.locator('.progress-story-period .ai-progress-periods')
    if(sample.onePeriod){await expect(periods.locator('button')).toHaveCount(1)}
    else if(sample.theme==='light'&&sample.lime){await periods.getByRole('button',{name:/3/}).click();await expect(periods.getByRole('button',{name:/3/})).toHaveClass(/active/);await probe('three-months');const six=periods.getByRole('button',{name:/6/});if(await six.count()){await six.click();await expect(six).toHaveClass(/active/);await probe('six-months')}}
   }else if(sample.mode==='results'){
    const center=scope.locator('#results-center');await center.locator(':scope > summary').click();await expect(center).toHaveAttribute('open','');await expect(center.locator('.center-result-row').first()).toBeVisible();await probe('results')
    const exerciseLabel=center.locator('.results-center-filters > label').first(),exercise=exerciseLabel.locator(':scope > select');await expect(exercise).toHaveCount(1);expect(await exerciseLabel.evaluate(label=>Array.from(label.childNodes).filter(node=>node.nodeType===Node.TEXT_NODE).map(node=>node.textContent).join('').trim())).toBe('Упражнение');const selectedExercise=await exercise.locator('option').nth(1).getAttribute('value');expect(selectedExercise).toBeTruthy();await exercise.selectOption({index:1});await expect(exercise).toHaveValue(selectedExercise!);await expect(exercise.locator('option:checked')).toHaveAttribute('value',selectedExercise!);await expect(center.locator('.center-result-row').first()).toBeVisible();await probe('exercise-filter');const explanation=center.locator('.result-volume-explanation').first();if(await explanation.count()){await explanation.locator(':scope > summary').click();await expect(explanation).toHaveAttribute('open','');await probe('result-explanation')}
   }else if(sample.mode==='disclosures'){
    for(const [selector,name]of [['#goal-details','goal'],['.period-rhythm','regularity'],['.weekly-training-load','weekly-load']]as const){const item=scope.locator(selector);await item.locator(':scope > summary').click();await expect(item).toHaveAttribute('open','');await probe(name)}
   }else if(sample.mode==='body'||sample.mode==='body-list'){
    if(sample.role==='client'){const disclosure=scope.locator('#body-map');if(await disclosure.evaluate(n=>n instanceof HTMLDetailsElement&&!n.open))await disclosure.locator(':scope > summary').click()}
    const map=scope.locator('.body-progress-map');await expect(map).toBeVisible();await expect(map.locator('.body-progress-zone-list button,.body-progress-region').first()).toBeVisible()
    if(sample.list){await expect(map.locator('.body-progress-list-fallback')).toBeVisible()}
    else{const image=map.locator('image.body-progress-figure-image');await expect(image).toBeVisible();await expect(map.locator('.body-progress-list-fallback')).toHaveCount(0);const href=await image.getAttribute('href');expect(href).toBe('/illustrations/body-progress-athlete'+(sample.gender==='female'?'-female':'')+'.png');const url=new URL(href!,page.url()).href;await expect.poll(()=>page.evaluate(url=>performance.getEntriesByName(url).some(entry=>entry instanceof PerformanceResourceTiming&&entry.responseEnd>0),url)).toBe(true)}
    await expect(map.getByRole('button',{name:'Прогресс',exact:true})).toHaveAttribute('aria-pressed','true');await probe('body-map')
    const detail=map.locator('.body-progress-detail'),regionLabel=await detail.locator('.body-progress-detail-heading > strong').innerText(),more=map.locator('button.body-progress-more');await expect(more).toHaveCount(1);await expect(more).toHaveAccessibleName(/^Показать \d+ упражнен/);await more.click();const sheet=page.getByRole('dialog',{name:regionLabel,exact:true});await expect(sheet).toHaveClass(/body-progress-sheet/);await expect(sheet).toBeVisible();await expect(sheet.locator('h2')).toHaveText(regionLabel);await probe('body-detail');await sheet.getByRole('button',{name:'Закрыть',exact:true}).click();await expect(sheet).toHaveCount(0)
    await map.getByRole('button',{name:'Нагрузка',exact:true}).click();await expect(map.getByRole('button',{name:'Нагрузка',exact:true})).toHaveAttribute('aria-pressed','true');await expect(map.locator('.body-progress-load-value')).toBeVisible();await probe('body-load')
   }else if(sample.mode==='running'){
    await openClientRunning();const running=scope.locator('.running-progress-card');await expect(running.locator('.running-progress-total')).toBeVisible();await probe('running');if(sample.role==='trainer'){await running.getByRole('tab',{name:'3 мес.',exact:true}).click();await expect(running.getByRole('tab',{name:'3 мес.',exact:true})).toHaveAttribute('aria-selected','true');await probe('running-three-months')}
    else await expect(running.locator('.running-progress-periods')).toHaveCount(0)
   }else if(sample.mode==='analysis-generate'){
    await scope.getByRole('button',{name:'Открыть анализ',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Подробный анализ',exact:true});await expect(dialog).toBeVisible();await probe('analysis-sheet');const refresh=dialog.getByRole('button',{name:'Обновить анализ',exact:true});await refresh.click();await expect.poll(()=>f.held()).toBe(1);await expect(dialog.getByRole('button',{name:'Формируем ИИ-анализ…',exact:true})).toBeDisabled();await probe('analysis-pending');f.release();await expect(dialog.getByRole('alert')).toBeVisible();await probe('analysis-error');await refresh.click();await expect.poll(()=>f.attempts()).toBe(2);await expect(dialog.getByRole('alert')).toHaveCount(0);await dialog.getByRole('button',{name:'Закрыть',exact:true}).click();await expect(scope.getByRole('button',{name:'Открыть анализ',exact:true})).toBeFocused()
   }else if(sample.mode==='analysis-copy'){
    await scope.getByRole('button',{name:'Версия для спортсмена',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Версия для спортсмена',exact:true});await expect(dialog).toBeVisible();const headline=dialog.locator('textarea[name="headline"]');await expect(headline).toHaveCount(1);await expect(headline.locator('xpath=..').locator(':scope > span')).toHaveText('Главный результат');await headline.fill('Подтверждённый результат MC53');await probe('client-copy-editor');const save=dialog.locator('button[type="submit"],button.primary').last();await save.click();await expect.poll(()=>f.held()).toBe(1);await expect(save).toBeDisabled();await probe('client-copy-pending');f.release();await expect(dialog.getByRole('alert')).toBeVisible();await expect(headline).toHaveValue('Подтверждённый результат MC53');await probe('client-copy-error');await save.click();await expect(dialog.getByText('Версия опубликована для клиента',{exact:true})).toBeVisible();await dialog.getByRole('button',{name:'Скрыть',exact:true}).click();await expect(dialog.getByText('Клиент может запросить сам',{exact:true})).toBeVisible();await dialog.getByRole('button',{name:'Закрыть',exact:true}).click()
   }else if(sample.mode==='measurement-save'){
    await management().getByRole('button',{name:'Добавить замер',exact:true}).click();await expect(form()).toBeVisible();await form().getByLabel('Вес, кг',{exact:true}).fill('77.5');await form().getByLabel('Заметка',{exact:true}).fill('Замер MC53 с сохранением исходных данных');await probe('measurement-input');const save=form().getByRole('button',{name:'Сохранить замер',exact:true});await save.click();await expect.poll(()=>f.held()).toBe(1);await expect(form().getByRole('button',{name:'Сохраняем…',exact:true})).toBeDisabled();await expect(form().getByLabel('Вес, кг',{exact:true})).toBeEnabled();if(sample.role==='trainer')await expect(form().getByRole('button',{name:'Отмена',exact:true})).toBeDisabled();else await expect(form().getByRole('button',{name:'Отмена',exact:true})).toBeEnabled();await probe('measurement-pending');f.release();await expect(form().locator('.error')).toBeVisible();await expect(form().getByLabel('Вес, кг',{exact:true})).toHaveValue('77.5');await probe('measurement-error');const profileRefresh=sample.role==='trainer'?page.waitForResponse(r=>r.request().method()==='GET'&&new URL(r.url()).pathname==='/v1/clients'&&r.status()===200):null;await save.click();await expect(form()).toHaveCount(0);if(profileRefresh)await(await profileRefresh).finished();expect(f.entries().find(e=>e.id===fixtureId(650))?.weightKg).toBe(77.5)
   }else if(sample.mode==='history'||sample.mode==='delete-error'){
    await openHistory();const row=history().locator('article.card').first();if(sample.role==='trainer'){const foreign=history().locator('article.card').nth(1);await expect(foreign.locator('.row-actions')).toHaveCount(0)}
    if(sample.mode==='history'){await probe('history');await row.getByRole('button',{name:'Изменить',exact:true}).click();await expect(form()).toBeVisible();const notes=form().locator('textarea[name="notes"]');await expect(notes).toHaveCount(1);await expect(notes.locator('xpath=..').locator(':scope > span')).toHaveText('Заметка');await notes.fill('Несохранённая заметка MC53');await probe('history-editor');await form().getByRole('button',{name:'Отмена',exact:true}).click();await expect(form()).toHaveCount(0);expect(f.entries()[0]?.version).toBe(1)}
    else{await row.getByRole('button',{name:'Удалить',exact:true}).click();const dialog=page.getByRole('alertdialog');await expect(dialog).toBeVisible();await probe('delete-confirm');await dialog.getByRole('button',{name:'Удалить',exact:true}).click();await expect.poll(()=>f.held()).toBe(1);await expect(row.getByRole('button',{name:'Удалить',exact:true})).toBeDisabled();await probe('delete-pending');f.release();const error=scope.locator(sample.role==='client'?'.client-measurement-delete-error':'.progress-history .error');await expect(error).toBeVisible();await probe('delete-error');if(sample.role==='client')await error.getByRole('button',{name:'Повторить',exact:true}).click();else{await row.getByRole('button',{name:'Удалить',exact:true}).click();await page.getByRole('alertdialog').getByRole('button',{name:'Удалить',exact:true}).click()}await expect(history().locator('article.card')).toHaveCount(4);expect(f.entries().some(e=>e.id===fixtureId(600))).toBe(false)}
   }else if(sample.mode==='metrics-create'||sample.mode==='metrics-archive'){
    await openMetrics();const manager=scope.locator('.metrics-manager');await probe('metrics')
    if(sample.mode==='metrics-create'){
     await manager.getByLabel('Название показателя',{exact:true}).fill('Показатель MC53');await manager.getByLabel('Единица измерения',{exact:true}).fill('см');await manager.getByRole('group',{name:'Новый показатель',exact:true}).getByRole('button',{name:'Добавить',exact:true}).click();await expect.poll(()=>f.held()).toBe(1);await probe('metric-create-pending');f.release();await expect(manager.getByRole('alert')).toBeVisible();observations.push({source:'MetricsManager.addManual',kind:'existing behavior, not requested design',nameAfterFailedCreate:await manager.getByLabel('Название показателя',{exact:true}).inputValue(),unitAfterFailedCreate:await manager.getByLabel('Единица измерения',{exact:true}).inputValue()});await probe('metric-create-error')
    }else{const first=manager.locator('.metric').first();await first.getByRole('button',{name:'В архив',exact:true}).click();await expect.poll(()=>f.held()).toBe(1);await expect(first.getByRole('button',{name:'В архив',exact:true})).toBeDisabled();await probe('metric-archive-pending');f.release();await expect(manager.getByRole('alert')).toBeVisible();await probe('metric-archive-error');await first.getByRole('button',{name:'В архив',exact:true}).click();await expect(first.getByRole('button',{name:'Вернуть',exact:true})).toBeVisible()}
   }else if(sample.mode==='inbody'||sample.mode==='inbody-error'){
    const section=scope.locator('.inbody-import');await expect(section).toBeVisible();const image=await readFile('public/exercises/vital/air-bike-sprint.jpg');await section.locator('input[type="file"]').setInputFiles({name:'mc53-synthetic-inbody.jpg',mimeType:'image/jpeg',buffer:image})
    if(sample.mode==='inbody'){await expect.poll(()=>f.held()).toBe(1);await expect(section.getByRole('button',{name:'Распознаём отчёт…',exact:true})).toBeDisabled();await probe('inbody-recognizing');f.release()}
    else{await expect(section.getByRole('alert')).toBeVisible();await probe('inbody-error');await section.locator('input[type="file"]').setInputFiles({name:'mc53-synthetic-inbody.jpg',mimeType:'image/jpeg',buffer:image})}
    await expect(section.locator('.inbody-import-result')).toBeVisible();await probe('inbody-recognized');await section.getByRole('button',{name:'Проверить и сохранить',exact:true}).click();await expect(form()).toBeVisible();await expect(form().getByLabel('Вес, кг',{exact:true})).toHaveValue('78');await expect(form().getByLabel('Дата',{exact:true})).toHaveValue('2026-11-12');if(sample.mode==='inbody')await probe('inbody-review');await form().getByRole('button',{name:'Отмена',exact:true}).click();expect(f.entries()).toEqual(f.initialData.entries)
   }else if(sample.mode==='measurements'||sample.mode==='chart'){
    await probe('measurement-chart');const tabs=scope.locator('.metric-tabs');await tabs.getByRole('button',{name:'Талия',exact:true}).click();await expect(scope.getByRole('region',{name:'График показателя «Талия»',exact:true})).toBeVisible();await probe('waist-chart')
    await tabs.getByRole('button',{name:'⋯',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Другие метрики',exact:true});await expect(dialog).toBeVisible();await probe('metric-overflow');await dialog.getByRole('button',{name:/Плечи/}).click();await expect(dialog).toHaveCount(0);await expect(scope.getByRole('region',{name:'График показателя «Плечи»',exact:true})).toBeVisible()
   }
  }
  const finalData=f.finalData(),unchangedWorkoutHistory=JSON.stringify(f.backend.getWorkouts())===f.workoutHistory
  await writeFile(info.outputPath('progress-skin.json'),JSON.stringify({sample,route,fixedNow:'2026-11-13T09:00:00Z',period:range,states,initialData:f.initialData,finalData,writes:f.writes,reads:f.reads,unchangedWorkoutHistory,recognitionCount:f.recognitionCount(),mutationAttempts:f.attempts(),observations,diagnostics:{errors:f.errors,failed:f.failed,responses:f.responses,consoleErrors:f.consoleErrors}}))
  expect(f.errors).toEqual([]);expect(unchangedWorkoutHistory).toBe(true)
  const expectedErrors: {method:string;path:string;status:number}[]=[]
  if(sample.mode==='inbody-error')expectedErrors.push({method:'POST',path:f.recognitionPath,status:422})
  if(['measurement-save','delete-error','metrics-create','metrics-archive','analysis-generate','analysis-copy'].includes(sample.mode)){
   const path=sample.mode==='measurement-save'?'/v1/progress':sample.mode==='delete-error'?'/v1/progress/'+fixtureId(600):sample.mode==='metrics-create'?'/v1/progress-metrics':sample.mode==='metrics-archive'?'/v1/progress-metrics/'+fixtureId(700)+'/archive':sample.mode==='analysis-generate'?'/v1/clients/'+clientId+'/training-summaries/generate':'/v1/training-summaries/'+fixtureId(900)+'/publish'
   expectedErrors.push({method:sample.mode==='delete-error'?'DELETE':sample.mode==='metrics-archive'?'PUT':'POST',path,status:503})
  }
  if(queryError){const path=sample.mode==='analysis-query-error'?`/v1/clients/${clientId}/training-summaries`:sample.mode==='running-query-error'?`/v1/clients/${clientId}/progress/running`:`/v1/clients/${clientId}/progress`;expect(f.responses.length).toBe(f.held());expect(f.responses.length).toBeGreaterThan(0);for(const r of f.responses)expect(r).toEqual({method:'GET',path,status:503});expectedErrors.push(...f.responses)}else expect(f.responses).toEqual(expectedErrors)
  expect(f.consoleErrors.filter(e=>!expectedErrors.some(x=>x.path===e.path)||!e.text.startsWith('Failed to load resource:'))).toEqual([])
  if(f.failed.length){expect(sample.mode).toBe('analysis-copy');for(const failure of f.failed){expect(failure.error).toBe('net::ERR_ABORTED');expect(failure.method).toBe('POST');expect(failure.responseStatus).toBe(204);expect([`/v1/training-summaries/${fixtureId(900)}/publish`,`/v1/training-summaries/${fixtureId(900)}/unpublish`]).toContain(failure.path)}expect(f.failed.length).toBeLessThanOrEqual(2);expect(finalData.summary?.published).toBe(false)}else expect(f.failed).toEqual([])
  expect(f.writes.filter(w=>w.path.startsWith('/v1/workouts'))).toEqual([])
  if(!['measurement-save','delete-error','metrics-create','metrics-archive','analysis-generate','analysis-copy','inbody','inbody-error'].includes(sample.mode)){expect(f.writes).toEqual([]);expect(finalData).toEqual(f.initialData)}
  for(const state of states){if(external)expect(state.owners).toEqual([]);else assertEditorOwnership(state,sample.lime,progressContract)}
 })
}
