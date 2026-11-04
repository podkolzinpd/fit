import { expect, test } from '@playwright/test'
import { mockPilot, clientId } from './fit-lime-fixtures'

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

}
