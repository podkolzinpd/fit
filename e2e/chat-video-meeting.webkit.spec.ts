import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { nativeAiUrl } from './native-ai-fixture'
import { mockPilot, clientId, conversationId, messageId, trainerId } from './fit-lime-fixtures'

// Browser acceptance of Fit UX only. The SDK double does not prove real WebRTC.
const sdkDouble = `
const listeners = {};
const track = {getId:()=> 'local-video',getType:()=> 'video',isLocal:()=>true,isMuted:()=>false,attach:()=>{},detach:()=>{},mute:async()=>{},unmute:async()=>{},dispose:async()=>{}};
const events={connection:{CONNECTION_ESTABLISHED:'established',CONNECTION_FAILED:'failed',CONNECTION_DISCONNECTED:'disconnected'},conference:{TRACK_ADDED:'track-added',TRACK_REMOVED:'track-removed',CONNECTION_INTERRUPTED:'interrupted',CONNECTION_RESTORED:'restored',CONFERENCE_FAILED:'conference-failed',CONFERENCE_JOINED:'joined'}};
window.JitsiMeetJS={init:()=>{},setLogLevel:()=>{},events,createLocalTracks:async()=>[track],JitsiConnection:class{
 addEventListener(name,fn){listeners[name]=fn}
 connect(){listeners.established()}
 disconnect(){return Promise.resolve()}
 initJitsiConference(){return {on:(name,fn)=>{listeners[name]=fn},addTrack:async()=>{},replaceTrack:async()=>{},join:()=>listeners.joined(),leave:async()=>{}}}
}};
`
for (const role of ['client','trainer'] as const) {
  test(`video conference preserves ${role} chat draft and posts presence after entry`, async ({ page }, testInfo) => {
    await page.route('**/*.woff2', route => {
      const name=new URL(route.request().url()).pathname.split('/').at(-1) ?? ''
      if (!/^onest-[a-z-]+-normal\.woff2$/.test(name)) return route.fallback()
      return route.fulfill({ path:fileURLToPath(new URL(`../node_modules/@fontsource-variable/onest/files/${name}`,import.meta.url)),contentType:'font/woff2' })
    })
    await mockPilot(page,{ role, profileId:role==='trainer'?trainerId:clientId, clientLime:true, fitLime:true, workouts:[] })
    const actorId=role==='trainer'?trainerId:clientId
    const meeting='10000000-0000-4000-8000-000000000099'
    const commands:string[]=[]
    let active=false,notice=false
    await page.route('https://video.example.test/libs/lib-jitsi-meet.min.js',route=>route.fulfill({ contentType:'application/javascript',headers:{ 'access-control-allow-origin':'*' },body:sdkDouble }))
    await page.route(`**/v1/chat/conversations/${conversationId}/meeting`, async route=>{
      if(route.request().method()==='POST'){
        const command=route.request().postDataJSON() as { action:string }
        commands.push(command.action)
        if(command.action==='joined') {active=true;notice=true}
        if(command.action==='leave') active=false
        return route.fulfill({json:{available:true,mediaOrigin:'https://video.example.test',meeting:command.action==='leave'?null:{id:meeting,participantCount:notice?1:0},
          ...(command.action==='prepare'?{credentials:{origin:'https://video.example.test',domain:'meet.jitsi',muc:'muc.meet.jitsi',room:'fit-fixture',token:'synthetic-token',expiresAt:'2099-01-01T00:00:00Z'}}:{})}})
      }
      return route.fulfill({json:{available:true,mediaOrigin:'https://video.example.test',meeting:active?{id:meeting,participantCount:1}:null}})
    })
    await page.route(`**/v1/chat/conversations/${conversationId}/connection`,route=>route.fulfill({json:{state:{activeConnection:true,invitationPending:false,invitedAt:null,canInvite:false,canAccept:false,trainerSwitchRequired:false}}}))
    await page.route(`**/v1/chat/conversations/${conversationId}/messages?*`,route=>route.fulfill({json:{messages:notice?[{id:messageId,conversationId,senderId:actorId,body:`${role==='trainer'?'Тренер':'Спортсмен'} присоединился к видеовстрече`,createdAt:'2026-10-28T10:00:00Z',editedAt:null,replyTo:null,image:null,meeting:{id:meeting,active}}]:[],nextCursor:null}}))
    await page.route(`**/v1/chat/conversations/${conversationId}/unread`,route=>route.fulfill({json:{unread:{firstMessageId:null,firstCreatedAt:null,unreadCount:0}}}))
    await page.goto(nativeAiUrl(`/chat/${conversationId}`))
    if(role==='trainer' || process.env.VITE_CLIENT_LIME_ENABLED==='true') await expect(page.locator('.phone-frame')).toHaveClass(/fit-lime/)
    const composer=page.getByRole('textbox',{name:'Сообщение',exact:true})
    await composer.fill('Черновик до видеовстречи')
    await page.getByRole('button',{name:'Видеовстреча',exact:true}).click()
    const dialog=page.getByRole('dialog',{name:'Видеовстреча',exact:true})
    await expect(dialog.getByRole('button',{name:'Присоединиться',exact:true})).toBeVisible()
    expect(commands).toEqual([])
    await dialog.getByRole('button',{name:'Присоединиться',exact:true}).click()
    await expect(dialog.getByRole('button',{name:'Выйти из встречи',exact:true})).toBeVisible()
    expect(commands).toEqual(['prepare','joined'])
    // Sizes/themes exercise layout only; the lifecycle is executed once per role.
    for(const width of role==='client'?[390,430]:[390,1440]){
      await page.setViewportSize({width,height:width===1440?1000:844})
      await expect(dialog).toBeVisible()
      expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true)
      await page.screenshot({path:testInfo.outputPath(`meeting-${role}-${width}.png`)})
      if(role==='client') {
        await page.evaluate(()=>{document.documentElement.classList.add('theme-light');document.querySelector('.phone-frame')?.classList.add('theme-light')})
        await page.screenshot({path:testInfo.outputPath(`meeting-${role}-${width}-light.png`)})
        await page.evaluate(()=>{document.documentElement.classList.remove('theme-light');document.querySelector('.phone-frame')?.classList.remove('theme-light')})
      }
    }
    if(role==='trainer') await page.keyboard.press('Escape')
    else await dialog.getByRole('button',{name:'Выйти из встречи',exact:true}).click()
    await expect(page).toHaveURL(nativeAiUrl(`/chat/${conversationId}`))
    await expect(dialog).not.toBeVisible()
    await expect(composer).toHaveValue('Черновик до видеовстречи')
    await expect.poll(()=>commands.at(-1)).toBe('leave')
    await expect(page.locator('.chat-meeting-card')).toContainText('Встреча завершена')
    await page.screenshot({path:testInfo.outputPath(`meeting-ended-${role}.png`)})
  })
}
