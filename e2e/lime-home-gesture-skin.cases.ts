import {expect,test,type Locator} from '@playwright/test'
import {writeFile} from 'node:fs/promises'
import {beginClientGesture,clientId} from './fit-lime-fixtures'
import {prepareHomeSkin,homeToday,homeWeek,type HomeSkinSample} from './lime-home-skin.fixture'
import {probeEditorSkin,assertEditorOwnership} from './lime-editor-skin.probe'
import {homeContract} from './lime-home-skin.contract'

const samples:readonly HomeSkinSample[]=[
 {role:'trainer',theme:'dark',width:390,mode:'gesture-reschedule',lime:true,density:'comfortable'},
 {role:'trainer',theme:'light',width:430,mode:'gesture-booking',lime:true,density:'compact'},
 {role:'trainer',theme:'dark',width:375,mode:'queue-snooze-error',lime:true,density:'comfortable'},
]

// Reuse the existing quick-entry quiet-scroll recipe. This is real scrolling
// before the gesture, not snapshot normalization or a change to event handlers.
async function scrollDayForBooking(viewport:Locator){
 await viewport.evaluate(async element=>{
  await document.fonts.ready
  await new Promise<void>(resolve=>{
   const top=element.querySelector<HTMLElement>('.day-grid')!.offsetHeight/24*13
   let observed=Math.abs(element.scrollTop-top)<1,previous=element.scrollTop,changedAt=performance.now()
   const scroll=()=>{observed=true;previous=element.scrollTop;changedAt=performance.now()}
   element.addEventListener('scroll',scroll);element.scrollTop=top
   const frame=()=>{
    if(element.scrollTop!==previous){observed=false;previous=element.scrollTop;changedAt=performance.now()}
    if(observed&&performance.now()-changedAt>=200){element.removeEventListener('scroll',scroll);resolve()}
    else requestAnimationFrame(frame)
   }
   requestAnimationFrame(frame)
  })
 })
}

