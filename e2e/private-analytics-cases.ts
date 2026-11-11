import { expect, test } from '@playwright/test'
import { mockNativeAiSession, nativeAiUrl } from './native-ai-fixture'

const base={retentionMeasured:false,revision:'synthetic',computedAt:'2026-11-07T09:00:00Z',observationStartedAt:'2026-11-07T00:00:00Z',total:2,
  summary:{previousNew:1,previousActive:1,previousWorkouts:8,previousReceived:8000,accounts:2,new:1,active:2,offline:3,workouts:12,nutritionUsers:1,nutritionDays:4,nutritionViews:1,received:12000,opening:1000,due:4000,overdue:2000,active1:1,active7:2,active30:2,regular:1},
  trend:[{date:'2026-10-12',actions:12,users:2,registrations:1},{date:'2026-10-19',actions:0,users:0,registrations:0},{date:'2026-10-26',actions:8,users:1,registrations:0},{date:'2026-11-02',actions:20,users:2,registrations:1}],features:[]}

test('private analytics filters, sorts, drills down and adapts without page overflow',async({page},info)=>{
  await page.routeWebSocket('**/*',socket=>socket.close())
  await mockNativeAiSession(page,'trainer')
  let last:Record<string,unknown>={}
  await page.route('**/v1/private-analytics/explore',route=>{
    last=route.request().postDataJSON() as Record<string,unknown>
    const people=[{id:'p1',person_id:'p1',person:'Мария Синтетическая — длинное имя тренера',role:'trainer',actions:12,active_days:3,authored_workouts:10,clients_total:4},{id:'p2',person_id:'p2',person:'Алексей Пример',role:'client',actions:2,active_days:1,workouts:2,meals:4}]
    const rows=last.section==='activities'?[{id:'a1',person_id:'p1',person:people[0]!.person,role:'trainer',date:'2026-11-07T09:00:00Z',feature:'workouts',action:'updated',evidence:'observed',source_id:'workout-1'}]:last.section==='payments'?[{id:'payment',person_id:'p1',person:people[0]!.person,client:'Алексей Пример',amount:12000,date:'2026-11-07',source:'manual'}]:last.search==='нет результата'?[]:last.role==='trainer'?people.slice(0,1):last.direction==='asc'?[...people].reverse():people
    return route.fulfill({json:{...base,rows,total:rows.length}})
  })
  await page.goto(nativeAiUrl('/private-analytics'))
  await expect(page.getByRole('table',{name:'Люди',exact:true})).toBeVisible()
  await page.getByRole('columnheader',{name:/Действия/}).getByRole('button').click()
  await expect(page.getByRole('columnheader',{name:/Действия/})).toHaveAttribute('aria-sort','ascending')
  await expect.poll(()=>last.direction).toBe('asc')
  await page.getByRole('combobox',{name:'Роль',exact:true}).selectOption('trainer')
  await page.getByRole('button',{name:'Применить',exact:true}).click()
  await expect(page.getByRole('table').getByText('Алексей Пример')).toHaveCount(0)
  await page.getByRole('button',{name:'Мария Синтетическая — длинное имя тренера',exact:true}).click()
  await expect(page.getByRole('heading',{name:'Действия',exact:true})).toBeVisible()
  await expect.poll(()=>last.person).toBe('p1')
  await page.getByRole('button',{name:'Назад к предыдущему срезу'}).click()
  await expect(page.getByRole('heading',{name:'Люди',exact:true})).toBeVisible()
  await page.getByRole('searchbox',{name:'Поиск в таблице'}).fill('нет результата')
  await page.getByRole('button',{name:'Найти',exact:true}).click()
  await expect(page.getByText('По выбранным условиям записей нет.',{exact:false})).toBeVisible()
  await page.getByRole('searchbox',{name:'Поиск в таблице'}).fill('')
  await page.getByRole('button',{name:'Найти',exact:true}).click()
  // Dense tables and controls are checked at desktop and two touch widths;
  // theme-specific token contrast is covered with the same synthetic data.
  for(const [width,theme] of [[1440,'light'],[1440,'dark'],[390,'light'],[430,'dark']] as const){
    await page.setViewportSize({width,height:1000})
    await page.evaluate(value=>localStorage.setItem('fit.appTheme',value),theme)
    await page.reload()
    await expect(page.getByRole('table',{name:'Люди',exact:true})).toBeVisible()
    await expect(page.locator('html')).toHaveClass(theme==='light'?/theme-light/:/^(?!.*theme-light).*$/)
    await page.evaluate(()=>scrollTo(0,0))
    await expect(page.locator('.corporate-admin-shell')).toHaveClass(theme==='light'?/theme-light/:/fit-lime-shell ui-identity ym-hide-content $/)
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
    const background=await page.locator('.corporate-admin-shell').evaluate(node=>getComputedStyle(node).backgroundColor)
    expect(background).toBe(theme==='light'?'rgb(246, 247, 242)':'rgb(0, 0, 0)')
    await expect(page.locator('.private-analytics-shell')).toHaveClass(/fit-lime/ )
    await expect(page.getByRole('button',{name:'Применить',exact:true})).toHaveCSS('background-color','rgb(209, 253, 45)')
    await expect(page.locator('.private-analytics-shell')).toHaveCSS('font-family', /YS Geo/)
    await page.screenshot({path:info.outputPath(`analytics-${width}-${theme}.png`),fullPage:true})
  }
  await page.getByRole('button',{name:'Поступления',exact:true}).click()
  await expect(page.getByRole('table',{name:'Поступления',exact:true}).getByText('12 000')).toBeVisible()
  const download=page.waitForEvent('download')
  await page.getByRole('button',{name:'Скачать CSV'}).click()
  expect((await download).suggestedFilename()).toMatch(/^fit-payments-/)
})

test('private analytics does not expose data when the server denies access',async({page})=>{
  await mockNativeAiSession(page,'client')
  await page.route('**/v1/private-analytics/explore',route=>route.fulfill({status:403,json:{error:'analytics_forbidden'}}))
  await page.goto(nativeAiUrl('/private-analytics'))
  await expect(page.getByRole('alert')).toContainText('Нет доступа')
  await expect(page.getByRole('table')).toHaveCount(0)
})
test('the former analytics URL retains its existing trainer fallback',async({page})=>{
  await mockNativeAiSession(page,'trainer');await page.goto(nativeAiUrl('/analytics'))
  await expect(page.getByRole('heading',{name:'Сегодня',exact:true})).toBeVisible()
})

test('referral report exposes period counts and source search without people filters',async({page})=>{
  await page.routeWebSocket('**/*',socket=>socket.close())
  await mockNativeAiSession(page,'trainer')
  await page.route('**/v1/private-analytics/explore',route=>route.fulfill({json:{...base,total:1,rows:[{id:'s1',name:'Сотрудница',code:'staff-001',clicks:4,registrations:1,conversion:25,active:true}],summary:{clicks:4,registrations:1,conversion:25}}}))
  await page.goto(nativeAiUrl('/private-analytics?section=referrals'))
  await expect(page.getByRole('table',{name:'Реферальные ссылки',exact:true})).toBeVisible()
  await expect(page.getByText('staff-001',{exact:true})).toBeVisible()
  await expect(page.getByRole('combobox',{name:'Роль',exact:true})).toHaveCount(0)
  await expect(page.getByRole('region',{name:'Динамика реферальных событий'})).toBeVisible()
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true)
  await page.screenshot({path:'test-results/referral-report.png',fullPage:true})
})
