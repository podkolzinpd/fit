import {test,expect,nativeSignIn,nativeRequest} from './native-local-fixture'
import {publicTrainerDraft} from './fit-lime-fixtures'
const adminKey='corporate-profile-admin'
test.beforeEach(async({page,nativeApi})=>{
 await page.routeWebSocket('**/*',socket=>socket.close())
 const allowed=new Set([new URL(String(test.info().project.use.baseURL)).origin,new URL(nativeApi).origin,'http://127.0.0.1:4100'])
 await page.context().route('**/*',route=>allowed.has(new URL(route.request().url()).origin)?route.fallback():route.abort('blockedbyclient'))
 await nativeSignIn(page,'trainer')
 const saved=await nativeRequest(page,'/v1/trainer-profile',{method:'PUT',body:publicTrainerDraft});expect(saved.status).toBe(200)
 await nativeSignIn(page,adminKey,'client','Тестовый администратор')
 const configured=await fetch(nativeApi+'/__fixtures/corporate-profile',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({trainerKey:'trainer',adminKey})})
 expect(configured.status).toBe(200)
})
test('native admin edits an existing draft and explicitly publishes the same stable public profile',async({page})=>{
 await page.goto('/admin')
 await page.getByRole('button',{name:/Редактировать анкету/}).click()
 await page.getByRole('button',{name:'Редактировать',exact:true}).click()
 await page.getByLabel('О себе').fill('Проверенное исправление администратора')
 await page.getByRole('button',{name:'Сохранить',exact:true}).click()
 await expect(page.getByText('Проверенное исправление администратора',{exact:true})).toBeVisible()
 await page.getByRole('button',{name:'Опубликовать',exact:true}).click()
 await page.getByRole('alertdialog').getByRole('button',{name:'Опубликовать',exact:true}).click()
 await expect(page.getByRole('button',{name:'Снять с публикации'})).toBeVisible()
 const bundle=await(await nativeRequest(page,'/v1/admin/bundle')).json() as {trainers:Array<{id:string;publicId:string}>}
 const target=bundle.trainers[0]!
 const publicProfile=await(await nativeRequest(page,`/v1/trainers/${target.publicId}/public-profile`)).json() as {publicId:string;published:{bio:string}}
 expect(publicProfile.publicId).toBe(target.publicId);expect(publicProfile.published.bio).toBe('Проверенное исправление администратора')
 await page.getByText('История изменений анкеты',{exact:true}).click()
 await expect(page.locator('.corporate-profile-history').getByText('Тестовый администратор',{exact:true}).first()).toBeVisible()
})
test('native owner gets read-only UI and direct HTTP denial after the admin management switch',async({page})=>{
 await page.goto('/admin');await page.getByRole('button',{name:/Редактировать анкету/}).click()
 await page.getByRole('switch',{name:'Анкетой управляет администратор'}).click()
 await page.getByRole('button',{name:'Передать управление',exact:true}).click()
 await expect(page.getByRole('switch',{name:'Анкетой управляет администратор'})).toBeChecked()
 await nativeSignIn(page,'trainer');await page.goto('/profile')
 await expect(page.getByText('Анкетой управляет администратор',{exact:true})).toBeVisible()
 await expect(page.getByRole('button',{name:'Редактировать',exact:true})).toHaveCount(0)
 const forbidden=await nativeRequest(page,'/v1/trainer-profile/publish',{method:'POST',body:{}})
 expect(forbidden.status).toBe(403)
})
test('native status removal resets mode and restores the owner editor without changing the draft',async({page})=>{
 const bundle=await(await nativeRequest(page,'/v1/admin/bundle')).json() as {trainers:Array<{id:string;version:number;officeIds:string[]}>};const trainer=bundle.trainers[0]!
 const managed=await nativeRequest(page,`/v1/admin/trainers/${trainer.id}/profile/management`,{method:'POST',body:{managed:true,version:0,commandId:crypto.randomUUID()}});expect(managed.status).toBe(200)
 const removed=await nativeRequest(page,'/v1/admin/trainers',{method:'PUT',body:{id:trainer.id,version:trainer.version,officeIds:trainer.officeIds,isYandex:false}});expect(removed.status).toBe(200)
 await nativeSignIn(page,'trainer');await page.goto('/profile')
 await expect(page.getByRole('button',{name:'Редактировать',exact:true})).toBeVisible()
 const profile=await(await nativeRequest(page,'/v1/trainer-profile')).json() as {draft:{bio:string};profileManagement:{managedByAdmin:boolean;available:boolean}}
 expect(profile.profileManagement).toMatchObject({managedByAdmin:false,available:false});expect(profile.draft.bio).toBe(publicTrainerDraft.bio)
})
