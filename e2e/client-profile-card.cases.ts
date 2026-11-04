import { expect, test } from '@playwright/test'
import { mockPilot, clientId, workout } from './fit-lime-fixtures'

export function clientProfileCardCases() {

for (const width of [390,430]) test(`Client photo upload and profile geometry ${width}`, async ({page},testInfo)=>{
  await page.setViewportSize({width,height:844})
  await mockPilot(page,{fitLime:true})
  let image:string|null=null,version=0
  await page.route(`**/v1/clients/${clientId}/photo`, async route=>{
    if(route.request().method()==='PUT'){
      const body=route.request().postDataJSON() as {expectedVersion:number;photo:{dataUrl:string;sizeBytes:number;width:number;height:number}}
      expect(body.expectedVersion).toBe(version)
      expect(body.photo.sizeBytes).toBeLessThanOrEqual(160000)
      expect(Math.max(body.photo.width,body.photo.height)).toBeLessThanOrEqual(480)
      image=body.photo.dataUrl;version++
    }
    await route.fulfill({json:{url:image,version}})
  })
  await page.goto(`/clients/${clientId}`)
  await expect(page.locator('.client-profile-header')).toBeVisible()
  const headerActions=await page.locator('.client-profile-header-actions').boundingBox()
  expect(headerActions!.x).toBeGreaterThan(width/2)
  await expect(page.locator('.client-profile-header h2')).toHaveText('Алексей Смирнов')
  await expect(page.locator('.client-profile-vitals > div')).toHaveCount(4)
  await expect(page.locator('.client-profile-photo')).toHaveCount(0)
  await page.getByRole('button',{name:'Действия с профилем спортсмена'}).click()
  await expect(page.getByRole('menuitem',{name:'Загрузить фото'})).toBeVisible()
  const data=await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=100;canvas.height=100;const ctx=canvas.getContext('2d')!;ctx.fillStyle='#556677';ctx.fillRect(0,0,100,100);return canvas.toDataURL('image/jpeg').split(',')[1]!})
  await page.locator('#client-profile-photo-input').setInputFiles({name:'synthetic.jpg',mimeType:'image/jpeg',buffer:Buffer.from(data,'base64')})
  await page.keyboard.press('Escape')
  const photo=page.locator('.client-profile-photo')
  await expect(photo).toBeVisible()
  await expect(photo).toHaveCSS('width','121px')
  await expect(photo).toHaveCSS('height','120px')
  expect(await photo.evaluate((img:HTMLImageElement)=>img.complete&&img.naturalWidth>0)).toBe(true)
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  await page.screenshot({path:testInfo.outputPath('client-profile-photo.png'),fullPage:true})
  await page.reload()
  await expect(page.locator('.client-profile-photo')).toBeVisible()
})

test('Profile actions preserve the selected client and quick-start format',async({page})=>{
  await mockPilot(page,{fitLime:true,workouts:[]})
  await page.goto(`/clients/${clientId}`)
  await page.getByRole('link',{name:'Запланировать тренировку'}).click()
  await expect(page).toHaveURL(new RegExp(`/workouts/new\\?client=${clientId}`))
  await page.goto(`/clients/${clientId}`)
  await page.getByRole('button',{name:'Начать тренировку',exact:true}).click()
  await expect(page.getByRole('group',{name:'Формат тренировки'})).toBeVisible()
  await page.getByRole('button',{name:'Начать тренировку',exact:true}).click()
  await expect(page).toHaveURL(/\/workouts\/[^/]+\/live$/)
})

