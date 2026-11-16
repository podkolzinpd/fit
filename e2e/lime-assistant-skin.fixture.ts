import {expect,type Page} from '@playwright/test'
import {clientId,trainerId,mockPilot,mockClientStreamingVoice} from './fit-lime-fixtures'
import {observeEditorImages} from './lime-editor-skin.probe'
import type {AssistantOrchestratorAction} from '../src/data/assistant-contract'
import {SYSTEM_EXERCISE_CATALOG} from '../src/shared/system-exercises'
import {assistantWorkoutDraftKey} from '../src/features/assistant/workout-draft'

export type AssistantSkinSample={role:'client'|'trainer';theme:'light'|'dark';width:number;mode:string;lime:boolean}
export const assistantTodayId='57000000-0000-4000-8000-000000000001'
export const assistantHistoryId='57000000-0000-4000-8000-000000000002'
export const assistantActionId='57000000-0000-4000-8000-000000000010'
const secondHistoryId='57000000-0000-4000-8000-000000000003'
const messageId=(n:number)=>`57000000-0000-4000-8000-${String(100+n).padStart(12,'0')}`
type WireMessage={id:string;conversationId:string;turnId:string|null;author:'user'|'assistant';content:string;action:AssistantOrchestratorAction|null;createdAt:string}
const message=(n:number,content:string,action:AssistantOrchestratorAction|null=null,conversationId=assistantTodayId):WireMessage=>({id:messageId(n),conversationId,turnId:null,author:'assistant',content,action,createdAt:conversationId===assistantTodayId?'2026-11-16T09:01:00Z':'2026-11-15T09:01:00Z'})
export const assistantCanonicalWorkouts=[{requestId:'57000000-0000-4000-8000-000000000020',clientId,workoutDate:'2026-11-18',exercises:[{name:'Приседания',ref:'fedb-bodyweight-squat',restBetweenSetsSec:90,sets:[{position:0,reps:10,rpe:6.5}]},{name:'Ходьба',ref:'fedb-walking',restBetweenSetsSec:0,sets:[{position:0,durationSec:300,rpe:4}]}]}]
const programPayload={programPilot:true,step:'confirm',clientId,clientName:'Алексей Смирнов',goal:'Вернуться к регулярным тренировкам',briefState:{scope:'single_workout',weeks:1,frequency:1,durationMin:20},canonicalWorkouts:assistantCanonicalWorkouts,editableCatalog:[{ref:'fedb-bodyweight-squat',name:'Приседания',inputKind:'strength'},{ref:'fedb-walking',name:'Ходьба',inputKind:'duration'}],sessions:[{day:'2026-11-18',week:1,title:'Всё тело',exercises:[{name:'Приседания',sets:1,reps:10,rpe:6.5,restSec:90},{name:'Ходьба',sets:1,durationSec:300,rpe:4,restSec:0}]}],sourceSummary:'Учтены завершённые тренировки и заданная длительность.',limitationReview:'Без упражнений, вызывающих дискомфорт.',modelInputJson:{fixture:'MC57 synthetic request'},modelOutputJson:{fixture:'MC57 synthetic response'}}
const programAction=(brief=false,ready=false):AssistantOrchestratorAction=>({...(!brief?{id:assistantActionId}:{}),tool:'create_program_draft',status:brief?'needs_input':'proposed',title:'Программа',description:'Проверьте условия программы',payload:brief?{programPilot:true,step:'brief',clientId,clientName:'Алексей Смирнов',briefStatus:'needs_clarification',historyQuestion:!ready,answerSuggestions:ready?[]:['Одна тренировка','Программа на 4 недели'],readyToGenerate:ready,sourceSummary:'В Fit есть завершённые тренировки.',briefSummary:'Цель: общая форма\nДлительность: 20 минут'}:structuredClone(programPayload)})

