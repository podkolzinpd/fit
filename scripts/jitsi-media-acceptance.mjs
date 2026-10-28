// Two independent real browser peers; synthetic devices, no Fit accounts or application DB.
import { readFileSync } from 'node:fs'
import { createDecipheriv, privateDecrypt } from 'node:crypto'
import { chromium } from '@playwright/test'

const encrypted = JSON.parse(readFileSync(process.argv[2],'utf8'))
const key = privateDecrypt({key:readFileSync(process.argv[3]),oaepHash:'sha256'},Buffer.from(encrypted.key,'base64'))
const decipher = createDecipheriv('aes-256-gcm',key,Buffer.from(encrypted.iv,'base64'))
decipher.setAuthTag(Buffer.from(encrypted.tag,'base64'))
const credentials = JSON.parse(Buffer.concat([decipher.update(Buffer.from(encrypted.ciphertext,'base64')),decipher.final()]))
if (credentials.expiresAt*1000 < Date.now()+30000) throw new Error('Synthetic room credentials expired')
const browser = await chromium.launch({headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--autoplay-policy=no-user-gesture-required']})
let phase = 'default'
let lastSamples = []
try {
  for (const relay of [false,true]) {
    phase = relay ? 'forced-turn' : 'default'
    const contexts = await Promise.all([browser.newContext(),browser.newContext()])
    const pages = await Promise.all(contexts.map(context => context.newPage()))
    try {
      await Promise.all(pages.map(async (page,index) => {
        await page.route('https://fit-training.ru/__fit_video_qa__',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Fit media acceptance</title><body></body>'}))
        await page.addInitScript(forceRelay=>{
          const Original = window.RTCPeerConnection
          window.__pcs=[]
          window.RTCPeerConnection=class extends Original {
            constructor(config,...rest) {super(forceRelay?{...config,iceTransportPolicy:'relay'}:config,...rest);window.__pcs.push(this)}
          }
        },relay)
        await page.goto('https://fit-training.ru/__fit_video_qa__')
        await page.addScriptTag({url:`${credentials.origin}/libs/lib-jitsi-meet.min.js`})
        await page.evaluate(async ({origin,domain,muc,room,token})=>{
          window.__qa={state:'starting',error:null,tracks:[],connection:null,conference:null}
          const state=window.__qa
          const sdk=window.JitsiMeetJS
          sdk.setLogLevel('error'); sdk.init({disableAudioLevels:true,disableSimulcast:true,analytics:{disabled:true}})
          state.tracks=await sdk.createLocalTracks({devices:['audio','video'],resolution:180})
          const connection=new sdk.JitsiConnection(null,token,{hosts:{domain,muc},serviceUrl:`${origin.replace('https:','wss:')}/xmpp-websocket`,enableWebsocketResume:true,p2p:{stunServers:[]}})
          state.connection=connection
          connection.addEventListener(sdk.events.connection.CONNECTION_FAILED,()=>{state.error='connection-failed'})
          connection.addEventListener(sdk.events.connection.CONNECTION_ESTABLISHED,async()=>{
            state.state='signaling-connected'
            try {
              const conference=connection.initJitsiConference(room,{openBridgeChannel:true,p2p:{enabled:false},enableLayerSuspension:true})
              state.conference=conference
              conference.on(sdk.events.conference.CONFERENCE_FAILED,()=>{state.error='conference-failed'})
              conference.on(sdk.events.conference.CONFERENCE_JOINED,()=>{state.state='joined'})
              conference.on(sdk.events.conference.TRACK_ADDED,track=>{
                if(track.isLocal())return
                const element=document.createElement(track.getType()==='video'?'video':'audio')
                element.autoplay=true; element.muted=track.getType()==='video';document.body.append(element)
                track.attach(element);element.play().catch(()=>{})
              })
              for(const track of state.tracks)await conference.addTrack(track)
              conference.join()
            } catch {state.error='setup-failed'}
          })
          connection.connect()
        },{...credentials,token:credentials.tokens[index]})
      }))
      const samples = async()=>Promise.all(pages.map(page=>page.evaluate(async()=>{
        const reports=(await Promise.all(window.__pcs.map(pc=>pc.getStats().then(report=>[...report.values()]).catch(()=>[])))).flat()
        const inbound=reports.filter(r=>r.type==='inbound-rtp'&&!r.isRemote)
        const frames=inbound.filter(r=>r.kind==='video'||r.mediaType==='video').reduce((n,r)=>n+(r.framesDecoded||0),0)
        const audio=inbound.filter(r=>r.kind==='audio'||r.mediaType==='audio').reduce((n,r)=>n+(r.bytesReceived||0),0)
        const selected=reports.filter(r=>r.type==='candidate-pair'&&r.state==='succeeded'&&(r.nominated||r.selected)).map(pair=>{
          const local=reports.find(r=>r.id===pair.localCandidateId)
          return {type:local?.candidateType,protocol:local?.protocol,relayProtocol:local?.relayProtocol}
        })
        const policies=window.__pcs.filter(pc=>pc.connectionState!=='closed').map(pc=>pc.getConfiguration().iceTransportPolicy)
        return {state:window.__qa.state,error:window.__qa.error,frames,audio,selected,policies}
      })))
      let received
      for(let attempt=0;attempt<120;attempt++) {
        received=await samples()
        lastSamples=received
        if(received.some(peer=>peer.error))throw new Error('Controlled conference failure')
        if(received.every(peer=>peer.state==='joined'&&peer.frames>3&&peer.audio>500))break
        if(attempt===119)throw new Error('Bidirectional media not received')
        await new Promise(resolve=>setTimeout(resolve,500))
      }
      // Chromium can label the selected pair's local candidate prflx after ICE
      // nomination; enforce the actual relay policy and TLS transport instead.
      if(relay&&!received.every(peer=>peer.policies.length>0&&peer.policies.every(policy=>policy==='relay')&&peer.selected.some(candidate=>candidate.relayProtocol==='tls')))throw new Error('TURN TLS candidate not selected')
      await Promise.all(pages.map(page=>page.evaluate(async()=>{
        for(const track of window.__qa.tracks){await track.mute();if(!track.isMuted())throw new Error('Mute failed');await track.unmute();if(track.isMuted())throw new Error('Unmute failed')}
      })))
      console.log(JSON.stringify({phase,result:'passed',peers:received}))
    } finally {
      await Promise.all(pages.map(page=>page.evaluate(async()=>{
        if(!window.__qa)return
        await Promise.allSettled(window.__qa.tracks.map(track=>track.dispose()))
        if(window.__qa.conference)await Promise.race([window.__qa.conference.leave(),new Promise(resolve=>setTimeout(resolve,2000))])
        if(window.__qa.connection)await Promise.resolve(window.__qa.connection.disconnect())
      }).catch(()=>{})))
      await Promise.all(contexts.map(context=>context.close()))
    }
  }
} catch {
  console.error(JSON.stringify({phase,result:'failed',peers:lastSamples}))
  process.exitCode=1
} finally {await browser.close()}
