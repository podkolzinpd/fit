import {expect,test,type Page} from '@playwright/test'
import {mockPilot,publicTrainerDraft,trainerId,publicTrainerId} from './fit-lime-fixtures'
import {nativeAiUrl} from './native-ai-fixture'
import type {TrainerProfessionalProfile,TrainerProfileManagement} from '../src/shared/domain'
let unexpected:string[]=[]
async function setup(page:Page,o:{managed?:boolean;pilot?:boolean;missing?:boolean;conflict?:boolean;denied?:boolean;photoFailure?:boolean}={}){
 const origin=new URL(nativeAiUrl('/')).origin
 await page.route('**/*',route=>{const r=route.request(),u=new URL(r.url());if(u.origin===origin&&['GET','HEAD'].includes(r.method())&&!/^\/(v1|api)\//.test(u.pathname))return route.fallback();unexpected.push(`${r.method()} ${u.pathname}`);return route.abort('blockedbyclient')})
 await page.routeWebSocket('**/*',socket=>socket.close())
 await mockPilot(page,{role:'trainer',fitLime:false,pilot:false,workouts:[]})
 const syntheticDraft={...publicTrainerDraft,photos:publicTrainerDraft.photos.map(photo=>({...photo,url:origin+'/assets/startup-photo-983c93dc4df8.jpg',thumbnailUrl:origin+'/assets/startup-photo-983c93dc4df8.jpg'}))}
 let profile:TrainerProfessionalProfile|null=o.missing?null:{publicId:publicTrainerId,draft:{...syntheticDraft,bio:'Черновик тренера'},published:{...syntheticDraft,bio:'Опубликованное описание'},listedInCatalog:true,publishedAt:'2026-11-09T10:00:00Z',updatedAt:'2026-11-09T10:00:00Z',version:4,isBrandTrainer:false}
 let management:TrainerProfileManagement={available:o.pilot!==false,managedByAdmin:o.managed===true,version:2}
 const writes:Array<Record<string,unknown>>=[],receipts=new Map<string,unknown>();let conflict=o.conflict
 await page.route('**/v1/admin/access',route=>route.fulfill({json:{allowed:!o.denied}}))
 await page.route('**/v1/admin/bundle',route=>route.fulfill({json:{offices:[],trainers:[{id:trainerId,name:'Тестовый тренер',isYandex:true,officeIds:[],version:1,profileEditingAvailable:o.pilot!==false}]}}))
 const read=()=>({profile,management})
 await page.route(/\/v1\/admin\/trainers\/[^/]+\/profile(?:\/|$)/,async route=>{
  const request=route.request(),path=new URL(request.url()).pathname
  if(request.method()==='GET')return route.fulfill({json:path.endsWith('/history')?{entries:[]}:read()})
  const body=request.postDataJSON() as Record<string,unknown>;writes.push(body)
  if(path.endsWith('/management')){management={...management,managedByAdmin:body.managed===true,version:management.version+1};return route.fulfill({json:management})}
  if(conflict){conflict=false;if(profile)profile={...profile,version:5};return route.fulfill({status:409,json:{error:'corporate_profile_conflict'}})}
  const commandId=String(body.commandId)
  if(receipts.has(commandId))return route.fulfill({json:receipts.get(commandId)})
  if(body.action==='save')profile={...(profile??{publicId:publicTrainerId,published:null,listedInCatalog:false,publishedAt:null,updatedAt:'2026-11-09T10:00:00Z',version:0,isBrandTrainer:false}),draft:body.draft as TrainerProfessionalProfile['draft'],version:(profile?.version??0)+1}
  else if(body.action==='publish'&&profile)profile={...profile,published:profile.draft,version:profile.version+1}
  else if(body.action==='unpublish'&&profile)profile={...profile,published:null,listedInCatalog:false,publishedAt:null,version:profile.version+1}
  else if(body.action==='catalog'&&profile)profile={...profile,listedInCatalog:body.listed===true,version:profile.version+1}
  receipts.set(commandId,profile);return route.fulfill({json:profile})
 })
 await page.route('**/v1/corporate-services/access',route=>route.fulfill({json:{allowed:false}}))
 await page.route('**/v1/corporate-duties/access',route=>route.fulfill({json:{allowed:false,hasHistory:false,active:null,offices:[]}}))
 await page.route('**/v1/trainer-profile/access',route=>route.fulfill({json:management}))
 await page.route('**/v1/trainer-profile',route=>route.fulfill({json:profile}))
 if(o.photoFailure&&profile){profile={...profile,draft:{...profile.draft,photos:[{id:'11111111-1111-4111-8111-111111111111',url:origin+'/broken-photo.svg',thumbnailUrl:origin+'/broken-photo.svg',mimeType:'image/jpeg',width:10,height:10}]}};await page.route('**/broken-photo.svg',route=>route.fulfill({status:404,body:''}))}
 return {writes,get profile(){return profile},get management(){return management},setManaged:(v:boolean)=>{management={...management,managedByAdmin:v,version:management.version+1}}}
}
async function open(page:Page){await page.goto(nativeAiUrl('/admin'));await page.getByRole('button',{name:/Редактировать анкету/}).click()}
async function noOverflow(page:Page){await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)}
function safety(){test.beforeEach(()=>{unexpected=[]});test.afterEach(()=>{expect(unexpected,'Real API/WS/external requests denied; synthetic responses only').toEqual([])})}
export function registerCorporateProfileCases(){safety()
 test('admin saves without publishing, preserving the public snapshot and explicit target versions',async({page})=>{
  const f=await setup(page);await open(page);await page.getByRole('button',{name:'Редактировать',exact:true}).click();await page.getByLabel('О себе').fill('Исправленный черновик');await page.getByRole('button',{name:'Сохранить',exact:true}).click()
  await page.locator('.trainer-professional-embedded > .trainer-card .trainer-card-disclosure > summary').first().click();await expect(page.getByText('Исправленный черновик',{exact:true})).toBeVisible();expect(f.profile?.published?.bio).toBe('Опубликованное описание');await expect.poll(()=>f.writes.length).toBe(1);expect(f.writes[0]).toMatchObject({action:'save',version:4,managementVersion:2})
 })
 test('switch requires confirmation, changes no profile content and publishes nothing',async({page})=>{
  const f=await setup(page);await open(page);await page.getByRole('switch',{name:'Анкетой управляет администратор'}).click();expect(f.writes).toHaveLength(0)
  await page.getByRole('button',{name:'Передать управление',exact:true}).click();await expect(page.getByRole('switch',{name:'Анкетой управляет администратор'})).toBeChecked();expect(f.writes).toHaveLength(1);expect(f.profile?.draft.bio).toBe('Черновик тренера')
 })
 test('nonpilot Yandex has no private editor entry',async({page})=>{await setup(page,{pilot:false});await page.goto(nativeAiUrl('/admin'));await expect(page.getByRole('button',{name:'Настроить тренера Тестовый тренер'})).toBeVisible();await expect(page.getByRole('button',{name:/Редактировать анкету/})).toHaveCount(0)})
 test('unauthorized account sees no cabinet controls',async({page})=>{await setup(page,{denied:true});await page.goto(nativeAiUrl('/admin'));await expect(page.getByRole('heading',{name:'Нет доступа'})).toBeVisible();await expect(page.getByRole('button',{name:/Редактировать анкету/})).toHaveCount(0)})
 test('mode can be stored before a profile exists; creation is explicit',async({page})=>{
  const f=await setup(page,{missing:true});await open(page);await page.getByRole('switch',{name:'Анкетой управляет администратор'}).click();await page.getByRole('button',{name:'Передать управление',exact:true}).click();expect(f.profile).toBeNull()
  await page.getByRole('button',{name:'Заполнить анкету'}).click();await page.getByLabel('О себе').fill('Новая анкета');await page.getByRole('button',{name:'Сохранить',exact:true}).click();await page.locator('.trainer-professional-embedded > .trainer-card .trainer-card-disclosure > summary').first().click();await expect(page.getByText('Новая анкета',{exact:true})).toBeVisible();expect(f.profile?.published).toBeNull()
 })
 test('conflict retains typed data, original CAS token and exact retry command id',async({page})=>{
  const f=await setup(page,{conflict:true});await open(page);await page.getByRole('button',{name:'Редактировать',exact:true}).click();await page.getByLabel('О себе').fill('Не потерять');await page.getByRole('button',{name:'Сохранить',exact:true}).click();await expect(page.getByRole('alert')).toContainText('уже изменились');await expect(page.getByLabel('О себе')).toHaveValue('Не потерять');await page.getByRole('button',{name:'Сохранить',exact:true}).click();await expect.poll(()=>f.writes.length).toBe(2);expect(f.writes[1]?.commandId).toBe(f.writes[0]?.commandId);expect(f.writes[1]?.version).toBe(4)
 })
 test('closing a dirty editor can be cancelled without losing text',async({page})=>{await setup(page);await open(page);await page.getByRole('button',{name:'Редактировать',exact:true}).click();await page.getByLabel('О себе').fill('Сохранить в форме');await page.getByRole('button',{name:'Закрыть анкету'}).click();await page.getByRole('alertdialog').getByRole('button',{name:'Отмена',exact:true}).click();await expect(page.getByLabel('О себе')).toHaveValue('Сохранить в форме')})
 test('route navigation asks before discarding an administrator draft',async({page})=>{await setup(page);await open(page);await page.getByRole('button',{name:'Редактировать',exact:true}).click();await page.getByLabel('О себе').fill('Не уходить без предупреждения');await page.getByRole('button',{name:'Офисы',exact:true}).click();await page.getByRole('alertdialog').getByRole('button',{name:'Остаться',exact:true}).click();await expect(page.getByLabel('О себе')).toHaveValue('Не уходить без предупреждения')})
 test('owner read-only notice exposes no mutation controls',async({page})=>{await setup(page,{managed:true});await page.goto(nativeAiUrl('/profile'));await expect(page.getByText('Анкетой управляет администратор',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Редактировать',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Снять с публикации'})).toHaveCount(0);await expect(page.locator('.trainer-profile-management-notice')).toHaveCSS('display','grid')})
 test('expired photograph produces a visible recovery action',async({page})=>{await setup(page,{photoFailure:true});await open(page);await expect(page.getByRole('alert')).toContainText('Фото недоступно');await expect(page.getByRole('button',{name:'Загрузить актуальную анкету'})).toBeVisible()})
}
export function registerCorporateProfileVisualCases(){safety()
 // Geometry, long controls and focus differ with viewport; this matrix asserts
 // only visual states. Functional contracts above are not repeated per theme.
 for(const theme of ['light','dark'])for(const width of [320,1440])test(`profile visual ${theme} ${width}`,async({page},info)=>{
  await page.setViewportSize({width,height:width===320?900:1000})
  await page.addInitScript(theme=>{localStorage.setItem('fit.appTheme',theme)},theme)
  await setup(page,{managed:true});await open(page);await expect(page.locator('.corporate-admin-shell')).toHaveClass(theme==='light'?/theme-light/:/corporate-admin-shell/);await page.getByRole('button',{name:'Редактировать',exact:true}).click();await noOverflow(page)
  await expect(page.locator('.trainer-profile-form-disclosure > summary svg').first()).toHaveCSS('width','18px')
  await expect.poll(()=>page.locator('.corporate-profile-editor').evaluate(el=>[...el.querySelectorAll('.switch-control,.trainer-profile-edit-card')].every(item=>{const r=item.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1}))).toBe(true)
  await page.screenshot({path:info.outputPath('admin-form.png'),fullPage:true})
  await page.getByRole('button',{name:'Сохранить',exact:true}).scrollIntoViewIfNeeded()
  await expect(page.getByRole('button',{name:'Сохранить',exact:true})).toBeVisible()
  await expect(page.getByRole('button',{name:'Отмена',exact:true})).toBeVisible()
  await page.screenshot({path:info.outputPath('admin-form-bottom.png'),fullPage:true})
  await page.goto(nativeAiUrl('/profile'));await expect(page.getByText('Анкетой управляет администратор',{exact:true})).toBeVisible();await noOverflow(page)
  const hint=page.getByRole('button',{name:'Понятно',exact:true});if(await hint.isVisible())await hint.click()
  await expect(page.getByText('Не удалось обновить доступные разделы.')).toHaveCount(0)
  await page.screenshot({path:info.outputPath('owner-read-only.png'),fullPage:true})
 })
}