export async function prepareAssistantSkin(page:Page,sample:AssistantSkinSample){
 observeEditorImages(page)
 const actor=sample.role==='client'?'c11e0000-6010-4000-8000-000000000001':'c0ac0000-6010-4000-8000-000000000001'
 const draftKey=assistantWorkoutDraftKey(actor,assistantTodayId,clientId)
 const draftRequestId='57000000-0000-4000-8000-000000000070'
 const retainedExercise=SYSTEM_EXERCISE_CATALOG.find(item=>/Жим.*л[её]жа/.test(item.name))!
 const expectedRetainedSets=[{position:0,weightKg:45,reps:14},{position:1,weightKg:45,reps:14}]
 await page.setViewportSize({width:sample.width,height:sample.width===1440?1000:844});await page.emulateMedia({reducedMotion:'reduce'})
 await page.route('**/v1/**',route=>route.abort())
 const backend=await mockPilot(page,{role:sample.role,profileId:actor,pilot:true,fitLime:sample.role==='trainer'&&sample.lime,clientLime:sample.role==='client'&&sample.lime,failTrainingData:sample.mode==='catalog-error'})
 const historyBefore=JSON.stringify(backend.getWorkouts())
 await page.route('**/v1/auth/yandex/session',route=>route.fulfill({json:{accessMode:'read_write',profile:{id:actor,firstName:'Антон',lastName:null,timezone:'Europe/Moscow',accountRole:sample.role,...(sample.role==='client'?{client:{id:clientId,trainerId,fullName:'Алексей Смирнов'}}:{}),experiments:{trainerScheduleV2:true,fitLime:sample.role==='trainer'&&sample.lime,clientLime:sample.role==='client'&&sample.lime,assistantFeatureLinks:sample.mode!=='workout-restored'},preferences:{scheduleDensity:'comfortable'}}}}))
 await page.addInitScript(({actor,theme,wheel,seedTurns})=>{
  const NativeDate=Date,fixed=NativeDate.parse('2026-11-16T09:30:00Z')
  window.Date=new Proxy(NativeDate,{construct:(t,a,n)=>Reflect.construct(t,a.length?a:[fixed],n)as Date,apply:()=>new NativeDate(fixed).toString(),get:(t,k,r)=>k==='now'?()=>fixed:Reflect.get(t,k,r)as unknown})
  localStorage.setItem('fit.appTheme',theme);localStorage.setItem('fit.clientLime.theme.'+actor,theme);localStorage.setItem('fit.workoutTimeWheel',String(wheel));localStorage.setItem('fit.installDismissed','true')
  // AssistantHistoryPage.send consumes the turn UUID synchronously before
  // repository request diagnostics. Seed only that source call for actual
  // submit/suggestion events; Retry reuses its prior turn ID and is not armed.
  const evidence={events:[] as string[],consumed:[] as string[]}
  Object.defineProperty(window,'__fitAssistantTurnUUIDEvidence',{value:evidence})
  if(seedTurns){
   const nativeUUID=crypto.randomUUID.bind(crypto)
   const arm=(eventName:string)=>{
    const id=`57000000-0000-4000-9000-${String(evidence.events.push(eventName)).padStart(12,'0')}` as ReturnType<Crypto['randomUUID']>
    const once=()=>{crypto.randomUUID=nativeUUID;evidence.consumed.push(id);return id}
    crypto.randomUUID=once
    window.setTimeout(()=>{if(crypto.randomUUID===once)crypto.randomUUID=nativeUUID},0)
   }
   document.addEventListener('submit',event=>{if(event.target instanceof HTMLFormElement&&event.target.matches('.assistant-composer'))arm('composer-submit')},true)
   document.addEventListener('click',event=>{
    const button=event.target instanceof Element?event.target.closest('button'):null
    if(!button?.closest('.assistant-context-panel')||button.disabled)return
    const text=button.textContent?.trim()
    if(text==='Это все тренировки'||text==='Проверить изменение'||(seedTurns==='program-brief'&&text==='Отменить'))arm(text)
   },true)
  }
 },{actor,theme:sample.theme,wheel:sample.mode==='program-edit',seedTurns:['text-retry','program-brief','program-edit'].includes(sample.mode)?sample.mode:''})
 if(sample.mode==='workout-restored'){
  // A real persisted draft in the still-supported server featureLinks=false
  // mode. Do not enable this surface for the navigation-enabled scenarios.
  const squat=SYSTEM_EXERCISE_CATALOG.find(item=>item.name.includes('Присед'))!,bench=SYSTEM_EXERCISE_CATALOG.filter(item=>/Жим.*л[её]жа/.test(item.name)).slice(0,2)
  expect(bench).toHaveLength(2);expect(squat).toBeDefined()
  const snapshot={requestId:draftRequestId,transcript:'Присед и жим',rawFragments:['Присед и жим'],workoutDate:'2026-11-16',startTime:'12:00',result:{items:[{sourceText:'Присед',exerciseRef:squat.ref,confidence:1,sets:[{weightKg:40,reps:10}]}],unmatched:[{sourceText:'Жим',reason:'Уточните оборудование',suggestedExerciseRefs:bench.map(item=>item.ref),sets:[{weightKg:30,reps:12}]}]}}
  await page.addInitScript(({key,snapshot})=>{if(localStorage.getItem(key)===null)localStorage.setItem(key,JSON.stringify(snapshot))},{key:draftKey,snapshot})
 }
 if(sample.mode.startsWith('voice')||sample.mode==='shared-voice')await mockClientStreamingVoice(page,'Распознанный фрагмент без повторения исходного текста')
 const conversations=[{id:assistantTodayId,title:'Сегодня',createdAt:'2026-11-16T09:00:00Z'},...(sample.mode==='history'?[{id:assistantHistoryId,title:'Результаты и сохранённые действия',createdAt:'2026-11-15T09:00:00Z'},{id:secondHistoryId,title:'Предыдущая беседа',createdAt:'2026-11-14T09:00:00Z'}]:[])]
 let created=sample.mode!=='entry',failure=sample.mode==='load-error'||sample.mode==='messages-error',turnAttempts=0,applyAttempts=0,actionStatus='proposed',version=1
 let releaseLoad=()=>{},releaseTurn=()=>{},releaseApply=()=>{},releaseFeedback=()=>{}
 const loadGate=new Promise<void>(resolve=>{releaseLoad=resolve}),turnGate=new Promise<void>(resolve=>{releaseTurn=resolve}),applyGate=new Promise<void>(resolve=>{releaseApply=resolve}),feedbackGate=new Promise<void>(resolve=>{releaseFeedback=resolve})
 let heldLoad=0,heldTurn=0,heldApply=0,heldFeedback=0,feedbackAttempts=0
 const current:WireMessage[]=sample.mode==='workout-restored'?[message(1,'Проверьте сохранённый черновик.',{id:assistantActionId,tool:'record_workout',status:'proposed',title:'Тренировка',description:'Проверьте сохранённый черновик.',payload:{step:'confirm',clientId,clientName:'Алексей Смирнов',transcript:'Присед и жим'}})]:sample.mode.startsWith('program-')?[message(1,'Уточните условия и проверьте результат.',programAction(sample.mode==='program-brief'))]:sample.mode==='entry'||sample.mode.startsWith('voice')?[]:[message(1,'Сохранённая беседа. Здесь можно обсудить тренировку и восстановление.')]
 const summaryResult={status:'applied',summaryId:'57000000-0000-4000-8000-000000000030',clientId,clientName:'Алексей Смирнов',periodStart:'2026-10-01',periodEnd:'2026-10-31',periodLabel:'Октябрь',trainer:{headline:'Темп стабилен',progress:['Техника становится увереннее'],consistency:'Дважды в неделю',attention:['Сохранять время на восстановление']},metrics:{completedWorkouts:8,workoutsPerWeek:2,activeWeeks:4},saved:true}
 // Message actions are the original proposed wire values. Applied lifecycle
 // and result arrive independently through durable /actions, as in production.
 const historical=[message(20,'Сохранённые результаты',null,assistantHistoryId),message(21,'Тренировка сохранена',{id:'57000000-0000-4000-8000-000000000011',tool:'record_workout',status:'proposed',title:'Тренировка',description:'Тренировка сохранена',payload:{clientName:'Алексей Смирнов'}},assistantHistoryId),message(22,'Программа сохранена',{...programAction(),id:'57000000-0000-4000-8000-000000000012'},assistantHistoryId),message(23,'Сводка прогресса',{id:'57000000-0000-4000-8000-000000000013',tool:'summarize_progress',status:'proposed',title:'Сводка',description:'Сводка прогресса',payload:{}},assistantHistoryId)]
 const historicalActions=historical.filter(item=>item.action?.id).map(item=>({id:item.action!.id,conversationId:assistantHistoryId,assistantMessageId:item.id,status:'applied',version:2,result:item.action!.tool==='summarize_progress'?summaryResult:null}))
 const writes:{path:string;method:string;body:unknown}[]=[],reads:string[]=[],diagnostics:string[]=[],legacyRequests:string[]=[]
 page.on('pageerror',error=>diagnostics.push(error.message))
 page.on('request',request=>{const url=new URL(request.url());if(url.hostname.endsWith('.supabase.co')||/\/(rest|auth|functions)\/v1\//.test(url.pathname))legacyRequests.push(url.pathname);if(!url.pathname.startsWith('/v1/'))return;if(request.method()==='GET')reads.push(url.pathname+url.search);else if(request.method()!=='OPTIONS')writes.push({path:url.pathname,method:request.method(),body:request.postDataJSON()as unknown})})
 await page.route('**/v1/assistant/**',async route=>{
  const request=route.request(),url=new URL(request.url()),path=url.pathname,method=request.method()
  const fail=()=>route.fulfill({status:503,headers:{'x-fit-request-id':'57000000-0000-4000-a000-000000000503','access-control-expose-headers':'x-fit-request-id'},json:{error:'unavailable'}})
  if(path==='/v1/assistant/conversations'){
   if(method==='POST'){created=true;return route.fulfill({json:{conversation:conversations[0]}})}
   if(sample.mode==='load-error'&&failure)return fail()
   return route.fulfill({json:{conversations:created?conversations:[]}})
  }
  if(path.endsWith('/messages')){
   if(sample.mode==='loading'){heldLoad++;await loadGate}
   if(sample.mode==='messages-error'&&failure)return fail()
   return route.fulfill({json:{messages:path.includes(assistantHistoryId)?historical:path.includes(secondHistoryId)?[message(25,'Ранний ответ ассистента',null,secondHistoryId)]:current}})
  }
  if(path==='/v1/assistant/actions')return route.fulfill({json:{actions:url.searchParams.get('conversationId')===assistantTodayId?current.filter(item=>item.action?.id).map(item=>({id:item.action!.id,conversationId:assistantTodayId,assistantMessageId:item.id,status:actionStatus,version,result:null})):url.searchParams.get('conversationId')===assistantHistoryId?historicalActions:[]}})
  if(path==='/v1/assistant/turn'){
   turnAttempts++;const input=request.postDataJSON()as{conversation_id:string;turn_id:string;message:string};expect(input.conversation_id).toBe(assistantTodayId)
   if(sample.mode==='text-retry'&&turnAttempts===1){heldTurn++;await turnGate;return fail()}
   let action=sample.mode==='program-brief'&&input.message!=='Отменить'?programAction(true,true):null
   if(sample.mode==='program-edit'){
    const revised=structuredClone(programPayload),walking=revised.canonicalWorkouts[0]!.exercises[1]!
    walking.sets=[{position:0,durationSec:300,rpe:4},{position:1,durationSec:300,rpe:4}]
    action={...programAction(),id:'57000000-0000-4000-8000-000000000015',payload:{...revised,editGuidance:'Изменение проверено.'}}
   }
   const reply=sample.mode==='text-retry'?`Запись тренировки откроется на главной. [[fit-link:${sample.role==='client'?'/me?entry=workout':'/today?view=compose&entry=text'}|Записать тренировку]]`:input.message==='Отменить'?'Создание программы отменено.':'Условия уточнены.'
   if(!current.some(item=>item.turnId===input.turn_id))current.push({id:messageId(50+turnAttempts),conversationId:assistantTodayId,turnId:input.turn_id,author:'user',content:input.message,action:null,createdAt:'2026-11-16T09:30:00Z'},message(60+turnAttempts,reply,action))
   return route.fulfill({json:{reply,action}})
  }
  if(path.endsWith('/apply')){
   applyAttempts++;expect(path).toBe(`/v1/assistant/actions/${assistantActionId}/apply`)
   if(sample.mode==='workout-restored'){
    const command=request.postDataJSON()as{input:{workout:{requestId:string;clientId:string;workoutDate:string;startTime:string;exercises:{ref:string;sets:unknown[]}[]}};expectedVersion:number}
    expect(command.expectedVersion).toBe(1);expect(command.input.workout).toMatchObject({requestId:draftRequestId,clientId,workoutDate:'2026-11-17',startTime:'10:30'});expect(command.input.workout.exercises).toHaveLength(1);expect(command.input.workout.exercises[0]!.ref).toBe(retainedExercise.ref);expect(command.input.workout.exercises[0]!.sets).toEqual(expectedRetainedSets)
   }else expect(request.postDataJSON()).toEqual({input:{workouts:assistantCanonicalWorkouts},expectedVersion:1})
   if(sample.mode==='program-save'&&applyAttempts===1){heldApply++;await applyGate;return fail()}
   actionStatus='applied';version=2;return route.fulfill({json:{result:{status:'applied',version}}})
  }
  if(path.endsWith('/cancel')){actionStatus='cancelled';version++;return route.fulfill({json:{result:{status:'cancelled',version}}})}
  return route.fallback()
 })
 await page.route('**/v1/clients/*/training-summaries',route=>route.fulfill({json:{summaries:[]}}))
 await page.route('**/v1/app-feedback',async route=>{
  feedbackAttempts++
  // This real submitting phase combines the active rating and disabled
  // button cascade. Hold only feedback cases, then exercise preserved retry.
  if(sample.mode==='program-feedback'&&feedbackAttempts===1){
   heldFeedback++;await feedbackGate
   return route.fulfill({status:503,headers:{'x-fit-request-id':'57000000-0000-4000-a000-000000000504','access-control-expose-headers':'x-fit-request-id'},json:{error:'unavailable'}})
  }
  return route.fulfill({json:{feedback:{id:'57000000-0000-4000-8000-000000000040'}}})
 })
 return {actor,draftKey,retainedExercise,expectedRetainedSets,historicalActions,writes,reads,diagnostics,legacyRequests,releaseLoad,releaseTurn,releaseApply,releaseFeedback,held:()=>({load:heldLoad,turn:heldTurn,apply:heldApply,feedback:heldFeedback}),recover:()=>{failure=false;backend.setTrainingDataFailure(false)},initialMessages:structuredClone(current),messages:()=>structuredClone(current),historical,counts:()=>({turnAttempts,applyAttempts,...(sample.mode==='program-feedback'?{feedbackAttempts}:{})}),historyUnchanged:()=>JSON.stringify(backend.getWorkouts())===historyBefore}
}