for (const connected of [false,true]) test(`Client connection indicator uses account state ${connected}`,async({page})=>{
  await mockPilot(page,{fitLime:true,clientHasAccount:connected,workouts:[]})
  await page.goto(`/clients/${clientId}`)
  await expect(page.getByRole('img',{name:connected ? 'Клиент подключён к приложению' : 'Клиент ещё не подключён'})).toBeVisible()
  const invite=page.getByRole('button',{name:'Пригласить в приложение',exact:true})
  if(connected) await expect(invite).toHaveCount(0)
  else {
    await expect(invite).toBeVisible()
    const plan=await page.getByRole('link',{name:'Запланировать тренировку'}).boundingBox()
    const invitation=await invite.boundingBox()
    expect(invitation!.y).toBeGreaterThanOrEqual(plan!.y+plan!.height)
  }
  await page.getByRole('button',{name:'Действия с профилем спортсмена'}).click()
  await expect(page.getByRole('menuitem',{name:'Редактировать профиль'})).toBeVisible()
  await expect(page.getByRole('menuitem',{name:'Архивировать клиента'})).toBeVisible()
  await page.getByRole('menuitem',{name:'Архивировать клиента'}).click()
  await expect(page.getByRole('alertdialog')).toBeVisible()
  await page.getByRole('button',{name:'Отмена',exact:true}).click()
  await page.getByRole('button',{name:'Действия с профилем спортсмена'}).click()
  if(connected){await page.getByRole('menuitem',{name:'Написать',exact:true}).click();await expect(page).toHaveURL(/\/chat\//)}
})

for (const withGoal of [false,true]) test(`Client reference sections retain their destinations ${withGoal}`,async({page},info)=>{
  await page.clock.setFixedTime(new Date('2026-09-24T09:00:00+03:00'))
  await mockPilot(page,{fitLime:true,withGoal,workouts:[{...workout,status:'planned',title:'Верх тела',workoutDate:'2026-09-24',startTime:'14:00',completedAt:null}]})
  await page.goto(`/clients/${clientId}`)
  const routes=page.getByRole('navigation',{name:'Разделы спортсмена'})
  await expect(routes.getByRole('link')).toHaveText(['Прогресс и замеры','История тренировок','Абонементы и оплаты'])
  await expect(routes.getByRole('link').first()).toHaveAttribute('href',`/progress/${clientId}`)
  await expect(routes.getByRole('link').nth(1)).toHaveAttribute('href',`/clients/${clientId}/workouts`)
  await expect(routes.getByRole('link').nth(2)).toHaveAttribute('href',`/clients/${clientId}/finance`)
  await expect(routes.getByRole('link').first()).toHaveCSS('min-height','120px')
  const planned=page.locator('.client-detail-upcoming .card').first()
  await expect(planned).toContainText('Верх тела')
  await expect(planned).toContainText('Сегодня, 14:00')
  if(!withGoal) await expect(page.getByRole('link',{name:'Добавить цель',exact:true})).toHaveAttribute('href',`/clients/${clientId}/goal`)
  await page.getByText('Статистика, замеры и питание',{exact:true}).click()
  await expect(page.locator('.client-detail-snapshot')).toBeVisible()
  await page.getByText('Статистика, замеры и питание',{exact:true}).click()
  await expect(page.locator('.client-detail-snapshot')).not.toBeVisible()
  await page.locator('.content').evaluate(el => { el.scrollTop=0 })
  await page.screenshot({path:info.outputPath('client-reference-top.png')})
  await planned.scrollIntoViewIfNeeded()
  await page.screenshot({path:info.outputPath('client-reference-sections.png')})
  await planned.click()
  await expect(page).toHaveURL(new RegExp(`/workouts/${workout.id}$`))
})

test('Private note saves for an incomplete profile and retains a conflicting draft', async ({page}, info) => {
  await mockPilot(page,{fitLime:true,withGoal:false,workouts:[]})
  let note='Первоначальная заметка', version=3, conflict=true
  const writes:unknown[]=[]
  await page.route(url => url.pathname === '/v1/clients', async route => route.fulfill({json:{clients:[{
    id:clientId,canArchive:true,hasAccount:false,fullName:'Имя у тренера',canonicalFullName:'Настоящее имя',
    gender:null,ageYears:null,ageUpdatedAt:null,heightCm:null,goal:'Сила',note,currentWeightKg:null,
    archivedAt:null,version:7,membershipVersion:version,
  }]}}))
  await page.route(`**/v1/clients/${clientId}/preferences`, async route => {
    const input=route.request().postDataJSON() as {alias:string;note:string;expectedVersion:number}
    writes.push(input)
    expect(input.alias).toBe('Имя у тренера')
    expect(input.expectedVersion).toBe(version)
    if(conflict){conflict=false;version++;await route.fulfill({status:409,json:{error:'client_conflict'}});return}
    note=input.note;version++
    await route.fulfill({json:{client:{membershipVersion:version}}})
  })
  await page.goto(`/clients/${clientId}`)
  const block=page.locator('.client-profile-note')
  await expect(block).toContainText(note)
  await block.getByRole('button',{name:'Изменить',exact:true}).click()
  const editor=page.getByRole('textbox',{name:'Заметка',exact:true})
  const draft='Тренироваться вечером. '.repeat(30)
  await editor.fill(draft)
  await page.locator('.client-note-block').getByRole('button',{name:'Сохранить',exact:true}).click()
  await expect(page.locator('.client-note-block .error')).toBeVisible()
  await expect(editor).toHaveValue(draft)
  await expect.poll(()=>version).toBe(4)
  await page.locator('.client-note-block').getByRole('button',{name:'Сохранить',exact:true}).click()
  await expect(block).toContainText(draft.trim())
  expect(writes).toHaveLength(2)
  await block.getByRole('button',{name:'Показать всю заметку'}).click()
  await expect(block.getByRole('button',{name:'Свернуть заметку'})).toHaveAttribute('aria-expanded','true')
  await page.reload()
  await expect(block).toContainText(draft.trim())
  await block.scrollIntoViewIfNeeded()
  await page.screenshot({path:info.outputPath('client-private-note.png')})
})

test('Legacy goal saves nullable profile fields without renaming the client', async ({page}) => {
  await mockPilot(page,{fitLime:true,withGoal:false,workouts:[]})
  let goal='Сила'
  const writes:unknown[]=[]
  await page.route(url => url.pathname === '/v1/clients', async route => route.fulfill({json:{clients:[{
    id:clientId,canArchive:true,hasAccount:false,fullName:'Имя у тренера',canonicalFullName:'Настоящее имя',
    gender:null,ageYears:null,ageUpdatedAt:null,heightCm:null,goal,note:'Личная заметка',currentWeightKg:null,
    archivedAt:null,version:7,membershipVersion:3,
  }]}}))
  await page.route(`**/v1/clients/${clientId}`, async route => {
    const input=route.request().postDataJSON() as {draft:{goal:string};expectedVersion:number}
    writes.push(input);goal=input.draft.goal
    await route.fulfill({json:{client:{id:clientId,version:8}}})
  })
  await page.goto(`/clients/${clientId}`)
  await page.locator('.client-profile-goal').getByRole('button',{name:'Изменить',exact:true}).click()
  const editor=page.getByRole('textbox',{name:'Цель',exact:true})
  // Reduced viewport checks geometry, not a physical iOS keyboard.
  await page.setViewportSize({width:390,height:440})
  await editor.fill('Выносливость')
  await editor.scrollIntoViewIfNeeded()
  const before=(await editor.boundingBox())!
  await editor.press('End')
  await editor.press('Space')
  const after=(await editor.boundingBox())!
  expect(Math.abs(after.y-before.y)).toBeLessThanOrEqual(2)
  expect(after.y).toBeGreaterThanOrEqual(0)
  expect(after.y+after.height).toBeLessThanOrEqual(440)
  await page.locator('.goal-block').filter({has:editor}).getByRole('button',{name:'Сохранить',exact:true}).click()
  await page.setViewportSize({width:390,height:844})
  await expect(page.locator('.client-profile-goal')).toContainText('Выносливость')
  await expect(page.locator('.client-profile-note')).toContainText('Личная заметка')
  expect(writes).toEqual([{draft:{fullName:'Настоящее имя',gender:null,ageYears:null,ageUpdatedAt:null,heightCm:null,goal:'Выносливость'},expectedVersion:7}])
})

}
