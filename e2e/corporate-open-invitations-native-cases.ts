import {test,expect,nativeSignIn,nativeRequest} from './native-local-fixture'
const adminKey='open-invitation-admin'
export function registerCorporateOpenNativeCases(){
 test.beforeEach(async({page,nativeApi})=>{
  await page.routeWebSocket('**/*',socket=>socket.close())
  const allowed=new Set([new URL(String(test.info().project.use.baseURL)).origin,new URL(nativeApi).origin,'http://127.0.0.1:4100'])
  await page.context().route('**/*',route=>allowed.has(new URL(route.request().url()).origin)?route.fallback():route.abort('blockedbyclient'))
  await nativeSignIn(page,'trainer','trainer','Приглашённый тренер')
  await nativeSignIn(page,adminKey,'client','Администратор тестирования')
  const configured=await fetch(nativeApi+'/__fixtures/corporate-profile',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({trainerKey:'trainer',adminKey,invitationOnly:true})})
  expect(configured.status).toBe(200)
 })
 test('real API invitation accepts an unrelated contact email, confirms the actual trainer and opens all test modules',async({page},info)=>{
  await page.goto('/admin');await page.getByRole('button',{name:'Приглашения',exact:true}).click()
  await page.getByRole('button',{name:'Пригласить тренера',exact:true}).click()
  await expect(page.getByLabel('Почта тренера',{exact:true})).toHaveClass(/ym-disable-keys/)
  expect(await page.getByLabel('Почта тренера',{exact:true}).evaluate(el=>el.closest('.ym-hide-content')!==null)).toBe(true)
  await page.getByLabel('Почта тренера',{exact:true}).fill(' Colleague@MAIL.RU ')
  await page.getByRole('checkbox',{name:'Тестовый город · Тестовый офис',exact:true}).check()
  await page.getByRole('button',{name:'Создать приглашение',exact:true}).click()
  const link=await page.getByRole('textbox',{name:'Ссылка приглашения',exact:true}).inputValue()
  await expect(page.getByText('Для: Colleague@MAIL.RU',{exact:true})).toBeVisible()
  expect(new URL(link).origin).toBe(new URL(String(test.info().project.use.baseURL)).origin)
  await nativeSignIn(page,'trainer');await page.goto(link)
  await expect(page.getByText('Приглашения пока доступны только выбранным тестовым аккаунтам.')).toHaveCount(0)
  await page.getByRole('button',{name:'Присоединиться к кабинету Яндекса'}).click()
  await expect(page.getByRole('heading',{name:'Ожидает подтверждения'})).toBeVisible()
  expect(await(await nativeRequest(page,'/v1/corporate-personal/access')).json()).toMatchObject({allowed:false})
  await nativeSignIn(page,adminKey,'client');await page.goto('/admin');await page.getByRole('button',{name:'Приглашения',exact:true}).click()
  await expect(page.getByText('colleague@mail.ru',{exact:true})).toBeVisible()
  await page.getByRole('button',{name:'Подтвердить тренера',exact:true}).click()
  await expect(page.getByRole('alertdialog')).toContainText('открыть персональные тренировки, дежурства, услуги и редактирование анкеты')
  await page.getByRole('alertdialog').getByRole('button',{name:'Добавить тренера',exact:true}).click()
  await expect(page.getByText('Приглашение подтверждено',{exact:true})).toBeVisible()
  await page.getByRole('button',{name:'Тренеры',exact:true}).click();await expect(page.getByRole('button',{name:/Редактировать анкету/})).toBeVisible()
  await page.screenshot({path:info.outputPath('confirmed-trainer.png'),fullPage:true})
  const assigned=await(await nativeRequest(page,'/v1/admin/bundle')).json() as {offices:Array<{id:string}>}
  const officeId=assigned.offices[0]!.id
  expect((await nativeRequest(page,'/v1/admin/corporate-duty-offices',{method:'POST',body:{officeId,timeZone:'Europe/Moscow',version:0}})).status).toBe(200)
  await nativeSignIn(page,'trainer')
  for(const kind of ['services','personal','duties'])expect(await(await nativeRequest(page,`/v1/corporate-${kind}/access`)).json()).toMatchObject({allowed:true})
  const profile=await nativeRequest(page,'/v1/trainer-profile/access');expect(await profile.json()).toMatchObject({available:true,managedByAdmin:false})
  const dutyId=crypto.randomUUID()
  expect((await nativeRequest(page,'/v1/corporate-duties',{method:'POST',body:{id:dutyId,commandId:crypto.randomUUID(),action:'start',version:0,officeId}})).status).toBe(200)
  expect((await nativeRequest(page,'/v1/corporate-duties',{method:'POST',body:{id:dutyId,commandId:crypto.randomUUID(),action:'stop',version:1}})).status).toBe(200)
  expect((await nativeRequest(page,'/v1/admin/bundle')).status).toBe(403)
 })
 test('recipient duplicates have actionable recovery and an existing member can enable testing from the trainer card',async({page})=>{
  const bundle=await(await nativeRequest(page,'/v1/admin/bundle')).json() as {offices:Array<{id:string}>}
  const created=await(await nativeRequest(page,'/v1/admin/invitations',{method:'POST',body:{id:crypto.randomUUID(),recipientEmail:'synthetic@gmail.com',officeIds:[bundle.offices[0]!.id]}})).json() as {token:string}
  await nativeSignIn(page,'trainer');await nativeRequest(page,'/v1/corporate-invitations/claim',{method:'POST',body:{token:created.token}})
  await nativeSignIn(page,adminKey,'client')
  const list=await(await nativeRequest(page,'/v1/admin/invitations')).json() as {invitations:Array<{id:string}>}
  const duplicate=await nativeRequest(page,'/v1/admin/invitations',{method:'POST',body:{id:crypto.randomUUID(),recipientEmail:'SYNTHETIC@GMAIL.COM',officeIds:[bundle.offices[0]!.id]}})
  expect(duplicate.status).toBe(409);expect(await duplicate.json()).toEqual({error:'corporate_recipient_pending'})
  const approved=await nativeRequest(page,`/v1/admin/invitations/${list.invitations[0]!.id}/approve`,{method:'POST',body:{}});expect(approved.status).toBe(200)
  await page.goto('/admin');await page.getByRole('button',{name:/Настроить тренера/}).click()
  const enabled=page.getByRole('checkbox',{name:'Доступ к тестированию Яндекса',exact:true});await expect(enabled).not.toBeChecked()
  await enabled.check();await page.getByRole('button',{name:'Сохранить тренера',exact:true}).click()
  await expect(page.getByRole('form',{name:/Настройки/})).toHaveCount(0)
  await nativeSignIn(page,'trainer');expect(await(await nativeRequest(page,'/v1/corporate-duties/access')).json()).toMatchObject({allowed:true})
 })
 for(const theme of ['light','dark'])for(const width of [320,1440]){
  test(`visual recipient form and pending account fit ${theme} ${width}`,async({page},info)=>{
   await page.setViewportSize({width,height:900});await page.evaluate(theme=>localStorage.setItem('fit.appTheme',theme),theme);await page.goto('/admin')
   await page.getByRole('button',{name:'Приглашения',exact:true}).click();await page.getByRole('button',{name:'Пригласить тренера',exact:true}).click()
   await page.getByLabel('Почта тренера',{exact:true}).fill('long.contact.address@example.test')
   const input=page.getByLabel('Почта тренера',{exact:true});await expect(input).toBeVisible()
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
   expect((await input.boundingBox())!.width).toBeGreaterThan(150)
   await page.getByRole('button',{name:'Создать приглашение',exact:true}).scrollIntoViewIfNeeded();await expect(page.getByRole('button',{name:'Создать приглашение',exact:true})).toBeVisible()
   await page.screenshot({path:info.outputPath(`recipient-form-${theme}-${width}.png`),fullPage:true})
  })
 }

}
