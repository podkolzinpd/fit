import {test,expect} from '@playwright/test'
import {writeFile} from 'node:fs/promises'
import {captureLimeErrorSemantics,expectLimeErrorSemantics} from './lime-error-semantics'
import {probeActualDurationSkin,assertActualDurationOwnership} from './lime-actual-duration-skin.cases'
import {restTimerWorkout,mockPilot,workoutId,clientId,trainerId} from './fit-lime-fixtures'

// Error paint stays in the native visual lane. The unchanged business suite
// separately checks duration-only draft/version/retry behavior.
export function limeDurationErrorPaintCases(){
  for(const role of ['client','trainer']as const)test('Done Lime duration network error paint '+role,{tag:['@lime-duration']},async({page},info)=>{
    const durationPath='/v1/workouts/'+workoutId+'/duration'
    const pageErrors:string[]=[],failed:{path:string;error:string|null}[]=[],responses:{path:string;status:number}[]=[],consoleErrors:{path:string;text:string}[]=[]
    page.on('pageerror',error=>pageErrors.push(error.message))
    page.on('requestfailed',request=>failed.push({path:new URL(request.url()).pathname,error:request.failure()?.errorText??null}))
    page.on('response',response=>{if(response.status()>=400)responses.push({path:new URL(response.url()).pathname,status:response.status()})})
    page.on('console',message=>{if(message.type()==='error')consoleErrors.push({path:new URL(message.location().url||page.url()).pathname,text:message.text()})})
    const id=role==='client'?clientId:trainerId,theme=role==='client'?'light':'dark'
    await page.setViewportSize({width:390,height:844})
    await page.emulateMedia({reducedMotion:'reduce'})
    await page.clock.setFixedTime(new Date('2026-11-09T09:00:00Z'))
    await page.addInitScript(({id,theme})=>{localStorage.setItem('fit.appTheme',theme);localStorage.setItem('fit.clientLime.theme.'+id,theme)},{id,theme})
    const current=restTimerWorkout()
    current.status='done';current.startedAt=null;current.completedAt='2026-09-24T12:00:00Z';current.actualDurationSec=null
    current.createdBy=id
    if(role==='trainer')current.trainerId=id
    const backend=await mockPilot(page,{role,profileId:id,fitLime:true,clientLime:role==='client',workouts:[current]})
    const facts=JSON.stringify(backend.getWorkouts()[0]!.exercises)
    await page.route('**/v1/push-notifications/status',route=>route.fulfill({json:{status:{subscribed:false,preferences:{workout_reminder:true,workout_scheduled:true,chat_message:true}}}}))
    await page.route('**/v1/exercise-media/sign-batch',route=>{
      const {paths}=route.request().postDataJSON()as{paths:string[]}
      return route.fulfill({json:{signedUrls:paths.map(path=>({path,signedUrl:new URL('/exercises/vital/air-bike-sprint.jpg',page.url()).href}))}})
    })
    const commands:{actualDurationSec:number|null;expectedVersion:number}[]=[]
    await page.route('**'+durationPath,async route=>{
      commands.push(route.request().postDataJSON()as{actualDurationSec:number|null;expectedVersion:number})
      if(commands.length===1)return route.abort('connectionrefused')
      if(commands.length===2){current.actualDurationSec=2700;current.version=2;return route.fulfill({status:409,json:{error:'conflict'}})}
      return route.fallback()
    })
    await page.goto('/workouts/'+workoutId)
    await expect(page.locator('.phone-frame')).toHaveClass(/fit-lime-shell/)
    await expect(page.locator('.phone-frame')).toHaveClass(/workout-detail-history-identity/)
    if(role==='trainer')await page.locator('.coach-workout-summary > summary').click()
    const trigger=page.locator('.workout-actual-duration button')
    await expect(trigger).toHaveAttribute('aria-label','Указать длительность')
    await trigger.click()
    const dialog=page.getByRole('dialog',{name:'Длительность тренировки',exact:true}),input=dialog.getByRole('textbox',{name:'Длительность тренировки, мин'})
    await expect(input).toHaveValue('')
    await expect(input).toBeFocused()
    await input.fill('50')
    await dialog.getByRole('button',{name:'Сохранить',exact:true}).click()
    await expect(dialog.getByRole('alert')).toContainText(/повторите/i)
    await expect(input).toHaveValue('50')
    expect(commands).toEqual([{actualDurationSec:3000,expectedVersion:1}])
    await page.mouse.move(0,0)
    const network={state:'network',...await probeActualDurationSkin(page,info.outputPath('duration-network-error.png'))}
    const networkSemantics=await captureLimeErrorSemantics(dialog.getByRole('alert'))
    await dialog.getByRole('button',{name:'Повторить',exact:true}).click()
    await expect(dialog.getByRole('alert')).toContainText('45 мин')
    await expect(input).toHaveValue('50')
    expect(commands).toEqual([{actualDurationSec:3000,expectedVersion:1},{actualDurationSec:3000,expectedVersion:1}])
    await page.mouse.move(0,0)
    const conflict={state:'conflict',...await probeActualDurationSkin(page,info.outputPath('duration-conflict-error.png'))}
    const conflictSemantics=await captureLimeErrorSemantics(dialog.getByRole('alert'))
    await dialog.getByRole('button',{name:'Повторить',exact:true}).click()
    await expect(dialog).not.toBeVisible()
    await expect(trigger).toBeFocused()
    await expect(page.locator('.workout-actual-duration')).toContainText('50 мин')
    expect(commands).toEqual([{actualDurationSec:3000,expectedVersion:1},{actualDurationSec:3000,expectedVersion:1},{actualDurationSec:3000,expectedVersion:2}])
    expect(JSON.stringify(backend.getWorkouts()[0]!.exercises)).toBe(facts)
    expect(backend.getWorkouts()[0]!.actualDurationSec).toBe(3000)
    expect(backend.getWorkouts()[0]!.version).toBe(3)
    await writeFile(info.outputPath('duration-error-semantics.json'),JSON.stringify({sample:{role,theme,width:390},states:[network,conflict],networkSemantics,conflictSemantics,commands,pageErrors,failed,responses,consoleErrors},null,2))
    expect(pageErrors).toEqual([])
    expect(failed).toHaveLength(1);expect(failed[0]!.path).toBe(durationPath);expect(failed[0]!.error).toBeTruthy()
    expect(responses).toEqual([{path:durationPath,status:409}])
    expect(consoleErrors.filter(error=>error.path!==durationPath||!error.text.startsWith('Failed to load resource:'))).toEqual([])
    expect(consoleErrors.length).toBeLessThanOrEqual(2)
    for(const state of [network,conflict])assertActualDurationOwnership(state,true)
    expectLimeErrorSemantics(networkSemantics)
    expectLimeErrorSemantics(conflictSemantics)
  })
}
