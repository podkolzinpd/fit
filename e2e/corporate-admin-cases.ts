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

test('admin manages offices and trainer flags on a laptop, including validation and retry', async ({ page }, testInfo) => {
  await page.setViewportSize({ width:1366,height:768 })
  await mockNativeAiSession(page,'trainer')
  await page.route('**/v1/admin/access',r=>r.fulfill({json:{allowed:true}}))
  const offices: Array<{id:string;city:string;name:string;address:string;archived:boolean;version:number}> = []
  const trainers = [{id:coachId,name:'Тестовый тренер',isYandex:false,officeIds:[] as string[],version:0}]
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
  await expect(page.getByRole('heading',{name:'Администрирование'})).toBeVisible()
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
    { id: coachId, name: 'Тестовый тренер', publishedName: 'Тренер Север', publicId, photoUrl, isYandex: false, officeIds: [], version: 0 },
    { id: officeId, name: 'Тестовый тренер', publishedName: null, publicId: null, photoUrl: null, isYandex: false, officeIds: [], version: 0 },
  ] } }))
  await page.goto(nativeAiUrl('/admin'))
  const rows = page.locator('.corporate-admin-list > li')
  await expect(rows).toHaveCount(2)
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
    await expect(page.getByRole('link',{name:'Администрирование',exact:true})).toBeHidden()
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

}
