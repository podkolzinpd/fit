import {expect,test} from '@playwright/test'
import {writeFile} from 'node:fs/promises'
import {prepareHomeSkin,homeToday,homeWeek,homeLongExerciseName,type HomeSkinSample} from './lime-home-skin.fixture'
import {probeEditorSkin,assertEditorOwnership} from './lime-editor-skin.probe'
import {homeContract} from './lime-home-skin.contract'
import {clientId} from './fit-lime-fixtures'

const samples:readonly HomeSkinSample[]=[
 {role:'client',theme:'light',width:390,mode:'home',lime:true},
 {role:'client',theme:'dark',width:430,mode:'home',lime:true},
 {role:'client',theme:'light',width:1440,mode:'home',lime:true},
 {role:'client',theme:'dark',width:375,mode:'long',lime:true},
 {role:'client',theme:'light',width:375,mode:'empty',lime:true},
 {role:'client',theme:'dark',width:390,mode:'first',lime:true},
 {role:'client',theme:'dark',width:390,mode:'loading',lime:true},
 {role:'client',theme:'light',width:430,mode:'error',lime:true},
 {role:'client',theme:'light',width:390,mode:'active',lime:true},
 {role:'client',theme:'dark',width:430,mode:'past',lime:true},
 {role:'client',theme:'light',width:430,mode:'future',lime:true},
 {role:'client',theme:'light',width:390,mode:'draft',lime:true},
 {role:'client',theme:'dark',width:390,mode:'text',lime:true},
 {role:'client',theme:'light',width:430,mode:'links',lime:true},
 {role:'client',theme:'light',width:390,mode:'preset',lime:true},
 {role:'client',theme:'dark',width:375,mode:'home',lime:true,reference:false},
 {role:'client',theme:'dark',width:390,mode:'home',lime:false},
 {role:'trainer',theme:'light',width:390,mode:'day',lime:true},
 {role:'trainer',theme:'dark',width:430,mode:'day',lime:true},
 {role:'trainer',theme:'dark',width:375,mode:'day',lime:true,density:'compact'},
 {role:'trainer',theme:'light',width:1440,mode:'day',lime:true},
 {role:'trainer',theme:'light',width:430,mode:'long',lime:true},
 {role:'trainer',theme:'dark',width:430,mode:'statuses',lime:true},
 {role:'trainer',theme:'light',width:390,mode:'week',lime:true},
 {role:'trainer',theme:'dark',width:1440,mode:'week',lime:true},
 {role:'trainer',theme:'dark',width:430,mode:'fortnight',lime:true},
 {role:'trainer',theme:'light',width:390,mode:'list',lime:true},
 {role:'trainer',theme:'dark',width:430,mode:'filters',lime:true},
 {role:'trainer',theme:'dark',width:375,mode:'date',lime:true},
 {role:'trainer',theme:'light',width:390,mode:'menu',lime:true},
 {role:'trainer',theme:'light',width:390,mode:'queue',lime:true},
 {role:'trainer',theme:'dark',width:430,mode:'queue-error',lime:true},
 {role:'trainer',theme:'dark',width:390,mode:'inbox',lime:true},
 {role:'trainer',theme:'light',width:430,mode:'inbox-error',lime:true},
 {role:'trainer',theme:'light',width:390,mode:'entry',lime:true},
 {role:'trainer',theme:'dark',width:430,mode:'plan',lime:true},
 {role:'trainer',theme:'light',width:390,mode:'loading',lime:true},
 {role:'trainer',theme:'dark',width:430,mode:'error',lime:true},
 {role:'trainer',theme:'light',width:375,mode:'empty',lime:true},
 {role:'trainer',theme:'dark',width:390,mode:'day',lime:false},
 {role:'trainer',theme:'dark',width:390,mode:'v1',lime:false},
 {role:'trainer',theme:'dark',width:430,mode:'classic',lime:true},
]

