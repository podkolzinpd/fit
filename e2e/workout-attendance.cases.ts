import { expect, test } from '@playwright/test'
import { clientId, mockPilot, restTimerWorkout, workoutId } from './fit-lime-fixtures'
import type { WorkoutAttendanceDraft } from '../src/shared/domain'

const profileId = 'c0ac0000-6010-4000-8000-000000000001'
export function workoutAttendanceCases() {
  test.skip(process.env.FIT_YANDEX_E2E_REQUIRED !== 'true', 'Native attendance is verified in the mandatory Yandex production-build lane')
  test('attendance preserves the appointment, confirms once and offers later results', async ({ page }, info) => {
    await page.clock.setFixedTime(new Date('2026-10-31T09:00:00Z'))
    const target = { ...restTimerWorkout(), title:'Посещение без упражнений',createdBy:profileId,status:'planned' as const,
      workoutDate:'2026-10-31',startTime:'10:00',startedAt:null,trainingFormat:'with_trainer' as const,exercises:[] }
    const backend=await mockPilot(page,{profileId,fitLime:true,workouts:[target]})
    const commands: Array<{expectedVersion:number;operationId:string;attendance:WorkoutAttendanceDraft}> = []
    await page.route(`**/v1/workouts/${workoutId}/finish`,async route=>{
      const command=route.request().postDataJSON() as typeof commands[number]
      commands.push(command)
      expect(command.attendance).toEqual({disposition:'auto',packageId:null})
      Object.assign(backend.getWorkouts()[0]!,{status:'done',version:target.version+1,completedAt:'2026-10-31T09:00:00Z'})
      await route.fulfill({json:{workout:{version:target.version+1,replayed:false}}})
    })
    await page.goto(`/workouts/${workoutId}`)
    await page.getByRole('button',{name:'Отметить проведённой',exact:true}).click()
    const sheet=page.getByRole('dialog',{name:'Отметить проведённой',exact:true})
    await expect(sheet.getByText('Нет подходящего абонемента',{exact:true})).toBeVisible()
    await page.screenshot({path:info.outputPath('attendance-confirm.png')})
    await sheet.getByRole('button',{name:'Подтвердить проведение',exact:true}).click()
    await expect(sheet).toHaveCount(0)
    await expect(page.getByText('Проведена',{exact:true})).toBeVisible()
    await expect(page.getByText('Упражнения не записаны',{exact:true})).toBeVisible()
    await expect(page.getByRole('link',{name:'Добавить результат',exact:true})).toBeVisible()
    expect(commands).toHaveLength(1)
    expect(backend.getWorkouts()).toHaveLength(1)
    expect(backend.getWorkouts()[0]).toMatchObject({id:workoutId,startTime:'10:00',title:target.title,clientId})
    await expect(page.locator('.workout-finance-confirmation')).toContainText('Не списано')
    await page.screenshot({path:info.outputPath('attendance-result.png')})
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
    await page.getByRole('link',{name:'Добавить результат',exact:true}).click()
    await expect(page).toHaveURL(new RegExp(`/workouts/${workoutId}/edit$`))
    await expect(page.getByRole('textbox',{name:'Название тренировки',exact:true})).toHaveValue(target.title)
  })

  test('not held cancels the same planned workout without finance or lost exercises', async ({ page },info)=>{
    const target={...restTimerWorkout(),createdBy:profileId,status:'planned' as const,workoutDate:'2026-11-02',startedAt:null,title:'Сохраняем план'}
    const backend=await mockPilot(page,{profileId,fitLime:true,workouts:[target]})
    const exercises=JSON.stringify(target.exercises)
    let calls=0
    await page.route(`**/v1/workouts/${workoutId}/cancel`,async route=>{
      calls++;expect(route.request().postDataJSON()).toEqual({expectedVersion:target.version})
      Object.assign(backend.getWorkouts()[0]!,{status:'cancelled',version:target.version+1})
      await route.fulfill({json:{workout:{version:target.version+1}}})
    })
    await page.goto(`/workouts/${workoutId}`)
    await expect(page.getByRole('button',{name:'Отметить проведённой',exact:true})).toBeVisible()
    await page.getByRole('button',{name:'Не состоялась',exact:true}).click()
    const sheet=page.getByRole('dialog',{name:'Тренировка не состоялась',exact:true})
    await expect(sheet).toContainText('Занятие не спишется')
    await expect(sheet.getByRole('combobox')).toHaveCount(0)
    await page.screenshot({path:info.outputPath('not-held-confirm.png')})
    await sheet.getByRole('button',{name:'Отметить: не состоялась',exact:true}).click()
    await expect(sheet).toHaveCount(0)
    await expect(page.getByRole('button',{name:'Вернуть в план',exact:true})).toBeVisible()
    expect(calls).toBe(1);expect(backend.getWorkouts()).toHaveLength(1)
    expect(JSON.stringify(backend.getWorkouts()[0]!.exercises)).toBe(exercises)
    await page.goto('/schedule?mode=list')
    await expect(page.locator('.fit-lime-history-row')).toContainText('Не состоялась')
  })

  for(const density of ['original','compact'] as const) test(`trainer cancels Live and calendar keeps a cross ${density}`,async({page},info)=>{
    await page.clock.setFixedTime(new Date('2026-10-31T09:00:00Z'))
    await page.addInitScript(({id,density})=>localStorage.setItem(`fit.coachLiveDensity.${id}`,density),{id:profileId,density})
    const target={...restTimerWorkout(),createdBy:profileId,workoutDate:'2026-10-31',startTime:'10:00',executionMode:'manual' as const,pausedAt:'2026-10-31T08:59:00Z'}
    Object.assign(target.exercises[0]!.sets[0]!,{confirmedAt:'2026-10-31T08:58:00Z',fact:{weightKg:15,reps:8}})
    const before=JSON.stringify(target.exercises)
    const done={...target,id:'c0ac0000-6010-4000-8000-000000000099',status:'done' as const,startTime:'12:00',completedAt:'2026-10-31T09:00:00Z'}
    const backend=await mockPilot(page,{profileId,fitLime:true,workouts:[target,done]})
    await page.route(`**/v1/workouts/${workoutId}/cancel`,async route=>{
      Object.assign(backend.getWorkouts()[0]!,{status:'cancelled',version:target.version+1,pausedAt:undefined})
      await route.fulfill({json:{workout:{version:target.version+1}}})
    })
    await page.goto(`/workouts/${workoutId}/live`)
    await page.getByRole('button',{name:'Завершить тренировку',exact:true}).click()
    const sheet=page.getByRole('dialog',{name:'Завершение тренировки',exact:true})
    await sheet.getByRole('radio',{name:'Отметить как несостоявшуюся',exact:true}).check()
    await expect(sheet.getByRole('radio',{name:'Удалить пустую тренировку',exact:true})).toHaveCount(0)
    await expect(sheet.getByRole('region',{name:'Учёт занятия',exact:true})).toHaveCount(0)
    await sheet.getByRole('button',{name:'Подтвердить',exact:true}).click()
    await expect(page).toHaveURL(new RegExp(`/workouts/${workoutId}$`))
    await expect(page.getByRole('button',{name:'Вернуть в план',exact:true})).toBeVisible()
    expect(JSON.stringify(backend.getWorkouts()[0]!.exercises)).toBe(before)
    await page.goto('/today?date=2026-10-31')
    await expect(page.locator('.schedule-v2-event .schedule-cancelled-mark')).toHaveCount(1)
    await expect(page.locator('.schedule-v2-event').filter({has:page.locator('svg') })).toHaveCount(2)
    await page.screenshot({path:info.outputPath(`calendar-cross-day-${density}.png`)})
    await page.goto('/schedule?week=2026-10-26')
    await expect(page.locator('.schedule-v2-day-events .schedule-cancelled-mark')).toHaveCount(1)
    await expect(page.locator('.schedule-v2-day-events .schedule-completed-mark')).toHaveCount(1)
    await page.locator('.schedule-v2-day-events .schedule-cancelled-mark').evaluate(element => element.scrollIntoView({block:'center',behavior:'instant'}))
    await page.screenshot({path:info.outputPath(`calendar-cross-week-${density}.png`)})
  })

  test('history skips empty visits, reaches older exercises and keeps empty visits in client history',async({page})=>{
    const base=restTimerWorkout()
    const target={...base,createdBy:profileId,status:'planned' as const,workoutDate:'2026-11-02',startedAt:null,exercises:[]}
    const empty=Array.from({length:30},(_,index)=>({...base,id:`67500000-0000-4000-8000-${String(100+index).padStart(12,'0')}`,createdBy:profileId,status:'done' as const,workoutDate:'2026-10-31',title:`Посещение без упражнений ${index+1}`,completedAt:'2026-10-31T10:00:00Z',exercises:[]}))
    const source={...base,id:'67500000-0000-4000-8000-000000000300',createdBy:profileId,status:'done' as const,workoutDate:'2026-10-20',title:'План без записанных результатов',completedAt:'2026-10-20T10:00:00Z'}
    await mockPilot(page,{profileId,fitLime:true,workouts:[target,...empty,source]})
    await page.goto(`/workouts/${workoutId}`)
    await page.locator('.booking-history-open').click()
    const sheet=page.getByRole('dialog',{name:'История тренировок клиента'})
    await expect(sheet).toContainText('На загруженной странице нет тренировок с упражнениями')
    await expect(sheet.locator('.booking-history-item')).toHaveCount(0)
    await sheet.getByRole('button',{name:'Показать ещё',exact:true}).click()
    await expect(sheet.locator('.booking-history-item')).toHaveCount(1)
    await expect(sheet.locator('.booking-history-item')).toContainText(source.title)
    await expect(sheet).not.toContainText('Посещение без упражнений')
    await sheet.locator('.booking-history-item').click()
    await expect(sheet.getByRole('button',{name:'Использовать план',exact:true})).toBeEnabled()
    await page.goto(`/clients/${clientId}/workouts`)
    await expect(page.getByText('Посещение без упражнений 1',{exact:true})).toBeVisible()
  })

  test('trainer conducts a historical plan without confirming its sets', async ({ page }) => {
    const target={...restTimerWorkout(),createdBy:profileId,status:'planned' as const,startedAt:null,title:'План из истории'}
    const before=JSON.stringify(target.exercises)
    const backend=await mockPilot(page,{profileId,fitLime:true,workouts:[target]})
    await page.route(`**/v1/workouts/${workoutId}/finish`,async route=>{
      expect((route.request().postDataJSON() as { attendance: WorkoutAttendanceDraft }).attendance).toEqual({disposition:'auto',packageId:null})
      Object.assign(backend.getWorkouts()[0]!,{status:'done',version:2,completedAt:new Date().toISOString()})
      await route.fulfill({json:{workout:{version:2,replayed:false}}})
    })
    await page.goto(`/workouts/${workoutId}`)
    await page.getByRole('button',{name:'Отметить проведённой',exact:true}).click()
    await page.getByRole('dialog',{name:'Отметить проведённой',exact:true}).getByRole('button',{name:'Подтвердить проведение',exact:true}).click()
    await expect(page.locator('.workout-header-contract')).toContainText('Проведена')
    expect(JSON.stringify(backend.getWorkouts()[0]!.exercises)).toBe(before)
    expect(backend.getWorkouts()).toHaveLength(1)
  })
  for(const density of ['original','compact'] as const) test(`trainer finishes a populated Live without ticking each set ${density}`,async({page})=>{
    await page.addInitScript(({id,density})=>localStorage.setItem(`fit.coachLiveDensity.${id}`,density),{id:profileId,density})
    const target={...restTimerWorkout(),createdBy:profileId,executionMode:'manual' as const}
    if(density==='original') Object.assign(target.exercises[0]!.sets[0]!,{confirmedAt:'2026-10-31T09:00:00Z',fact:{weightKg:15,reps:8}})
    const before=JSON.stringify(target.exercises)
    const backend=await mockPilot(page,{profileId,fitLime:true,workouts:[target]})
    let attempts=0
    await page.route(`**/v1/workouts/${workoutId}/finish`,async route=>{
      attempts++;if(density==='original'&&attempts===1){await route.fulfill({status:503,json:{error:'service_unavailable'}});return}
      expect((route.request().postDataJSON() as { attendance: WorkoutAttendanceDraft }).attendance).toEqual({disposition:'auto',packageId:null})
      Object.assign(backend.getWorkouts()[0]!,{status:'done',version:2,completedAt:new Date().toISOString()})
      await route.fulfill({json:{workout:{version:2,replayed:false}}})
    })
    await page.goto(`/workouts/${workoutId}/live`)
    await expect(page.locator(`.coach-live-density-${density}`)).toBeVisible()
    await page.getByRole('button',{name:'Завершить тренировку',exact:true}).first().click()
    const sheet=page.getByRole('dialog',{name:'Завершение тренировки',exact:true})
    await expect(sheet.getByRole('radio',{name:'Удалить пустую тренировку',exact:true})).toHaveCount(0)
    await sheet.getByRole('button',{name:'Подтвердить',exact:true}).click()
    if(density==='original'){
      await expect(sheet.getByRole('alert')).toBeVisible()
      expect(JSON.stringify(backend.getWorkouts()[0]!.exercises)).toBe(before)
      await sheet.getByRole('button',{name:'Обновить запись',exact:true}).click()
      await sheet.getByRole('button',{name:'Подтвердить',exact:true}).click()
    }
    await expect(page).toHaveURL(new RegExp(`/workouts/${workoutId}$`))
    await expect(page.locator('.workout-header-contract')).toContainText('Проведена')
    expect(JSON.stringify(backend.getWorkouts()[0]!.exercises)).toBe(before)
  })
  test('quick plan creation enters the same attendance confirmation with one saved appointment',async({page})=>{
    const backend=await mockPilot(page,{profileId,fitLime:true,workouts:[]})
    await page.goto('/today?date=2026-10-31')
    await page.locator('.schedule-v2-fab').click()
    await page.getByRole('button',{name:'Запланировать',exact:true}).click()
    const form=page.getByRole('dialog',{name:'Быстрое создание тренировки',exact:true})
    await form.getByRole('button',{name:'Клиент: Выберите клиента',exact:true}).click()
    await page.getByRole('button',{name:/Алексей Смирнов/}).last().click()
    await page.getByRole('button',{name:'Применить клиента',exact:true}).click()
    await form.getByRole('button',{name:'Отметить проведённой',exact:true}).click()
    const sheet=page.getByRole('dialog',{name:'Отметить проведённой',exact:true})
    await expect(sheet).toBeVisible()
    expect(backend.getWorkouts()).toHaveLength(1)
    await sheet.getByRole('button',{name:'Отмена',exact:true}).click()
    expect(backend.getWorkouts()[0]!.status).toBe('planned')
  })

  for(const density of ['original','compact'] as const) test(`empty trainer Live confirms attendance in ${density} without changing its renderer`,async({page},info)=>{
    // Pair the second density with light to check both theme tokens without a full product matrix.
    await page.addInitScript(({id,density})=>{localStorage.setItem(`fit.coachLiveDensity.${id}`,density);localStorage.setItem('fit.appTheme',density==='compact'?'light':'dark')},{id:profileId,density})
    const backend=await mockPilot(page,{profileId,fitLime:true,workouts:[{...restTimerWorkout(),createdBy:profileId,startTime:'10:10',exercises:[]}]})
    const calls: unknown[]=[]
    await page.route(`**/v1/workouts/${workoutId}/finish`,async route=>{
      calls.push(route.request().postDataJSON())
      Object.assign(backend.getWorkouts()[0]!,{status:'done',version:2,completedAt:'2026-10-31T10:00:00Z'})
      await route.fulfill({json:{workout:{version:2,replayed:false}}})
    })
    await page.goto(`/workouts/${workoutId}/live`)
    await expect(page.locator(`.coach-live-density-${density}`)).toBeVisible()
    await expect(page.getByRole('button',{name:'Удалить тренировку',exact:true})).toHaveCount(0)
    await expect(page.locator('.workout-attendance-finish, .live-empty-delete, .live-bottom-bar')).toHaveCount(0)
    await expect(page.getByText('Добавьте первое упражнение',{exact:true})).toHaveCount(0)
    await expect(page.getByRole('button',{name:'Действия с тренировкой',exact:true})).toHaveCount(0)
    await expect(page.locator('.brand')).toBeVisible()
    const centered=await page.locator('.live-session-header').evaluate(el=>{const box=el.getBoundingClientRect();const title=el.querySelector('h2')!.getBoundingClientRect();return Math.abs(title.left+title.width/2-(box.left+box.width/2))});expect(centered).toBeLessThan(1)
    await page.getByRole('button',{name:'Завершить тренировку',exact:true}).click()
    const sheet=page.getByRole('dialog',{name:'Завершение тренировки',exact:true})
    await expect(sheet).toBeVisible()
    await page.screenshot({path:info.outputPath(`empty-${density}.png`)})
    await expect(sheet.getByRole('radio')).toHaveCount(3)
    await expect(sheet.getByRole('radio',{name:'Завершить тренировку',exact:true})).toBeChecked()
    await expect(sheet.getByRole('radio',{name:'Отметить как несостоявшуюся',exact:true})).toBeVisible()
    await expect(sheet.getByRole('radio',{name:'Удалить пустую тренировку',exact:true})).toBeVisible()
    expect(await sheet.evaluate(el=>getComputedStyle(el).fontFamily.replace(/[\s'"]/g,''))).toBe(await page.locator('.phone-frame').evaluate(el=>getComputedStyle(el).getPropertyValue('--lime-font').replace(/[\s'"]/g,'')))
    await expect(sheet.locator('.workout-attendance-note')).toHaveCount(0)
    await sheet.getByRole('button',{name:'Продолжить тренировку',exact:true}).click()
    expect(calls).toHaveLength(0)
    await expect(page).toHaveURL(new RegExp(`/workouts/${workoutId}/live`))
    await page.getByRole('button',{name:'Завершить тренировку',exact:true}).click()
    await page.getByRole('dialog',{name:'Завершение тренировки',exact:true}).getByRole('button',{name:'Подтвердить',exact:true}).click()
    await expect(page).toHaveURL(new RegExp(`/workouts/${workoutId}$`))
    expect(calls).toHaveLength(1)
    await expect(page.locator('.workout-header-contract')).toContainText('10:10')
  })

  test('trainer Live deletes only its empty record with reload and no duplicate command',async({page})=>{
    const target={...restTimerWorkout(),createdBy:profileId,exercises:[]}
    const backend=await mockPilot(page,{profileId,fitLime:true,workouts:[target]})
    let deletes=0,finishes=0,cancels=0
    let release: (()=>void)|undefined
    const pending=new Promise<void>(resolve=>{release=resolve})
    page.on('request',request=>{if(request.method()!=='POST')return;const path=new URL(request.url()).pathname;if(path.endsWith('/finish'))finishes++;if(path.endsWith('/cancel'))cancels++})
    await page.route(`**/v1/workouts/${workoutId}/cancel-empty`,async route=>{
      deletes++;expect(route.request().postDataJSON()).toEqual({expectedVersion:target.version})
      if(deletes===1){await route.fulfill({status:503,json:{error:'unavailable'}});return}
      await pending;backend.getWorkouts().splice(0,1);await route.fulfill({json:{workout:{version:target.version+1}}})
    })
    await page.goto(`/workouts/${workoutId}/live`)
    await page.getByRole('button',{name:'Завершить тренировку',exact:true}).click()
    const sheet=page.getByRole('dialog',{name:'Завершение тренировки',exact:true})
    await sheet.getByRole('radio',{name:'Удалить пустую тренировку',exact:true}).check()
    await expect(sheet.getByRole('region',{name:'Учёт занятия',exact:true})).toHaveCount(0)
    await sheet.getByRole('button',{name:'Подтвердить',exact:true}).click()
    await expect(sheet.getByRole('alert')).toBeVisible()
    expect(backend.getWorkouts()).toHaveLength(1)
    await sheet.getByRole('button',{name:'Обновить запись',exact:true}).click()
    await expect(sheet.getByRole('button',{name:'Подтвердить',exact:true})).toBeEnabled()
    await sheet.getByRole('button',{name:'Подтвердить',exact:true}).evaluate(button=>{(button as HTMLButtonElement).click();(button as HTMLButtonElement).click()})
    await expect(sheet.getByRole('button',{name:'Сохраняем…',exact:true})).toBeDisabled()
    expect(deletes).toBe(2);release!()
    await expect(page).toHaveURL(/\/today(?:\?|$)/)
    expect(backend.getWorkouts()).toHaveLength(0)
    expect(finishes).toBe(0);expect(cancels).toBe(0)
  })
}
