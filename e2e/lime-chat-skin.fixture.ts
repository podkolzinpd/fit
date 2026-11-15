import {expect,test,type Page} from '@playwright/test'
import {clientId,trainerId,conversationId,workoutId,mockPilot,publicTrainerDraft,publicTrainerId} from './fit-lime-fixtures'
import {observeEditorImages} from './lime-editor-skin.probe'
import type {ChatMessage} from '../src/shared/domain'

export type ChatSkinSample={role:'client'|'trainer';theme:'light'|'dark';width:number;mode:string;lime:boolean}
export const chatOwnMessageId='56000000-0000-4000-8000-000000000001'
export const chatPartnerMessageId='56000000-0000-4000-8000-000000000002'
export const chatPhotoMessageId='56000000-0000-4000-8000-000000000003'
export const chatContextMessageId='56000000-0000-4000-8000-000000000004'
const meetingId='56000000-0000-4000-8000-000000000099'
// Same browser-only transport double as the existing video acceptance. This
// exercises Fit lifecycle and layout, not real camera/network/media delivery.
const meetingSDK=`
const listeners={};
const track={getId:()=> 'local-video',getType:()=> 'video',isLocal:()=>true,isMuted:()=>false,attach:()=>{},detach:()=>{},mute:async()=>{},unmute:async()=>{},dispose:async()=>{}};
const events={connection:{CONNECTION_ESTABLISHED:'established',CONNECTION_FAILED:'failed',CONNECTION_DISCONNECTED:'disconnected'},conference:{TRACK_ADDED:'track-added',TRACK_REMOVED:'track-removed',CONNECTION_INTERRUPTED:'interrupted',CONNECTION_RESTORED:'restored',CONFERENCE_FAILED:'conference-failed',CONFERENCE_JOINED:'joined'}};
window.JitsiMeetJS={init:()=>{},setLogLevel:()=>{},events,createLocalTracks:async()=>[track],JitsiConnection:class{
addEventListener(name,fn){listeners[name]=fn}connect(){listeners.established()}disconnect(){return Promise.resolve()}
initJitsiConference(){return{on:(name,fn)=>{listeners[name]=fn},addTrack:async()=>{},replaceTrack:async()=>{},join:()=>listeners.joined(),leave:async()=>{}}}
}};
`
export async function prepareChatSkin(page:Page,sample:ChatSkinSample){
 observeEditorImages(page)
 const actor=sample.role==='client'?'c11e0000-6010-4000-8000-000000000001':'c0ac0000-6010-4000-8000-000000000001'
 const partner=sample.role==='client'?trainerId:clientId
 await page.setViewportSize({width:sample.width,height:sample.width===1440?1000:844})
 await page.emulateMedia({reducedMotion:'reduce'})
 await page.addInitScript(({actor,theme})=>{
  const NativeDate=Date,fixed=NativeDate.parse('2026-11-15T09:30:00Z')
  window.Date=new Proxy(NativeDate,{construct:(t,a,n)=>Reflect.construct(t,a.length?a:[fixed],n)as Date,apply:()=>new NativeDate(fixed).toString(),get:(t,k,r)=>k==='now'?()=>fixed:Reflect.get(t,k,r)as unknown})
  localStorage.setItem('fit.appTheme',theme);localStorage.setItem('fit.clientLime.theme.'+actor,theme)
 },{actor,theme:sample.theme})
 await page.route('**/v1/**',route=>route.abort())
 const backend=await mockPilot(page,{role:sample.role,profileId:actor,clientLime:sample.role==='client'&&sample.lime,fitLime:sample.role==='trainer'&&sample.lime,pilot:true,questionWorkout:true,failWorkspace:sample.mode==='questions-error'})
 const workoutHistory=JSON.stringify(backend.getWorkouts())
 const imageURL=new URL('/exercises/reference/close-grip-lat-pulldown.jpg',test.info().project.use.baseURL).href
 const make=(id:string,senderId:string,body:string,createdAt='2026-11-15T09:00:00Z'):ChatMessage=>({id,conversationId,senderId,body,createdAt,editedAt:null,replyTo:null,image:null})
 const context=make(chatContextMessageId,partner,'Раннее сообщение: восстановление после тренировки','2026-11-14T09:00:00Z')
 let messages:ChatMessage[]=[make(chatPartnerMessageId,partner,'Проверьте технику и восстановление'),make(chatOwnMessageId,actor,'Мой сохранённый ответ')]
 if(sample.mode==='photo'||sample.mode==='upload')messages.push({...make(chatPhotoMessageId,partner,'Фото техники'),image:{url:imageURL,mimeType:'image/jpeg',width:400,height:400,sizeBytes:10000}})
 if(sample.mode==='dialog-empty')messages=[]
 let blocked=sample.mode==='blocked',connected=sample.mode!=='connection',invited=false,sendAttempts=0,olderFailure=sample.mode==='pagination',queryFailure=sample.mode==='list-error'||sample.mode==='dialog-error',searchFailure=sample.mode==='search-error',meetingActive=false,notice=false,unreadCount=messages.length?2:0
 let release=()=>{},held=0
 const gate=new Promise<void>(resolve=>{release=resolve})
 const writes:{path:string;method:string;body:unknown}[]=[],reads:string[]=[],diagnostics:string[]=[]
 page.on('pageerror',error=>diagnostics.push(error.message))
 page.on('request',request=>{const url=new URL(request.url());if(!url.pathname.startsWith('/v1/'))return;if(request.method()==='GET')reads.push(url.pathname+url.search);else if(request.method()!=='OPTIONS')writes.push({path:url.pathname,method:request.method(),body:request.postDataJSON()as unknown})})
 const initialMessages=structuredClone(messages)
 await page.route('**/v1/chat/**',async route=>{
  const request=route.request(),url=new URL(request.url()),path=url.pathname,method=request.method()
  const fail=()=>route.fulfill({status:503,json:{error:'unavailable'}})
  if(path==='/v1/chat/threads'){
   if(sample.mode==='loading'){held++;await gate}
   if(queryFailure&&sample.mode==='list-error')return fail()
   return route.fulfill({json:{threads:sample.mode==='list-empty'?[]:[{conversationId,clientId,trainerId,partnerUserId:partner,partnerName:sample.role==='client'?'Дмитрий Соколов':'Алексей Смирнов',activeConnection:connected,lastMessageBody:messages.at(-1)?.body??null,lastMessageAt:'2026-11-15T09:00:00Z',lastMessageSenderId:partner,unreadCount,canMessage:!blocked,blockedByMe:blocked,blockedByPartner:false}]}})
  }
  if(!path.startsWith('/v1/chat/conversations/'+conversationId))return route.fallback()
  if(path.endsWith('/messages')){
   if(method==='POST'){
    sendAttempts++
    if(sample.mode==='send-retry'&&sendAttempts===1)return fail()
    const input=request.postDataJSON()as{id:string;body:string;replyToMessageId?:string;image?:{dataUrl:string;mimeType:'image/jpeg';width:number;height:number;sizeBytes:number}}
    const reply=messages.find(item=>item.id===input.replyToMessageId)
    const value={...make(input.id,actor,input.body,'2026-11-15T09:30:00Z'),replyTo:reply?{messageId:reply.id,senderId:reply.senderId,body:reply.body,hasImage:!!reply.image,deleted:false}:null,image:input.image?{url:input.image.dataUrl,mimeType:input.image.mimeType,width:input.image.width,height:input.image.height,sizeBytes:input.image.sizeBytes}:null}
    if(!messages.some(item=>item.id===input.id))messages.push(value)
    return route.fulfill({json:{message:value}})
   }
   if(queryFailure&&sample.mode==='dialog-error')return fail()
   if(url.searchParams.has('beforeId')){
    if(olderFailure)return fail()
    return route.fulfill({json:{messages:[context],nextCursor:null}})
   }
   const meeting:ChatMessage={...make(meetingId,actor,'Участник присоединился к видеовстрече'),meeting:{id:meetingId,active:meetingActive}}
   return route.fulfill({json:{messages:notice?[...messages,meeting]:messages,nextCursor:sample.mode==='pagination'?{createdAt:'2026-11-15T09:00:00Z',id:chatPartnerMessageId}:null}})
  }
  if(path.endsWith('/unread'))return route.fulfill({json:{unread:{firstMessageId:unreadCount?chatPartnerMessageId:null,firstCreatedAt:unreadCount?'2026-11-15T09:00:00Z':null,unreadCount}}})
  if(path.endsWith('/read')){unreadCount=0;return route.fulfill({status:204,body:''})}
  if(path.endsWith('/block')){blocked=(request.postDataJSON()as{blocked:boolean}).blocked;return route.fulfill({json:{state:{canMessage:!blocked,blockedByMe:blocked,blockedByPartner:false}}})}
  if(path.includes('/connection')){
   if(path.endsWith('/invite'))invited=true
   if(path.endsWith('/accept'))connected=true
   return route.fulfill({json:{state:{activeConnection:connected,invitationPending:invited||sample.role==='client',invitedAt:invited||sample.role==='client'?'2026-11-15T09:00:00Z':null,canInvite:!connected&&!invited,canAccept:!connected&&sample.role==='client',trainerSwitchRequired:false}}})
  }
  if(path.endsWith('/search')){
   if(searchFailure)return fail()
   return route.fulfill({json:{messages:url.searchParams.get('q')==='пусто'?[]:[context]}})
  }
  if(path.endsWith('/window'))return route.fulfill({json:{messages:[context]}})
  if(path.includes('/messages/')){
   const id=path.split('/').at(-1),index=messages.findIndex(item=>item.id===id);expect(index).toBeGreaterThanOrEqual(0)
   if(method==='PATCH'){messages[index]={...messages[index]!,body:(request.postDataJSON()as{body:string}).body,editedAt:'2026-11-15T09:30:00Z'};return route.fulfill({json:{message:messages[index]}})}
   if(method==='DELETE'){messages=messages.filter(item=>item.id!==id);return route.fulfill({status:204,body:''})}
  }
  if(path.endsWith('/meeting')){
   if(method==='POST'){
    const command=request.postDataJSON()as{action:string}
    if(command.action==='joined'){meetingActive=true;notice=true}
    if(command.action==='leave')meetingActive=false
    return route.fulfill({json:{available:true,mediaOrigin:'https://video.example.test',meeting:command.action==='leave'?null:{id:meetingId,participantCount:notice?1:0},...(command.action==='prepare'?{credentials:{origin:'https://video.example.test',domain:'meet.jitsi',muc:'muc.meet.jitsi',room:'fit-fixture',token:'synthetic-token',expiresAt:'2099-01-01T00:00:00Z'}}:{})}})
   }
   return route.fulfill({json:{available:sample.mode.startsWith('meeting'),mediaOrigin:'https://video.example.test',meeting:meetingActive?{id:meetingId,participantCount:1}:null}})
  }
  return route.fallback()
 })
 await page.route('https://video.example.test/libs/lib-jitsi-meet.min.js',route=>sample.mode==='meeting-error'?route.fulfill({status:503,body:''}):route.fulfill({contentType:'application/javascript',headers:{'access-control-allow-origin':'*'},body:meetingSDK}))
 if(sample.mode==='connection'&&sample.role==='client'){
  await page.route('**/v1/trainer-connections/preview',route=>route.fulfill({json:{preview:{clientId,currentRelationshipId:null,currentTrainer:null,trainer:{id:trainerId,name:'Дмитрий Соколов'},offerVersion:'mc56-offer-v1'}}}))
  await page.route('**/v1/trainer-connections/confirm',route=>{const input=route.request().postDataJSON()as{source:string;locator:string;expectedRelationshipId:string|null;offerVersion:string;operationId:string};expect(input).toMatchObject({source:'chat',locator:conversationId,expectedRelationshipId:null,offerVersion:'mc56-offer-v1'});expect(input.operationId).toMatch(/^[\da-f-]{36}$/);connected=true;return route.fulfill({json:{clientId}})})
 }
 if(sample.mode==='external-profile'){
  const profile={...structuredClone(publicTrainerDraft),photos:publicTrainerDraft.photos.map(photo=>({...photo,url:imageURL,thumbnailUrl:imageURL}))}
  await page.route(`**/v1/trainers/${publicTrainerId}/public-profile`,route=>route.fulfill({json:{publicId:publicTrainerId,draft:profile,published:profile,listedInCatalog:true,publishedAt:'2026-11-15T09:00:00Z',updatedAt:'2026-11-15T09:00:00Z',version:1,isBrandTrainer:false}}))
 }
 return {actor,partner,initialMessages,writes,reads,diagnostics,workoutId,release,held:()=>held,messages:()=>structuredClone(messages),sendAttempts:()=>sendAttempts,recover:()=>{queryFailure=false;searchFailure=false;olderFailure=false;backend.setWorkspaceFailure(false)},historyUnchanged:()=>JSON.stringify(backend.getWorkouts())===workoutHistory}
}
