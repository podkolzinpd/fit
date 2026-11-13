import {expect,type Page,type Request,type Route} from '@playwright/test'
import {mockPilot,clientId,trainerId,publicTrainerDraft} from './fit-lime-fixtures'
import {observeEditorImages} from './lime-editor-skin.probe'
import {SPORT_INTEREST_LABELS} from '../src/shared/sport-interests'
import type {TrainerProfileDraft} from '../src/shared/domain'

export type ProfileSkinSample={role:'client'|'trainer';theme:'light'|'dark';width:number;mode:string;lime:boolean;section?:string;reference?:boolean}
export async function prepareProfileSkin(page:Page,sample:ProfileSkinSample){
 observeEditorImages(page)
 const actor=sample.lime?(sample.role==='client'?(sample.reference===false?'10000000-0000-4000-8000-000000000002':'c11e0000-6010-4000-8000-000000000001'):'c0ac0000-6010-4000-8000-000000000001'):'10000000-0000-4000-8000-000000000001'
 await page.setViewportSize({width:sample.width,height:sample.width===1440?1000:844});await page.emulateMedia({reducedMotion:'reduce'})
 await page.addInitScript(({actor,theme})=>{
  const NativeDate=Date,fixed=NativeDate.parse('2026-11-13T09:00:00Z')
  window.Date=new Proxy(NativeDate,{construct:(t,a,n)=>Reflect.construct(t,a.length?a:[fixed],n)as Date,apply:()=>new NativeDate(fixed).toString(),get:(t,k,r)=>k==='now'?()=>fixed:Reflect.get(t,k,r)as unknown})
  localStorage.setItem('fit.appTheme',theme);localStorage.setItem('fit.clientLime.theme.'+actor,theme)
  const key='fit.coachmarks-seen.'+actor,seen=JSON.parse(localStorage.getItem(key)??'[]')as string[]
  localStorage.setItem(key,JSON.stringify([...seen,'trainer-profile-settings-2026-09','client-profile-compact-2026-10']))
 },{actor,theme:sample.theme})
 const backend=await mockPilot(page,{role:sample.role,profileId:actor,clientLime:sample.role==='client'&&sample.lime,fitLime:sample.role==='trainer'&&sample.lime,withGoal:true,withMeasurements:true})
 const workoutHistory=JSON.stringify(backend.getWorkouts())
 let client={id:clientId,canArchive:true,hasAccount:true,fullName:sample.mode==='long'?'Алексей Александрович Смирнов-Задонский':'Алексей Смирнов',canonicalFullName:sample.mode==='long'?'Алексей Александрович Смирнов-Задонский':'Алексей Смирнов',gender:'male' as string|null,ageYears:32 as number|null,ageUpdatedAt:'2026-11-13' as string|null,heightCm:181 as number|null,goal:'Тренироваться регулярно и сохранять хорошее самочувствие',note:null,currentWeightKg:78 as number|null,archivedAt:null,version:1,membershipVersion:1}
 let sport={sports:Object.keys(SPORT_INTEREST_LABELS).slice(0,8),bio:'Личный спортивный профиль MC54. Бег, плавание и силовые тренировки.' as string|null}
 let account={firstName:'Антон',lastName:null as string|null,timezone:'Europe/Moscow'}
 let professional={publicId:'54000000-0000-4000-8000-000000000060',draft:{...structuredClone(publicTrainerDraft),displayName:'Антон Князев',avatarDataUrl:null,photos:[],certificates:[{title:'Подготовка тренеров',organization:'Синтетический институт',year:2020}]}as TrainerProfileDraft,published:null as TrainerProfileDraft|null,listedInCatalog:false,publishedAt:null as string|null,updatedAt:'2026-11-13T09:00:00.000Z',version:1,isBrandTrainer:false}
 if(sample.mode==='empty'||sample.mode==='load-error')professional={...professional,draft:{...professional.draft,bio:'',specialties:[],city:'',metroStationIds:[],customLocations:[],trainingModes:[],experienceStartYear:null,education:'',formats:'',price:'',acceptingClients:false,certificates:[]}}
 if(sample.mode==='published'||sample.mode==='unpublish'||sample.mode==='publication-error')professional={...professional,published:structuredClone(professional.draft),listedInCatalog:true,publishedAt:'2026-11-13T09:00:00Z'}
 let photo={url:null as string|null,version:0},grid='comfortable',feedbackCount=0,mutationAttempts=0,queryFailure=sample.mode==='load-error'
 const notificationMode=sample.mode.startsWith('notify-'),pushPreferences={workout_reminder:true,workout_scheduled:true,chat_message:false}
 let notifyFailure=sample.mode==='notify-error'
 const initialData=structuredClone({client,sport,account,professional,photo,grid,...(notificationMode?{pushPreferences}:{})})
 let release=()=>{},held=0
 const gate=new Promise<void>(resolve=>{release=resolve})
 const pending=sample.mode.endsWith('-save')||sample.mode==='feedback'||sample.mode==='schedule'||sample.mode==='photo'||sample.mode==='notify-working'
 const command=async(route:Route)=>{
  mutationAttempts++
  if(pending&&mutationAttempts===1){held++;await gate;await route.fulfill({status:503,json:{error:'unavailable'}});return false}
  return true
 }
 await page.route('**/v1/auth/yandex/session',async route=>{
  if(route.request().method()!=='GET')return route.fallback()
  return route.fulfill({json:{accessMode:'read_write',profile:{id:actor,...account,accountRole:sample.role,...(sample.role==='client'?{client:{id:clientId,trainerId,fullName:client.fullName}}:{}),experiments:{trainerScheduleV2:true,fitLime:sample.role==='trainer'&&sample.lime,clientLime:sample.role==='client'&&sample.lime},preferences:{scheduleDensity:grid}}}})
 })
 await page.route('**/v1/clients',async route=>{
  if(route.request().method()!=='GET')return route.fallback()
  if(queryFailure&&sample.role==='client')return route.fulfill({status:503,json:{error:'unavailable'}})
  return route.fulfill({json:{clients:sample.mode==='no-client'?[]:[client]}})
 })
 await page.route('**/v1/me/sport-profile',route=>route.fulfill({json:{sport}}))
 await page.route('**/v1/me/client-profile',async route=>{
  if(!await command(route))return
  const input=route.request().postDataJSON()as{clientId:string|null;expectedVersion:number|null;draft:{fullName:string;gender:string|null;ageYears:number|null;ageUpdatedAt:string|null;heightCm:number|null;goal:string|null};sport:typeof sport}
  expect(input.expectedVersion).toBe(client.version);client={...client,...input.draft,goal:input.draft.goal??'',canonicalFullName:input.draft.fullName,version:client.version+1};sport=input.sport
  await route.fulfill({json:{client:{id:clientId,version:client.version}}})
 })
 await page.route(`**/v1/clients/${clientId}/photo`,async route=>{
  if(route.request().method()==='PUT'){
   if(!await command(route))return
   const input=route.request().postDataJSON()as{expectedVersion:number;photo:{dataUrl:string;sizeBytes:number;width:number;height:number}}
   expect(input.expectedVersion).toBe(photo.version);expect(input.photo.sizeBytes).toBeLessThanOrEqual(160000);photo={url:input.photo.dataUrl,version:photo.version+1}
  }
  await route.fulfill({json:photo})
 })
 await page.route('**/v1/corporate-services/access',route=>sample.mode==='capability-error'?route.fulfill({status:503,json:{error:'unavailable'}}):route.fulfill({json:{allowed:false}}))
 await page.route('**/v1/trainer-profile/access',route=>route.fulfill({json:{available:sample.mode==='readonly',managedByAdmin:sample.mode==='readonly',version:1}}))
 await page.route('**/v1/trainer-profile',async route=>{
  if(route.request().method()==='GET'){
   if(queryFailure&&sample.role==='trainer')return route.fulfill({status:503,json:{error:'unavailable'}})
   return route.fulfill({json:professional})
  }
  if(!await command(route))return
  professional={...professional,draft:route.request().postDataJSON()as TrainerProfileDraft,version:professional.version+1}
  await route.fulfill({json:professional})
 })
 await page.route('**/v1/trainer-profile/unpublish',async route=>{
  if(sample.mode==='publication-error')return route.fulfill({status:503,json:{error:'unavailable'}})
  professional={...professional,published:null,listedInCatalog:false,publishedAt:null,version:professional.version+1};await route.fulfill({json:professional})
 })
 await page.route('**/v1/profile',async route=>{
  if(route.request().method()!=='PUT')return route.fallback()
  if(!await command(route))return
  const data=route.request().postDataJSON()as Partial<typeof account>&{scheduleDensity?:string};account={...account,...data};if(data.scheduleDensity)grid=data.scheduleDensity
  await route.fulfill({status:204,body:''})
 })
 await page.route('**/v1/app-feedback',async route=>{
  if(!await command(route))return
  feedbackCount++;await route.fulfill({status:201,json:{feedback:{id:'54000000-0000-4000-8000-000000000080'}}})
 })
 await page.route('**/v1/push-notifications/status',route=>route.fulfill({json:{status:{subscribed:false,preferences:{workout_reminder:true,workout_scheduled:true,chat_message:true}}}}))
 if(notificationMode){
  // Reuse the existing page-scoped notification acceptance platform contract;
  // no browser registration, subscription or push leaves these fixtures.
  await page.addInitScript(()=>{
   Object.defineProperty(navigator,'standalone',{value:true,configurable:true})
   Object.defineProperty(window,'PushManager',{value:class{},configurable:true})
   Object.defineProperty(window,'Notification',{value:{permission:'granted'},configurable:true})
   Object.defineProperty(navigator,'serviceWorker',{configurable:true,value:{getRegistration:()=>Promise.resolve({pushManager:{getSubscription:()=>Promise.resolve({endpoint:'https://push.example/mc54',toJSON:()=>({keys:{p256dh:'public-test',auth:'test-auth'}})})}}),addEventListener(){},removeEventListener(){}}})
  })
  await page.route('**/v1/push-notifications/**',async route=>{
   const path=new URL(route.request().url()).pathname
   if(notifyFailure)return route.fulfill({status:503,json:{error:'unavailable'}})
   if(path.includes('/preferences/')){
    if(!await command(route))return
    const kind=path.split('/').pop()as keyof typeof pushPreferences;expect(kind in pushPreferences).toBe(true);pushPreferences[kind]=(route.request().postDataJSON()as{enabled:boolean}).enabled;return route.fulfill({status:204,body:''})
   }
   if(path.endsWith('/test'))return route.fulfill({status:202,body:''})
   if(path.endsWith('/subscription/status'))return route.fulfill({json:{subscribed:true}})
   return route.fulfill({json:{status:{subscribed:true,preferences:pushPreferences}}})
  })
 }
 const writes:{method:string;path:string;body:unknown}[]=[],reads:string[]=[],errors:string[]=[],failed:{method:string;path:string;error:string|null;responseStatus:number|null}[]=[],responses:{method:string;path:string;status:number}[]=[],consoleErrors:{path:string;text:string}[]=[],responseStatuses=new WeakMap<Request,number>()
 page.on('request',request=>{
  const u=new URL(request.url());if(request.method()==='GET'&&u.pathname.startsWith('/v1/'))reads.push(u.pathname+u.search)
  if(['POST','PUT','PATCH','DELETE'].includes(request.method())){const raw=request.postDataBuffer(),contentType=request.headers()['content-type']??'';writes.push({method:request.method(),path:u.pathname,body:raw?(contentType.includes('json')?JSON.parse(raw.toString()):{contentType,encoding:'base64',raw:raw.toString('base64')}):null})}
 })
 page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{responseStatuses.set(r.request(),r.status());if(r.status()>=400)responses.push({method:r.request().method(),path:new URL(r.url()).pathname,status:r.status()})});page.on('requestfailed',r=>failed.push({method:r.method(),path:new URL(r.url()).pathname,error:r.failure()?.errorText??null,responseStatus:responseStatuses.get(r)??null}));page.on('console',m=>{if(m.type()==='error')consoleErrors.push({path:new URL(m.location().url||page.url()).pathname,text:m.text()})})
 return {actor,backend,initialData,writes,reads,diagnostics:{errors,failed,responses,consoleErrors},release:()=>release(),held:()=>held,attempts:()=>mutationAttempts,feedbackCount:()=>feedbackCount,recoverQuery:()=>{queryFailure=false},recoverNotify:()=>{notifyFailure=false},data:()=>structuredClone({client,sport,account,professional,photo,grid,...(notificationMode?{pushPreferences}:{})}),workoutHistoryUnchanged:()=>JSON.stringify(backend.getWorkouts())===workoutHistory}
}
