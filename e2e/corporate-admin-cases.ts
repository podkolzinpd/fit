import { expect, test } from '@playwright/test'
import { mockNativeAiSession, nativeAiUrl } from './native-ai-fixture'

export function registerCorporateAdminCases() {

test('existing trainer settings baseline stays available', async ({ page }) => {
  await mockNativeAiSession(page, 'trainer')
  await page.goto(nativeAiUrl('/profile/settings'))
  await expect(page.getByRole('heading', { name: 'Настройки', exact: true })).toBeVisible()
  await expect(page.getByRole('switch', { name: 'Показывать RPE' })).toBeVisible()
  await page.screenshot({ path: '/private/tmp/fit-admin-settings-before.png', fullPage: true })
})

const officeId = '20000000-0000-4000-8000-000000000001'
const coachId = '20000000-0000-4000-8000-000000000002'

test('trainer settings stay visible when opened from a long list, including repeated selection', async ({ page }, testInfo) => {
  await mockNativeAiSession(page, 'client')
  const offices = Array.from({ length: 33 }, (_, index) => ({
    id: `30000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    city: 'Тестовый город', name: `Офис ${index + 1}`, address: 'Тестовый адрес', archived: false, version: 1,
  }))
  const trainers = Array.from({ length: 60 }, (_, index) => ({
    id: `40000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    name: `Тренер ${index + 1}`, isYandex: true, officeIds: [], version: 1,
  }))
  await page.route('**/v1/admin/access', route => route.fulfill({ json: { allowed: true } }))
  await page.route('**/v1/admin/bundle', route => route.fulfill({ json: { offices, trainers } }))
  let writes = 0
  await page.route('**/v1/admin/trainers', route => { writes += 1; return route.abort() })
  for (const width of [1366, 390]) {
    await page.setViewportSize({ width, height: width > 700 ? 768 : 844 })
    await page.goto(nativeAiUrl('/admin'))
    await expect(page.getByRole('heading', { name: 'Кабинет Яндекса', exact: true })).toBeVisible()
    await page.evaluate(theme => localStorage.setItem('fit.appTheme', theme), width < 700 ? 'dark' : 'light')
    await page.reload()
    if (width < 700) await expect(page.locator('html')).not.toHaveClass(/theme-light/)
    else await expect(page.locator('html')).toHaveClass(/theme-light/)
    const trigger = page.getByRole('button', { name: 'Настроить тренера Тренер 60', exact: true })
    await expect(trigger).toBeVisible()
    expect((await trigger.boundingBox())?.y).toBeGreaterThan(1000)
    await trigger.scrollIntoViewIfNeeded()
    await expect(trigger).toBeInViewport()
    await trigger.click()
    const editor = page.getByRole('form', { name: 'Настройки Тренер 60', exact: true })
    const heading = editor.getByRole('heading', { name: 'Тренер 60', exact: true })
    await expect(heading).toBeInViewport()
    await expect(heading).toBeFocused()
    await page.screenshot({ path: testInfo.outputPath(`admin-editor-visible-${width}.png`) })
    await editor.getByRole('checkbox', { name: 'Тренер Яндекса', exact: true }).uncheck()
    await editor.getByRole('checkbox', { name: 'Тестовый город · Офис 1', exact: true }).check()
    await trigger.scrollIntoViewIfNeeded()
    await trigger.click()
    await expect(heading).toBeInViewport()
    await expect(heading).toBeFocused()
    await expect(editor.getByRole('checkbox', { name: 'Тренер Яндекса', exact: true })).not.toBeChecked()
    await expect(editor.getByRole('checkbox', { name: 'Тестовый город · Офис 1', exact: true })).toBeChecked()
    await page.getByRole('button', { name: 'Настроить тренера Тренер 59', exact: true }).click()
    const nextEditor = page.getByRole('form', { name: 'Настройки Тренер 59', exact: true })
    await expect(nextEditor.getByRole('heading', { name: 'Тренер 59', exact: true })).toBeInViewport()
    await expect(nextEditor.getByRole('checkbox', { name: 'Тренер Яндекса', exact: true })).toBeChecked()
    await expect(nextEditor.getByRole('checkbox', { name: 'Тестовый город · Офис 1', exact: true })).not.toBeChecked()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await nextEditor.getByRole('button', { name: 'Отмена', exact: true }).click()
    await expect(nextEditor).toHaveCount(0)
  }
  expect(writes).toBe(0)
})

test('admin manages offices and trainer flags on a laptop, including validation and retry', async ({ page }, testInfo) => {
  await page.setViewportSize({ width:1366,height:768 })
  await mockNativeAiSession(page,'trainer')
  await page.route('**/v1/admin/access',r=>r.fulfill({json:{allowed:true}}))
  const offices: Array<{id:string;city:string;name:string;address:string;archived:boolean;version:number}> = []
  const trainers = [{id:coachId,name:'Тестовый тренер',isYandex:true,officeIds:[] as string[],version:1}]
  let fail = true
  await page.route('**/v1/admin/bundle',r=>r.fulfill({json:{offices,trainers}}))
  await page.route('**/v1/admin/offices',async r=>{
    const value=r.request().postDataJSON() as typeof offices[number]
    if(fail) { fail=false; return r.fulfill({status:503,json:{error:'service_unavailable'}}) }
    const old=offices.findIndex(o=>o.id===value.id)
    const updated={...value,version:value.version+1}
    if(old<0) offices.push(updated); else offices[old]=updated
    await r.fulfill({json:{saved:true}})
  })
  await page.route('**/v1/admin/trainers',async r=>{
    const value=r.request().postDataJSON() as typeof trainers[number]
    Object.assign(trainers[0]!,value,{version:value.version+1})
    await r.fulfill({json:{saved:true}})
  })
  await page.goto(nativeAiUrl('/admin'))
  await expect(page.getByRole('heading',{name:'Кабинет Яндекса'})).toBeVisible()
  await expect(page.getByText('Анкета не опубликована', { exact: true })).toHaveCount(0)
  await page.getByRole('button',{name:'Настроить тренера Тестовый тренер'}).click()
  await page.getByRole('checkbox',{name:'Тренер Яндекса',exact:true}).check()
  await page.getByRole('button',{name:'Сохранить тренера'}).click()
  await expect(page.getByRole('alert')).toContainText('Выберите хотя бы один офис')
  await page.getByRole('button',{name:'Отмена',exact:true}).click()
  await page.getByRole('button',{name:'Офисы',exact:true}).click()
  await page.getByRole('button',{name:'Добавить офис'}).click()
  await page.getByLabel('Город',{exact:true}).fill('Санкт-Петербург')
  await page.getByLabel('Название офиса').fill('Бенуа')
  await page.getByLabel('Адрес',{exact:true}).fill('Пискарёвский проспект, 2')
  await page.getByRole('button',{name:'Сохранить офис'}).click()
  await expect(page.getByRole('alert')).toContainText('Повторите попытку')
  await expect(page.getByLabel('Название офиса')).toHaveValue('Бенуа')
  await page.getByRole('button',{name:'Сохранить офис'}).click()
  await expect(page.getByRole('form',{name:'Данные офиса'})).toBeHidden()
  await expect(page.getByText('Бенуа',{exact:true})).toBeVisible()
  await page.getByRole('button',{name:'Изменить офис Бенуа'}).click()
  await page.getByLabel('Название офиса').fill('БЦ Бенуа')
  await page.getByRole('button',{name:'Сохранить офис'}).click()
  await expect(page.getByRole('form',{name:'Данные офиса'})).toBeHidden()
  await page.getByRole('button',{name:'Тренеры',exact:true}).click()
  await page.getByRole('button',{name:'Настроить тренера Тестовый тренер'}).click()
  await page.getByRole('checkbox',{name:'Тренер Яндекса',exact:true}).check()
  await page.getByRole('checkbox',{name:'Санкт-Петербург · БЦ Бенуа'}).check()
  await page.getByRole('button',{name:'Сохранить тренера'}).click()
  await expect(page.getByRole('form',{name:'Настройки Тестовый тренер'})).toBeHidden()
  expect(trainers[0]?.isYandex).toBe(true)
  expect(trainers[0]?.officeIds).toHaveLength(1)
  await expect(page.getByText(/Тренер Яндекса · Санкт-Петербург, БЦ Бенуа/)).toBeVisible()
  await expect(page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).resolves.toBe(true)
  await page.screenshot({path:testInfo.outputPath('admin-laptop.png'),fullPage:true})
  await page.getByRole('button',{name:'Настроить тренера Тестовый тренер'}).click()
  await page.getByRole('checkbox',{name:'Тренер Яндекса',exact:true}).uncheck()
  await page.getByRole('button',{name:'Сохранить тренера'}).click()
  await expect(page.getByRole('form',{name:'Настройки Тестовый тренер'})).toBeHidden()
  expect(trainers[0]?.isYandex).toBe(false)
  await page.getByRole('button',{name:'Офисы',exact:true}).click()
  await page.getByRole('button',{name:'Архивировать офис БЦ Бенуа'}).click()
  await page.getByRole('button',{name:'Архивировать',exact:true}).click()
  await expect(page.getByText('БЦ Бенуа',{exact:true})).toBeHidden()
  await page.getByRole('checkbox',{name:'Показывать архивные'}).check()
  await expect(page.getByText(/Пискарёвский проспект, 2 · Архив/)).toBeVisible()
  await page.getByRole('button',{name:'Восстановить офис БЦ Бенуа'}).click()
  await page.getByRole('button',{name:'Восстановить',exact:true}).click()
  await expect(page.getByText(/Пискарёвский проспект, 2 · Архив/)).toBeHidden()
})

test('admin identifies namesakes by published name, photo and profile link', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1366, height: 900 })
  await mockNativeAiSession(page, 'client')
  const publicId = '20000000-0000-4000-8000-000000000010'
  const photoUrl = nativeAiUrl('/assets/startup-photo-983c93dc4df8.jpg')
  await page.route('**/v1/admin/access', route => route.fulfill({ json: { allowed: true } }))
  await page.route('**/v1/admin/bundle', route => route.fulfill({ json: { offices: [], trainers: [
    { id: coachId, name: 'Тестовый тренер', publishedName: 'Тренер Север', publicId, photoUrl, isYandex: true, officeIds: [], version: 1 },
    { id: '20000000-0000-4000-8000-000000000099', name: 'Посторонний тренер', isYandex: false, officeIds: [], version: 0 },
    { id: officeId, name: 'Тестовый тренер', publishedName: null, publicId: null, photoUrl: null, isYandex: true, officeIds: [], version: 1 },
  ] } }))
  await page.goto(nativeAiUrl('/admin'))
  const rows = page.locator('.corporate-admin-list > li')
  await expect(rows).toHaveCount(2)
  await expect(page.getByText('Посторонний тренер', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('checkbox', { name: 'Только тренеры Яндекса' })).toHaveCount(0)
  await expect(rows.first().getByRole('img', { name: 'Фото тренера Тестовый тренер' })).toBeVisible()
  await expect.poll(() => rows.first().locator('img').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0)
  await expect(rows.last().getByText('Анкета не опубликована')).toBeVisible()
  await expect(rows.first().getByRole('link', { name: 'Открыть анкету' })).toHaveAttribute('href', `/trainers/${publicId}`)
  await expect(rows.first().getByRole('link', { name: 'Открыть анкету' })).toHaveAttribute('target', '_blank')
  const search = page.getByLabel('Поиск тренера', { exact: true })
  await search.fill('Север')
  await expect(rows).toHaveCount(1)
  await search.fill(`https://fit-training.ru/trainers/${publicId}?source=copy`)
  await expect(rows).toHaveCount(1)
  await expect(rows).toContainText('Тренер Север')
  await page.screenshot({ path: testInfo.outputPath('admin-profile-search-laptop.png'), fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await search.fill('')
  await expect(rows).toHaveCount(2)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('admin-profile-search-mobile.png'), fullPage: true })
  await search.fill('Нет такого тренера')
  await expect(page.getByRole('heading', { name: 'Тренеры не найдены' })).toBeVisible()
})

