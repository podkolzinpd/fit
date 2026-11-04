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
  expect((await planned.boundingBox())!.height).toBe(94)
  await expect(page.locator('.goal-head h2 img')).toHaveCSS('width','24px')
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
  await expect(block.getByRole('textbox',{name:'Заметка',exact:true})).toHaveValue(note)
  const editor=page.getByRole('textbox',{name:'Заметка',exact:true})
  const draft='Тренироваться вечером. '.repeat(30)
  await editor.fill(draft)
  await page.locator('.client-profile-note').getByRole('button',{name:'Сохранить',exact:true}).click()
  await expect(page.locator('.client-profile-note .error')).toBeVisible()
  await expect(editor).toHaveValue(draft)
  await expect.poll(()=>version).toBe(4)
  await page.locator('.client-profile-note').getByRole('button',{name:'Сохранить',exact:true}).click()
  await expect(block.getByRole('textbox',{name:'Заметка',exact:true})).toHaveValue(draft.trim())
  expect(writes).toHaveLength(2)
  await block.getByRole('button',{name:'Показать всю заметку'}).click()
  await expect(block.getByRole('button',{name:'Свернуть заметку'})).toHaveAttribute('aria-expanded','true')
  await page.reload()
  await expect(block.getByRole('textbox',{name:'Заметка',exact:true})).toHaveValue(draft.trim())
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
  await expect(page.locator('.phone-frame')).toHaveClass(/keyboard-open/)
  await expect(page.locator('html')).toHaveCSS('--app-visible-height','440px')
  await page.evaluate(()=>document.fonts.ready)
  await editor.scrollIntoViewIfNeeded()
  // Measure typing after the viewport-opening transition has settled.
  await editor.evaluate(el=>new Promise<void>(resolve=>{
    let previous=el.getBoundingClientRect().y,stable=0
    const frame=()=>{const y=el.getBoundingClientRect().y;stable=Math.abs(y-previous)<.5?stable+1:0;previous=y;if(stable>=4)resolve();else requestAnimationFrame(frame)}
    requestAnimationFrame(frame)
  }))
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
  await expect(page.locator('.client-profile-note').getByRole('textbox',{name:'Заметка',exact:true})).toHaveValue('Личная заметка')
  expect(writes).toEqual([{draft:{fullName:'Настоящее имя',gender:null,ageYears:null,ageUpdatedAt:null,heightCm:null,goal:'Выносливость'},expectedVersion:7}])
})

for (const width of [375,390,430]) test(`Reference profile dimensions and direct note input ${width}`,async({page},info)=>{
  await page.setViewportSize({width,height:844})
  await mockPilot(page,{fitLime:true,clientHasAccount:false,withGoal:false,workouts:[]})
  await page.goto(`/clients/${clientId}`)
  const header=page.locator('.page-header'), name=page.locator('.client-profile-header h2')
  await expect(name).toBeVisible()
  const bar=(await header.boundingBox())!, title=(await name.boundingBox())!
  expect(Math.abs(title.y-(bar.y+bar.height)-48)).toBeLessThanOrEqual(2)
  const actions=(await page.locator('.client-profile-header-actions').boundingBox())!
  expect(actions.x+actions.width).toBeGreaterThan(width-30)
  await expect(page.locator('.client-profile-header-actions img').first()).toHaveCSS('width','40px')
  const goal=page.locator('.client-profile-goal')
  const goalIcon=(await goal.locator('h2 img').boundingBox())!, goalTitle=(await goal.locator('.goal-title').boundingBox())!
  const add=goal.getByRole('link',{name:'Добавить цель',exact:true}), addBox=(await add.boundingBox())!
  expect(goalIcon.x).toBe(20);expect(goalTitle.x).toBe(20);expect(addBox.x).toBe(20)
  await expect(add).toHaveCSS('color','rgb(209, 253, 45)')
  await expect(add).toHaveCSS('text-decoration-line','none')
  const routes=page.getByRole('navigation',{name:'Разделы спортсмена'})
  for(const link of await routes.getByRole('link').all()) expect((await link.boundingBox())!.height).toBe(120)
  for(const arrow of await routes.locator('img').all()) {await expect(arrow).toHaveCSS('width','20px');expect(await arrow.evaluate((el:HTMLImageElement)=>el.complete&&el.naturalWidth===20)).toBe(true)}
  expect(await routes.locator('img').first().evaluate(async(el:HTMLImageElement)=>{const svg=await(await fetch(el.src)).text();return new DOMParser().parseFromString(svg,'image/svg+xml').querySelector('[fill-opacity]')?.getAttribute('fill-opacity')})).toBe('0.6')
  const empty=page.locator('.client-profile-empty-upcoming')
  await expect(empty).toHaveText('Тренировки не запланированы')
  await expect(empty.locator('img')).toHaveCSS('width','24px')
  const note=page.locator('.client-profile-note'), editor=note.getByRole('textbox',{name:'Заметка',exact:true})
  await note.scrollIntoViewIfNeeded()
  await expect(editor).toHaveAttribute('placeholder','Текст заметки')
  await expect(note.getByRole('button',{name:'Сохранить',exact:true})).toBeDisabled()
  await expect(note.getByRole('button',{name:'Надиктовать заметку',exact:true})).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await editor.fill('Проверка прямого ввода')
  await expect(note.getByRole('button',{name:'Сохранить',exact:true})).toBeEnabled()
  const mic=(await note.getByRole('button',{name:'Надиктовать заметку',exact:true}).boundingBox())!, input=(await editor.boundingBox())!
  expect(mic.y+mic.height).toBeLessThanOrEqual(input.y)
  expect(input.height).toBeGreaterThanOrEqual(136)
  await page.locator('.client-profile-logo').scrollIntoViewIfNeeded()
  await expect(page.locator('.client-profile-logo')).toHaveCSS('width','89px')
  await expect(page.locator('.client-profile-logo')).toHaveCSS('height','47px')
  await page.screenshot({path:info.outputPath('reference-note-footer.png')})
})


test('Inline private note preserves the draft when microphone permission is denied',async({page})=>{
  await mockPilot(page,{fitLime:true,withGoal:false,workouts:[]})
  await page.addInitScript(()=>Object.defineProperty(navigator,'mediaDevices',{
    configurable:true,value:{getUserMedia:()=>Promise.reject(new DOMException('Permission denied','NotAllowedError'))},
  }))
  await page.goto(`/clients/${clientId}`)
  const note=page.locator('.client-profile-note'), editor=note.getByRole('textbox',{name:'Заметка',exact:true})
  await editor.fill('Сохраняем набранный текст')
  await note.getByRole('button',{name:'Надиктовать заметку',exact:true}).click()
  await expect(note.getByText('Нет доступа к микрофону.',{exact:false})).toBeVisible()
  await expect(editor).toHaveValue('Сохраняем набранный текст')
  await expect(editor).toBeEnabled()
  await expect(note.getByRole('button',{name:'Сохранить',exact:true})).toBeEnabled()
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

}
