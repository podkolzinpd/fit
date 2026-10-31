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
    await expect(page.getByRole('button',{name:'Отметить проведённой',exact:true})).toHaveCount(0)
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

  for(const density of ['original','compact'] as const) test(`empty trainer Live confirms attendance in ${density} without changing its renderer`,async({page},info)=>{
    await page.addInitScript(({id,density})=>localStorage.setItem(`fit.coachLiveDensity.${id}`,density),{id:profileId,density})
    const backend=await mockPilot(page,{profileId,fitLime:true,workouts:[{...restTimerWorkout(),createdBy:profileId,startTime:'10:10',exercises:[]}]})
    const calls: unknown[]=[]
    await page.route(`**/v1/workouts/${workoutId}/finish`,async route=>{
      calls.push(route.request().postDataJSON())
      Object.assign(backend.getWorkouts()[0]!,{status:'done',version:2,completedAt:'2026-10-31T10:00:00Z'})
      await route.fulfill({json:{workout:{version:2,replayed:false}}})
    })
    await page.goto(`/workouts/${workoutId}/live`)
    await expect(page.locator(`.coach-live-density-${density}`)).toBeVisible()
    await expect(page.getByRole('button',{name:'Удалить тренировку',exact:true})).toBeVisible()
    await page.locator('.workout-attendance-finish').click()
    const sheet=page.getByRole('dialog',{name:'Отметить проведённой',exact:true})
    await expect(sheet).toBeVisible()
    await page.screenshot({path:info.outputPath(`empty-${density}.png`)})
    await sheet.getByRole('button',{name:'Отмена',exact:true}).click()
    expect(calls).toHaveLength(0)
    await expect(page).toHaveURL(new RegExp(`/workouts/${workoutId}/live`))
    await page.locator('.workout-attendance-finish').click()
    await page.getByRole('dialog').getByRole('button',{name:'Подтвердить проведение',exact:true}).click()
    await expect(page).toHaveURL(new RegExp(`/workouts/${workoutId}$`))
    expect(calls).toHaveLength(1)
    await expect(page.locator('.workout-header-contract')).toContainText('10:10')
  })
}