for(const role of ['trainer','client'] as const) {
  test(`${role} without capability cannot see admin data or entry`,async({page})=>{
    await mockNativeAiSession(page,role)
    await page.route('**/v1/admin/access',r=>r.fulfill({json:{allowed:false}}))
    let bundleRequests=0
    await page.route('**/v1/admin/bundle',r=>{bundleRequests++; return r.fulfill({status:403,json:{error:'corporate_forbidden'}})})
    await page.goto(nativeAiUrl('/admin'))
    await expect(page.getByRole('heading',{name:'Нет доступа'})).toBeVisible()
    expect(bundleRequests).toBe(0)
    await page.getByRole('link',{name:'Вернуться в ФИТ'}).click()
    await expect(page.getByRole('heading',{name:'Настройки',exact:true})).toBeVisible()
    await expect(page.getByRole('link',{name:'Кабинет Яндекса',exact:true})).toBeHidden()
  })
}
for(const theme of ['light','dark'] as const) {
  test(`admin layout ${theme} at laptop and mobile widths`,async({page},testInfo)=>{
    await mockNativeAiSession(page,'client')
    await page.addInitScript(value=>localStorage.setItem('fit.appTheme',value),theme)
    await page.route('**/v1/admin/access',r=>r.fulfill({json:{allowed:true}}))
    await page.route('**/v1/admin/bundle',r=>r.fulfill({json:{offices:[{id:officeId,city:'Санкт-Петербург',name:'БЦ Бенуа',address:'Длинный адрес офиса для проверки переноса текста',archived:false,version:1}],trainers:[{id:coachId,name:'Тестовый тренер с длинным именем',isYandex:true,officeIds:[officeId],version:1}]}}))
    for(const width of [1440,390,430]) {
      await page.setViewportSize({width,height:width>700?1000:844})
      await page.goto(nativeAiUrl('/admin'))
      await expect(page.getByRole('button',{name:'Настроить тренера Тестовый тренер с длинным именем'})).toBeVisible()
      await expect(page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).resolves.toBe(true)
      await page.screenshot({path:testInfo.outputPath(`admin-${theme}-${width}.png`),fullPage:true})
    }
  })
}