export function limeHomeSkinCases(){
 for(const sample of samples)test(`Home Lime skin ownership ${sample.role}-${sample.theme}-${sample.width}-${sample.mode}-${sample.lime}-${sample.density??'comfortable'}-${sample.reference!==false}`,async({page},info)=>{
  const fixture=await prepareHomeSkin(page,sample)
  const overview=['week','fortnight','list','filters'].includes(sample.mode)
  const route=sample.role==='client'?'/me':sample.mode==='v1'?`/schedule?date=${homeToday}`:sample.mode==='classic'?'/today?classic=1':sample.mode==='statuses'?`/today?date=2026-11-13&week=${homeWeek}`:overview?`/schedule?week=${homeWeek}${sample.mode==='fortnight'?'&range=2w':sample.mode==='list'?'&mode=list':''}`:`/today?date=${homeToday}`
  const states:(Awaited<ReturnType<typeof probeEditorSkin>>&{state:string;url:string;consumer:boolean})[]=[]
  const probe=async(state:string)=>{
   await page.mouse.move(0,0)
   const consumer=await page.locator('.phone-frame').evaluate(root=>root.matches('.fit-client-lime.client-home-identity,.fit-lime-shell.trainer-schedule-v2-shell'))
   states.push({...await probeEditorSkin(page,info.outputPath('home-'+state+'.png'),homeContract.selector,homeContract),state,url:new URL(page.url()).pathname+new URL(page.url()).search+new URL(page.url()).hash,consumer})
  }
  const ready=async()=>{
   if(sample.role==='client'){
    if(sample.mode==='first'){await expect(page.locator('.client-home-page')).toBeVisible();await expect(page.locator('.client-home-overview')).toHaveCount(0)}
    else{await expect(page.locator('.client-home-overview')).toBeVisible();await expect(page.getByRole('region',{name:'Тренировка сейчас'}).locator('button.quick-start-button')).toBeEnabled();await expect(page.locator('.client-home-week').getByRole('heading',{name:'1 из 2 по плану',exact:true})).toBeVisible()}
    if(sample.lime){await expect(page.locator('.phone-frame')).toHaveClass(/fit-client-lime/);await expect(page.locator('.phone-frame')).toHaveClass(/client-home-identity/)}
    else await expect(page.locator('.phone-frame')).not.toHaveClass(/fit-client-lime/)
    if(sample.lime&&sample.reference!==false&&sample.mode!=='first')await expect(page.locator('.client-screen-reference')).toBeVisible()
   }else if(sample.mode==='classic')await expect(page.locator('.today-composer')).toBeVisible()
   else{
    await expect(page.locator('.schedule-page')).toBeVisible();await expect(page.locator('.skeleton-stack')).toHaveCount(0)
    if(sample.mode==='v1')await expect(page.locator('.phone-frame')).not.toHaveClass(/trainer-schedule-v2-shell/)
    else await expect(page.locator('.phone-frame')).toHaveClass(/trainer-schedule-v2-shell/)
    if(sample.lime&&sample.mode!=='v1')await expect(page.locator('.phone-frame')).toHaveClass(/fit-lime-shell/)
    if(overview&&sample.lime){await expect(page).toHaveURL(/\/today\?/);await expect(page.getByRole('group',{name:'Вид расписания'})).toBeVisible()}
   }
  }
  await page.goto(route)
  if(sample.mode==='loading'){
   await expect.poll(()=>fixture.held()).toBeGreaterThan(0)
   if(sample.role==='client')await expect(page.locator('.client-home-loading').first()).toBeVisible()
   else await expect(page.getByRole('status',{name:'Загрузка',exact:true})).toBeVisible()
   await probe('loading');fixture.release();await ready();await probe('loaded')
  }else if(sample.mode==='error'){
   await expect(page.getByRole('alert').first()).toBeVisible();await probe('load-error');fixture.recover();await page.getByRole('button',{name:'Повторить',exact:true}).first().click();await ready();await probe('load-recovered')
  }else{
   await ready()
   if(sample.role==='client'){
    if(sample.mode==='draft'){
     const draft=page.getByRole('region',{name:'Черновик плана'});await expect(draft).toContainText('Приседания');await probe('draft-home');await draft.getByRole('button',{name:'Продолжить черновик',exact:true}).click();await expect(page).toHaveURL(/draft=mc55-retained/);await expect(page.locator('.today-text-fallback textarea')).toHaveValue('Приседания 3 по 10, 60 кг');await probe('draft-restored')
    }else if(sample.mode==='text'){
     await page.getByRole('button',{name:'Ввести текстом',exact:true}).click();const text=page.locator('.today-text-fallback textarea');await expect(text).toBeVisible();await text.pressSequentially('Приседания 3 по 10, 60 кг');await expect(text).toHaveValue('Приседания 3 по 10, 60 кг');await probe('text-input');await page.getByRole('button',{name:'Скрыть',exact:true}).click();await expect(page.locator('.client-home-overview')).toBeVisible();await probe('text-hidden')
    }else if(sample.mode==='preset'){
     await page.getByRole('button',{name:'Выбрать готовый план',exact:true}).click();await expect(page.getByRole('region',{name:'Готовые тренировки'})).toBeVisible();await expect(page.locator('.preset-workout-card')).not.toHaveCount(0);await probe('first-run-presets')
    }else if(sample.mode==='active'){
     const button=page.getByRole('region',{name:'Тренировка сейчас'}).getByRole('button',{name:'Продолжить тренировку',exact:true});await expect(button).toBeVisible();await probe('active-home');await button.click();await expect(page.locator('.live-workout-page')).toBeVisible();await page.goBack();await ready();await expect(button).toBeVisible();await probe('active-returned')
    }else if(sample.mode==='future'){
     const next=page.locator('.client-home-next.compact');await expect(next.getByRole('heading',{name:'Следующая тренировка',exact:true})).toBeVisible();await expect(next.locator('strong')).toHaveText('3 упражнения · Приседания, Жим и ещё 1');await expect(next.locator('.client-home-next-link')).toHaveAttribute('href',`/workouts/${fixture.initialWorkouts[0]!.id}`);await probe('future-compact')
    }else if(sample.mode==='links'){
     const link=page.locator('.client-home-next-link,.client-home-next .button').first();await expect(link).toHaveAttribute('href',/^\/workouts\//);await probe('assigned-home');await link.click();await expect(page.locator('.workout-detail-page')).toBeVisible();await page.goBack();await ready();await probe('assigned-returned')
    }else{if(sample.mode==='past')await expect(page.locator('.client-home-past-plan')).toBeVisible();if(sample.mode==='long')await expect(page.locator('.client-home-next-exercises')).toHaveText(`3 упражнения · ${homeLongExerciseName}, Жим и ещё 1`);await probe(sample.mode)}
   }else if(sample.mode==='statuses'){
    const done=page.locator('.schedule-v2-event.schedule-event-done'),decision=page.locator('.schedule-v2-event.schedule-event-decision'),skipped=page.locator('.schedule-v2-event.schedule-event-skipped');await expect(done).toHaveCount(1);await expect(done).toHaveAttribute('aria-label','10:00–11:00 Алексей Смирнов · Проведена');await expect(decision).toHaveCount(1);await expect(decision).toHaveAttribute('aria-label','12:00–13:00 Алексей Смирнов · План');await expect(skipped).toHaveCount(1);await expect(skipped).toHaveAttribute('aria-label','15:00–16:00 Алексей Смирнов · Не состоялась');await expect(page.locator('.schedule-event-self-led')).toHaveCount(0);await probe('past-day-statuses')
    await page.getByRole('group',{name:'Вид расписания'}).getByRole('button',{name:'Неделя',exact:true}).click();await page.locator('.coach-schedule-filter-options > summary').click();const independent=page.getByRole('checkbox',{name:'Показывать самостоятельные тренировки'});await independent.check();await expect(independent).toBeChecked();await page.locator('.coach-schedule-filter-options > summary').click();await expect(page.locator('.schedule-independent-label')).toHaveCount(1);await expect(page.locator('.schedule-independent-label')).toHaveText('Самостоятельно');await expect(page.locator('.schedule-event-self-led')).toHaveCount(0);await probe('week-independent-status')
   }else if(sample.mode==='filters'){
    const summary=page.locator('.coach-schedule-filter-options > summary');await summary.click();const client=page.getByLabel('Фильтр по клиенту',{exact:true}),status=page.getByLabel('Фильтр по статусу',{exact:true});await client.selectOption(clientId);await status.selectOption('planned');const independent=page.getByRole('checkbox',{name:'Показывать самостоятельные тренировки'});await independent.check();await expect(client).toHaveValue(clientId);await expect(status).toHaveValue('planned');await probe('filters-selected');await summary.click();await summary.click();await expect(independent).toBeChecked();await probe('filters-reopened');await page.reload();await ready();await summary.click();await expect(client).toHaveValue(clientId);await expect(status).toHaveValue('planned');await expect(independent).toBeChecked()
   }else if(sample.mode==='date'){
    await page.getByRole('button',{name:'Открыть календарь по дате',exact:true}).click();const dialog=page.locator('dialog.fit-lime-date-picker');await expect(dialog).toBeVisible();const chosen=dialog.getByRole('button',{name:'15 ноября 2026 г.',exact:true});await chosen.click();await expect(chosen).toHaveAttribute('aria-pressed','true');await probe('date-selected');await dialog.getByRole('button',{name:'Закрыть календарь'}).click();await expect(page).toHaveURL(new RegExp('date='+homeToday));await page.getByRole('button',{name:'Открыть календарь по дате',exact:true}).click();await chosen.click();await dialog.getByRole('button',{name:'Применить дату'}).click();await expect(page).toHaveURL(/date=2026-11-15/);await probe('date-applied')
   }else if(sample.mode==='menu'){
    const trigger=page.getByRole('button',{name:'Настройки расписания',exact:true});await trigger.click();await expect(page.getByRole('menu')).toBeVisible();await expect(page.getByRole('menuitem',{name:'Компактная сетка',exact:true})).toBeVisible();await probe('settings-menu');await page.keyboard.press('Escape');await expect(page.getByRole('menu')).toHaveCount(0);await probe('settings-closed')
   }else if(sample.mode.startsWith('queue')||sample.mode.startsWith('inbox')){
    const inbox=sample.mode.startsWith('inbox'),trigger=page.getByRole('button',{name:inbox?/Вопросы и сообщения/:/Незавершённые действия/}),dialog=page.getByRole('dialog',{name:inbox?'Входящие':'Рабочая очередь',exact:true});await trigger.click();await expect(dialog).toBeVisible()
    if(sample.mode.endsWith('-error')){await expect(dialog.getByRole('alert').first()).toBeVisible();await probe(sample.mode);fixture.recover();await dialog.getByRole('button',{name:inbox?'Повторить загрузку вопросов':'Повторить загрузку действий',exact:true}).click();await expect(dialog.getByRole('alert')).toHaveCount(0)}
    if(inbox)await expect(dialog.getByText('Можно заменить приседания?',{exact:true})).toBeVisible()
    await probe(inbox?'inbox-content':'queue-content');await dialog.getByRole('button',{name:inbox?'Закрыть входящие':'Закрыть рабочую очередь',exact:true}).click();await expect(dialog).toHaveCount(0);await expect(trigger).toBeFocused();await probe('sheet-closed')
   }else if(sample.mode==='entry'||sample.mode==='plan'){
    await page.getByRole('button',{name:'Новая тренировка',exact:true}).click();const entry=page.getByRole('dialog',{name:'Новая тренировка',exact:true});await expect(entry).toBeVisible();await probe('entry-choices')
    if(sample.mode==='entry'){
     await entry.getByRole('button',{name:'Начать сейчас',exact:true}).click();const picker=page.getByRole('dialog',{name:'Выбор клиента',exact:true});await expect(picker).toBeVisible();await probe('start-client-picker');await picker.getByRole('button',{name:'Закрыть',exact:true}).click();await expect(entry.getByRole('button',{name:'Запланировать',exact:true})).toBeVisible();await entry.getByRole('button',{name:'Закрыть выбор действия',exact:true}).click()
    }else{
     await entry.getByRole('button',{name:'Запланировать',exact:true}).click();const plan=page.getByRole('dialog',{name:'Быстрое создание тренировки',exact:true});await expect(plan).toBeVisible();const title=plan.getByRole('textbox',{name:'Название тренировки',exact:true});await title.pressSequentially('Сохраняемый черновик MC55');await expect(title).toHaveValue('Сохраняемый черновик MC55');await probe('plan-input');await plan.getByRole('button',{name:/^Клиент:/}).click();const picker=page.getByRole('dialog',{name:'Выбор клиента',exact:true});await expect(picker).toBeVisible();await probe('plan-client-picker');await picker.getByRole('button',{name:'Закрыть',exact:true}).click();await expect(title).toHaveValue('Сохраняемый черновик MC55');await plan.getByRole('button',{name:'Закрыть создание',exact:true}).click()
    }
    await expect(page.locator('.schedule-v2')).toBeVisible()
   }else{
    if(sample.mode==='day'){await expect(page.locator('.schedule-v2-event')).not.toHaveCount(0);await expect(page.locator('.schedule-v2-untimed')).toBeVisible();await expect(page.locator('.schedule-v2-now')).toBeVisible();if(sample.density==='compact')await expect(page.locator('.schedule-v2')).toHaveClass(/schedule-density-compact/)}
    if(sample.mode==='list')await expect(page.locator('.fit-lime-history-row')).not.toHaveCount(0)
    if(sample.mode==='fortnight')await expect(page.locator('.coach-fortnight-view')).toBeVisible()
    await probe(sample.mode)
   }
  }
  expect(states.length).toBeGreaterThan(0);expect(fixture.unchanged()).toBe(true);fixture.assertDiagnostics()
  const preferences=await page.evaluate(()=>Object.fromEntries(Object.entries(localStorage).filter(([key])=>/^fit\.(?:today-draft|client-today-drafts|schedule|independent|appTheme|clientLime\.theme)/.test(key))))
  await writeFile(info.outputPath('home-skin.json'),JSON.stringify({sample,route,date:homeToday,actor:fixture.actor,initialWorkouts:fixture.initialWorkouts,finalWorkouts:fixture.workouts(),unchangedWorkoutHistory:fixture.unchanged(),reads:fixture.reads,writes:fixture.writes,diagnostics:fixture.diagnostics,preferences,states}))
  for(const state of states){
   if(!state.consumer){if(!sample.lime||sample.mode==='v1')assertEditorOwnership(state,false,homeContract);else expect(state.owners).toEqual([]);continue}
   if(process.env.FIT_HOME_SKIN_BASELINE==='1'){
    expect(state.owners).toEqual([]);expect(state.matches.length+state.ancestorMatches.length+state.pseudoMatches.length).toBeGreaterThan(0)
   }else assertEditorOwnership(state,true,homeContract)
  }
 }
 )
}