export function limeHomeGestureSkinCases(){
 for(const sample of samples)test(`Home Lime nested skin ownership ${sample.mode}-${sample.theme}-${sample.width}-${sample.density}`,async({page,browserName},info)=>{
  const fixture=await prepareHomeSkin(page,{...sample,mode:sample.mode==='gesture-reschedule'?'home':'empty'})
  const route=`/today?date=${homeToday}&week=${homeWeek}`
  const states:(Awaited<ReturnType<typeof probeEditorSkin>>&{state:string;url:string;consumer:boolean})[]=[]
  const commands:{method:string;path:string;body:unknown}[]=[]
  const snoozePath=`/v1/clients/${clientId}/attention/snooze`
  let release=()=>{},held=0
  const gate=new Promise<void>(resolve=>{release=resolve})
  if(sample.mode==='queue-snooze-error')await page.route('**'+snoozePath,async route=>{
   expect(route.request().method()).toBe('POST');expect(route.request().postDataJSON()).toEqual({})
   commands.push({method:'POST',path:snoozePath,body:route.request().postDataJSON()});held++
   await gate;await route.fulfill({status:503,json:{error:'unavailable'}})
  })
  const probe=async(state:string)=>{
   await page.mouse.move(0,0)
   states.push({...await probeEditorSkin(page,info.outputPath('home-'+state+'.png'),homeContract.selector,homeContract),state,url:new URL(page.url()).pathname+new URL(page.url()).search+new URL(page.url()).hash,consumer:true})
  }
  await page.goto(route)
  await expect(page.locator('.phone-frame')).toHaveClass(/fit-lime-shell/)
  await expect(page.locator('.phone-frame')).toHaveClass(/trainer-schedule-v2-shell/)
  await expect(page.locator('.schedule-v2')).toHaveClass(/coach-day-swipe/)
  await expect(page.locator('.skeleton-stack')).toHaveCount(0)
  const viewport=page.locator('.schedule-v2-timeline')
  if(sample.mode==='gesture-reschedule'){
   const target=fixture.initialWorkouts[0]!,card=page.locator(`[data-workout-id="${target.id}"]`)
   await expect(card).toBeVisible()
   await card.evaluate(node=>node.scrollIntoView({block:'center'}))
   // A native before-capture supplies fonts/media/layout readiness. The hold
   // itself still waits for the actual product drag class, not a fixed sleep.
   await probe('reschedule-grid')
   const hold=await beginClientGesture(page,card,browserName,card.locator('b'))
   await expect(card).toHaveClass(/is-slot-moving/)
   await hold.move(0,28);await hold.end()
   const sheet=page.getByRole('dialog',{name:'Дата и время',exact:true})
   await expect(sheet).toBeVisible();await expect(sheet.getByLabel('Начало',{exact:true})).toHaveValue('13:00');await expect(sheet.getByLabel('Окончание',{exact:true})).toHaveValue('14:00')
   await expect(sheet.getByRole('button',{name:/^Перенести(?: всё равно)?$/})).toBeEnabled()
   await probe('reschedule-ready')
   await sheet.getByRole('button',{name:'Выбрать дату',exact:true}).click()
   const calendar=page.locator('.fit-lime-date-picker[open]');await expect(calendar).toBeVisible();await probe('reschedule-date')
   await calendar.getByRole('button',{name:'Закрыть календарь',exact:true}).click()
   await sheet.getByRole('button',{name:'Отмена',exact:true}).click();await expect(sheet).toHaveCount(0)
   await expect(card).not.toHaveClass(/is-slot-moving/);await expect(page).toHaveURL(new RegExp('date='+homeToday))
  }else if(sample.mode==='gesture-booking'){
   await expect(page.locator('.schedule-v2')).toHaveClass(/schedule-density-compact/)
   await scrollDayForBooking(viewport)
   const point=await viewport.locator('.day-grid').evaluate(element=>{const box=element.getBoundingClientRect();return{x:box.left+140,y:box.top+element.clientHeight/24*14+2}})
   await page.touchscreen.tap(point.x,point.y)
   const booking=page.getByRole('dialog',{name:'Записать клиента',exact:true})
   await expect(booking).toBeVisible();await expect(booking).toContainText('14:00');await expect(booking.locator('input:focus')).toHaveCount(0);await probe('booking-empty')
   await booking.getByRole('button',{name:'Выбрать клиента',exact:true}).click()
   const picker=page.getByRole('dialog',{name:'Выбор клиента',exact:true});await expect(picker).toBeVisible();await probe('booking-client-picker')
   await picker.locator(`[data-client-id="${clientId}"]`).click();await picker.getByRole('button',{name:'Применить клиента',exact:true}).click()
   await expect(booking).toContainText('Алексей Смирнов');await booking.getByRole('button',{name:'Онлайн',exact:true}).click();await expect(booking.getByRole('button',{name:'Онлайн',exact:true})).toHaveAttribute('aria-pressed','true')
   await booking.getByRole('button',{name:'Выбрать дату и время',exact:true}).click();const calendar=page.locator('.fit-lime-date-picker[open]');await expect(calendar).toBeVisible();await expect(calendar.getByLabel('Начало',{exact:true})).toHaveValue('14:00');await probe('booking-date-time')
   await calendar.getByRole('button',{name:'Закрыть календарь',exact:true}).click();await booking.getByRole('button',{name:'Закрыть запись',exact:true}).click();await expect(booking).toHaveCount(0)
  }else{
   const trigger=page.getByRole('button',{name:/Незавершённые действия/});await trigger.click()
   const queue=page.getByRole('dialog',{name:'Рабочая очередь',exact:true}),row=queue.locator('.schedule-v2-planning-row')
   await expect(row).toHaveCount(1);await expect(row).toContainText('Тренировки ещё не добавлены')
   await row.getByRole('button',{name:'Напомнить через 2 недели',exact:true}).click();await expect.poll(()=>held).toBe(1)
   await expect(row.getByRole('button',{name:'Сохраняем…',exact:true})).toBeDisabled();await probe('snooze-pending')
   release();await expect(queue.getByRole('alert')).toHaveText('Не удалось отложить напоминание. Попробуйте ещё раз.');await expect(row.getByRole('button',{name:'Напомнить через 2 недели',exact:true})).toBeEnabled();await probe('snooze-error')
   await queue.getByRole('button',{name:'Закрыть рабочую очередь',exact:true}).click();await expect(trigger).toBeFocused()
   expect(commands).toEqual([{method:'POST',path:snoozePath,body:{}}])
  }
  expect(fixture.unchanged()).toBe(true);expect(fixture.writes).toEqual([]);expect(fixture.diagnostics.errors).toEqual([]);expect(fixture.diagnostics.failed).toEqual([])
  expect(fixture.diagnostics.responses).toEqual(sample.mode==='queue-snooze-error'?[{method:'POST',path:snoozePath,status:503}]:[])
  const preferences=await page.evaluate(()=>Object.fromEntries(Object.entries(localStorage).filter(([key])=>/^fit\.(?:workout-form-draft|today-draft|client-today-drafts|schedule|independent|appTheme|clientLime\.theme)/.test(key))))
  await writeFile(info.outputPath('home-skin.json'),JSON.stringify({sample,route,date:homeToday,actor:fixture.actor,initialWorkouts:fixture.initialWorkouts,finalWorkouts:fixture.workouts(),unchangedWorkoutHistory:fixture.unchanged(),reads:fixture.reads,writes:commands,diagnostics:fixture.diagnostics,preferences,states}))
  for(const state of states)if(process.env.FIT_HOME_SKIN_BASELINE==='1'){
   expect(state.owners).toEqual([]);expect(state.matches.length+state.ancestorMatches.length+state.pseudoMatches.length).toBeGreaterThan(0)
  }else assertEditorOwnership(state,true,homeContract)
 })
}