test('corporate invitation creates QR, explicitly claims and waits for administrator approval',async({page},testInfo)=>{
  await page.setViewportSize({width:1366,height:900})
  await mockNativeAiSession(page,'client')
  const invitationId='70000000-0000-4000-8000-000000000001',token='c'.repeat(43)
  let status='active',claims=0,approvals=0,created=false
  const offices=[{id:officeId,city:'Санкт-Петербург',name:'Бенуа',address:'Синтетический адрес',archived:false,version:1}]
  const routes=async()=>{
  await page.route('**/v1/admin/access',r=>r.fulfill({json:{allowed:true}}))
  await page.route('**/v1/admin/bundle',r=>r.fulfill({json:{offices,trainers:status==='approved'?[{id:coachId,name:'Приглашённый тренер',isYandex:true,officeIds:[officeId],version:1}]:[]}}))
  await page.route('**/v1/admin/invitations',r=>{
    if(r.request().method()==='POST'){created=true;return r.fulfill({json:{id:invitationId,token}})}
    return r.fulfill({json:{invitations:created?[{id:invitationId,status,createdAt:'2026-11-01T10:00:00+00:00',expiresAt:'2099-01-01T00:00:00+00:00',officeIds:[officeId],trainerName:status==='active'?null:'Приглашённый тренер'}]:[]}})
  })
  await page.route('**/v1/corporate-invitations/preview',r=>r.fulfill({json:{invitation:{status,expiresAt:'2099-01-01T00:00:00+00:00',offices:[{city:'Санкт-Петербург',name:'Бенуа'}]}}}))
  await page.route('**/v1/corporate-invitations/claim',r=>{claims++;status='claimed';return r.fulfill({json:{status}})})
  await page.route(`**/v1/admin/invitations/${invitationId}/approve`,r=>{approvals++;status='approved';return r.fulfill({json:{saved:true}})})
  }
  await routes()
  await page.goto(nativeAiUrl('/admin'))
  await expect(page.getByRole('button',{name:'Настроить тренера Приглашённый тренер'})).toHaveCount(0)
  await page.getByRole('button',{name:'Пригласить тренера',exact:true}).click()
  await page.getByRole('checkbox',{name:'Санкт-Петербург · Бенуа'}).check()
  await page.getByRole('button',{name:'Создать приглашение',exact:true}).click()
  const link=await page.getByRole('textbox',{name:'Ссылка приглашения'}).inputValue()
  expect(new URL(link).hash).toBe(`#token=${token}`)
  await page.getByRole('button',{name:'Показать QR',exact:true}).click()
  await expect(page.getByRole('img',{name:'QR-код приглашения тренера'})).toBeVisible()
  await page.screenshot({path:testInfo.outputPath('corporate-invitation-admin.png'),fullPage:true})
  await mockNativeAiSession(page,'trainer')
  await routes()
  await page.goto('about:blank')
  await page.goto(link)
  await expect(page.getByText('Текущий аккаунт:',{exact:false})).toBeVisible()
  expect(claims).toBe(0)
  await page.getByRole('button',{name:'Присоединиться к кабинету Яндекса',exact:true}).click()
  await expect(page.getByRole('heading',{name:'Ожидает подтверждения'})).toBeVisible()
  expect(claims).toBe(1);expect(approvals).toBe(0)
  await mockNativeAiSession(page,'client')
  await routes()
  await page.goto('about:blank')
  await page.goto(nativeAiUrl('/admin?tab=invitations'))
  await page.getByRole('button',{name:'Подтвердить тренера',exact:true}).click()
  await page.getByRole('button',{name:'Добавить тренера',exact:true}).click()
  await expect(page.getByText('Приглашение подтверждено',{exact:true})).toBeVisible()
  await page.getByRole('button',{name:'Тренеры',exact:true}).click()
  await expect(page.getByRole('button',{name:'Настроить тренера Приглашённый тренер'})).toBeVisible()
  expect(approvals).toBe(1)
})

test('corporate invitation guest, wrong role and terminal states do not claim automatically',async({page},testInfo)=>{
  const token='d'.repeat(43)
  let status='active',claims=0
  const routes=async()=>{
  await page.route('**/v1/corporate-invitations/preview',r=>r.fulfill({json:{invitation:{status,expiresAt:'2099-01-01T00:00:00Z',offices:[{city:'Москва',name:'Тестовый офис'}]}}}))
  await page.route('**/v1/corporate-invitations/claim',r=>{claims++;return r.fulfill({status:403,json:{error:'corporate_invitation_pilot_only'}})})
  }
  await routes()
  const url=nativeAiUrl(`/corporate-invite#token=${token}`)
  await page.setViewportSize({width:390,height:844})
  await page.goto(url)
  await expect(page.getByRole('button',{name:'Войти в ФИТ',exact:true})).toBeVisible()
  await expect(page.getByRole('button',{name:'Зарегистрироваться тренером',exact:true})).toBeVisible()
  expect(claims).toBe(0)
  const loginBox=await page.getByRole('button',{name:'Войти в ФИТ',exact:true}).boundingBox()
  const registerBox=await page.getByRole('button',{name:'Зарегистрироваться тренером',exact:true}).boundingBox()
  expect(loginBox!.height).toBeGreaterThanOrEqual(44)
  expect(registerBox!.y).toBeGreaterThanOrEqual(loginBox!.y+loginBox!.height)
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  await page.screenshot({path:testInfo.outputPath('corporate-invitation-guest-390.png'),fullPage:true})
  await mockNativeAiSession(page,'client')
  await routes()
  await page.goto('about:blank')
  await page.goto(url)
  await expect(page.getByText('Для принятия приглашения войдите в аккаунт тренера.')).toBeVisible()
  await expect(page.getByRole('button',{name:'Присоединиться к кабинету Яндекса'})).toHaveCount(0)
  await mockNativeAiSession(page,'trainer')
  await routes()
  await page.goto('about:blank')
  await page.goto(url)
  await page.getByRole('button',{name:'Присоединиться к кабинету Яндекса'}).click()
  await expect(page.getByRole('alert')).toContainText('только выбранным тестовым аккаунтам')
  for(const value of ['revoked','expired']){
    status=value
    await page.goto('about:blank')
    await page.goto(url)
    await expect(page.getByRole('heading',{name:value==='revoked'?'Приглашение отменено':'Срок приглашения истёк'})).toBeVisible()
    await expect(page.getByRole('button',{name:'Присоединиться к кабинету Яндекса'})).toHaveCount(0)
  }
  expect(claims).toBe(1)
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
})

}
