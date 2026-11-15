import {expect,test} from '@playwright/test'
import {writeFile} from 'node:fs/promises'
import {conversationId,publicTrainerId} from './fit-lime-fixtures'
import {prepareChatSkin,chatOwnMessageId,chatPartnerMessageId,chatContextMessageId,type ChatSkinSample} from './lime-chat-skin.fixture'
import {probeEditorSkin,assertEditorOwnership} from './lime-editor-skin.probe'
import {chatContract} from './lime-chat-skin.contract'

const samples:readonly ChatSkinSample[]=[
 {role:'client',theme:'light',width:390,mode:'list',lime:true},
 {role:'client',theme:'dark',width:430,mode:'list',lime:true},
 {role:'trainer',theme:'light',width:430,mode:'list',lime:true},
 {role:'trainer',theme:'dark',width:1440,mode:'list',lime:true},
 {role:'client',theme:'dark',width:390,mode:'dialog',lime:true},
 {role:'client',theme:'light',width:430,mode:'dialog',lime:true},
 {role:'trainer',theme:'light',width:390,mode:'dialog',lime:true},
 {role:'trainer',theme:'dark',width:1440,mode:'dialog',lime:true},
 {role:'client',theme:'light',width:390,mode:'list-empty',lime:true},
 {role:'trainer',theme:'dark',width:430,mode:'list-empty',lime:true},
 {role:'client',theme:'light',width:390,mode:'list-error',lime:true},
 {role:'trainer',theme:'dark',width:390,mode:'questions-error',lime:true},
 {role:'trainer',theme:'light',width:430,mode:'loading',lime:true},
 {role:'client',theme:'dark',width:430,mode:'dialog-error',lime:true},
 {role:'client',theme:'light',width:390,mode:'dialog-empty',lime:true},
 {role:'client',theme:'light',width:390,mode:'send-retry',lime:true},
 {role:'trainer',theme:'dark',width:430,mode:'send-retry',lime:true},
 {role:'client',theme:'dark',width:390,mode:'actions',lime:true},
 {role:'trainer',theme:'light',width:430,mode:'actions',lime:true},
 {role:'client',theme:'light',width:390,mode:'search',lime:true},
 {role:'trainer',theme:'dark',width:430,mode:'search-error',lime:true},
 {role:'trainer',theme:'light',width:390,mode:'pagination',lime:true},
 {role:'client',theme:'dark',width:390,mode:'photo',lime:true},
 {role:'trainer',theme:'light',width:430,mode:'photo',lime:true},
 {role:'client',theme:'light',width:390,mode:'upload',lime:true},
 {role:'client',theme:'light',width:390,mode:'connection',lime:true},
 {role:'trainer',theme:'dark',width:430,mode:'connection',lime:true},
 {role:'client',theme:'light',width:390,mode:'blocked',lime:true},
 {role:'trainer',theme:'dark',width:430,mode:'blocked',lime:true},
 {role:'client',theme:'light',width:390,mode:'meeting',lime:true},
 {role:'trainer',theme:'dark',width:1440,mode:'meeting',lime:true},
 {role:'client',theme:'dark',width:430,mode:'meeting-error',lime:true},
 {role:'client',theme:'light',width:390,mode:'external-profile',lime:true},
 {role:'trainer',theme:'dark',width:430,mode:'external-profile',lime:true},
 {role:'client',theme:'dark',width:390,mode:'actions',lime:false},
 {role:'trainer',theme:'light',width:430,mode:'actions',lime:false},
]

export function limeChatSkinCases(){
 for(const sample of samples)test(`Chat Lime skin ownership ${sample.role}-${sample.theme}-${sample.width}-${sample.mode}-${sample.lime}`,async({page},info)=>{
  const fixture=await prepareChatSkin(page,sample),external=sample.mode==='external-profile'
  const list=sample.mode.startsWith('list')||sample.mode==='questions-error'||sample.mode==='loading'
  const route=external?`/trainers/${publicTrainerId}`:list?'/chat':`/chat/${conversationId}`
  const selector=external?'.public-trainer-page,.fullscreen-image-viewer':chatContract.selector
  // ClientLimeStandaloneLayout returns the trainer public route directly;
  // only the athlete gets a phone frame. Observe that existing page root.
  const contract=external&&sample.role==='trainer'?{...chatContract,backgroundRootSelector:'.public-trainer-page'}:chatContract
  const states:(Awaited<ReturnType<typeof probeEditorSkin>>&{state:string;url:string})[]=[]
  const probe=async(state:string)=>{
   // The product removes its initial/search highlight after 1600 ms. Observe
   // that real transition before a static capture; never mutate the class,
   // advance its timer, finish animations, or weaken native equality checks.
   await expect(page.locator('.chat-message.highlighted')).toHaveCount(0)
   await page.mouse.move(0,0)
   states.push({...await probeEditorSkin(page,info.outputPath('chat-'+state+'.png'),selector,contract),state,url:new URL(page.url()).pathname+new URL(page.url()).search})
  }
  const composer=page.getByRole('textbox',{name:'Сообщение',exact:true}),own=page.locator(`[data-message-id="${chatOwnMessageId}"]`),partner=page.locator(`[data-message-id="${chatPartnerMessageId}"]`)
  const sheet=page.getByRole('dialog',{name:'Действия с сообщением',exact:true})
  await page.goto(route)
  if(external){
   await page.getByRole('button',{name:'Открыть фото 1 из 2',exact:true}).click();const viewer=page.getByRole('dialog',{name:'Фотографии тренера',exact:true});await expect(viewer).toBeVisible();await probe('external-profile-viewer');await viewer.getByRole('button',{name:'Следующее фото'}).click();await expect(viewer.locator('.fullscreen-image-counter')).toHaveText('2 из 2');await probe('external-profile-next');await viewer.getByRole('button',{name:'Закрыть фото'}).click();await expect(viewer).toHaveCount(0)
  }else if(list){
   await expect(page.getByRole('heading',{name:'Сообщения',level:1})).toBeVisible()
   if(sample.mode==='loading'){await expect.poll(fixture.held).toBeGreaterThan(0);await expect(page.locator('.chat-thread')).toHaveCount(0);await probe('loading');fixture.release();await expect(page.locator('.chat-thread')).toHaveCount(1);await probe('loaded')}
   else if(sample.mode==='list-error'||sample.mode==='questions-error'){
    await expect(page.getByRole('alert').first()).toBeVisible();if(sample.mode==='questions-error')await expect(page.locator('.chat-thread')).toHaveCount(1);await probe(sample.mode);fixture.recover();await page.getByRole('button',{name:'Повторить',exact:true}).click();await expect(page.getByRole('alert')).toHaveCount(0);await expect(page.locator('.chat-thread')).toHaveCount(1);await probe('recovered')
   }else if(sample.mode==='list-empty'){await expect(page.getByText('Диалогов пока нет',{exact:true})).toBeVisible();await probe('empty')}
   else{await expect(page.locator('.chat-thread')).toHaveCount(1);await probe('list');await page.locator('.chat-thread').click();await expect(composer).toBeVisible();await page.getByRole('button',{name:'Назад',exact:true}).click();await expect(page).toHaveURL(/\/chat$/);await expect(page.locator('.chat-thread')).toHaveCount(1)}
  }else if(sample.mode==='dialog-error'){
   await expect(page.getByRole('alert').first()).toBeVisible();await probe('dialog-error');fixture.recover();await page.getByRole('button',{name:'Повторить',exact:true}).click();await expect(composer).toBeVisible();await probe('dialog-recovered')
  }else{
   if(sample.mode==='blocked')await expect(page.getByText('Диалог заблокирован',{exact:true})).toBeVisible()
   else await expect(composer).toBeVisible()
   if(sample.mode==='dialog'||sample.mode==='dialog-empty'){
    await probe('dialog-ready');await composer.fill('Черновик MC56\nВторая строка без потери значения');await expect(composer).toHaveValue('Черновик MC56\nВторая строка без потери значения');await probe('composer-input');await page.getByRole('button',{name:'Назад',exact:true}).click();await expect(page).toHaveURL(/\/chat$/);await page.locator('.chat-thread').click();await expect(composer).toHaveValue('Черновик MC56\nВторая строка без потери значения')
   }else if(sample.mode==='send-retry'){
    await composer.fill('Одно сообщение после повтора');await page.getByRole('button',{name:'Отправить',exact:true}).click();const pending=page.locator('.chat-message.own').filter({hasText:'Одно сообщение после повтора'});await expect(pending.getByText('Ошибка',{exact:true})).toBeVisible();await probe('send-error');await pending.getByRole('button',{name:'Повторить',exact:true}).click();await expect(pending.getByText('Отправлено',{exact:true})).toBeVisible();await expect(pending).toHaveCount(1);await probe('send-recovered');expect(fixture.sendAttempts()).toBe(2);const sends=fixture.writes.filter(write=>write.method==='POST'&&write.path.endsWith('/messages'));expect(sends).toHaveLength(2);expect(sends[0]!.body).toEqual(sends[1]!.body)
   }else if(sample.mode==='actions'){
    await composer.fill('Сохранённый черновик');await partner.click();await expect(sheet).toBeVisible();await probe('partner-actions');await sheet.getByRole('button',{name:'Ответить',exact:true}).click();await expect(page.getByRole('button',{name:'Отменить ответ'})).toBeVisible();await page.getByRole('button',{name:'Отменить ответ'}).click();await expect(composer).toHaveValue('Сохранённый черновик')
    await own.click();await sheet.getByRole('button',{name:'Изменить',exact:true}).click();await expect(composer).toHaveValue('Мой сохранённый ответ');await composer.fill('Отредактированный ответ');await probe('edit-input');await page.getByRole('button',{name:'Сохранить изменения',exact:true}).click();await expect(own).toContainText('Отредактированный ответ');await expect(composer).toHaveValue('Сохранённый черновик')
    await own.click();await sheet.getByRole('button',{name:'Удалить',exact:true}).click();const confirm=page.getByRole('alertdialog');await expect(confirm).toBeVisible();await probe('delete-confirm');await confirm.getByRole('button',{name:'Отмена',exact:true}).click();await expect(own).toBeVisible();expect(fixture.writes.filter(write=>write.method==='DELETE')).toHaveLength(0);await own.click();await sheet.getByRole('button',{name:'Удалить',exact:true}).click();await confirm.getByRole('button',{name:'Удалить',exact:true}).click();await expect(own).toHaveCount(0);expect(fixture.writes.filter(write=>write.method==='DELETE')).toHaveLength(1);await expect(composer).toHaveValue('Сохранённый черновик')
   }else if(sample.mode==='search'||sample.mode==='search-error'){
    await page.getByRole('button',{name:'Поиск по переписке'}).click();const search=page.getByRole('region',{name:'Поиск по переписке'}),field=search.getByRole('searchbox',{name:'Текст для поиска'});await field.fill('восстановление');await search.getByRole('button',{name:'Найти',exact:true}).click()
    if(sample.mode==='search-error'){await expect(search.getByRole('alert')).toBeVisible();await probe('search-error');fixture.recover();await search.getByRole('button',{name:'Повторить'}).click()}
    await expect(search.locator('.chat-search-results > button')).toHaveCount(1);await probe('search-results');await search.locator('.chat-search-results > button').click();await expect(search).toHaveCount(0);await expect(page.locator(`[data-message-id="${chatContextMessageId}"]`)).toBeVisible();await page.getByRole('button',{name:'Поиск по переписке'}).click();await field.fill('пусто');await search.getByRole('button',{name:'Найти',exact:true}).click();await expect(search.getByText('Ничего не найдено')).toBeVisible();await probe('search-empty');await page.getByRole('button',{name:'Закрыть поиск'}).click();await expect(search).toHaveCount(0)
   }else if(sample.mode==='pagination'){
    await page.getByRole('button',{name:'Ранее',exact:true}).click();await expect(page.getByText('Не удалось загрузить ранние сообщения')).toBeVisible();await probe('older-error');fixture.recover();await page.getByRole('button',{name:'Повторить загрузку ранних сообщений'}).click();await expect(page.locator(`[data-message-id="${chatContextMessageId}"]`)).toHaveCount(1);await expect(page.getByRole('button',{name:'Ранее',exact:true})).toHaveCount(0);await probe('older-recovered')
   }else if(sample.mode==='photo'){
    await page.getByRole('button',{name:'Открыть фото',exact:true}).click();const viewer=page.getByRole('dialog',{name:'Просмотр фото',exact:true});await expect(viewer).toBeVisible();await probe('photo-viewer');await viewer.getByRole('button',{name:'Увеличить'}).click();await expect(viewer.locator('.fullscreen-image-controls')).toContainText('150%');await probe('photo-zoom');await viewer.getByRole('button',{name:'Уменьшить'}).click();await viewer.locator('.fullscreen-image-stage').dispatchEvent('touchstart',{touches:[{identifier:1,clientX:150,clientY:220}]});await viewer.locator('.fullscreen-image-stage').dispatchEvent('touchend',{touches:[],changedTouches:[{identifier:1,clientX:150,clientY:350}]});await expect(viewer).toHaveCount(0);await expect(composer).toBeVisible()
   }else if(sample.mode==='upload'){
    await page.getByLabel('Выбрать фото',{exact:true}).setInputFiles('public/exercises/reference/close-grip-lat-pulldown.jpg');await expect(page.getByRole('img',{name:'Фото для отправки'})).toBeVisible();await composer.fill('Подпись к фото');await probe('photo-preview');await page.getByRole('button',{name:'Убрать фото'}).click();await expect(page.getByRole('img',{name:'Фото для отправки'})).toHaveCount(0);await expect(composer).toHaveValue('Подпись к фото');await page.getByLabel('Выбрать фото',{exact:true}).setInputFiles('public/exercises/reference/close-grip-lat-pulldown.jpg');await expect(page.getByRole('img',{name:'Фото для отправки'})).toBeVisible();await page.getByRole('button',{name:'Отправить',exact:true}).click();await expect(page.locator('.chat-message.own.with-photo')).toHaveCount(1);expect(fixture.messages().at(-1)?.image?.mimeType).toBe('image/jpeg');await probe('photo-sent')
   }else if(sample.mode==='connection'){
    const connection=page.getByRole('region',{name:'Связь с тренером'});await expect(connection).toBeVisible();await probe('disconnected')
    if(sample.role==='trainer'){await connection.getByRole('button',{name:'Предложить тренировки'}).click();await expect(connection).toContainText('Приглашение отправлено');await probe('invitation-pending')}
    else{await connection.getByRole('button',{name:'Подключиться',exact:true}).click();const consent=page.getByRole('region',{name:'Подтверждение подключения'});await expect(consent).toBeVisible();await probe('connection-consent');await consent.getByRole('button',{name:'Подключить тренера',exact:true}).click();await expect(connection).toHaveCount(0)}
   }else if(sample.mode==='blocked'){
    await expect(composer).toHaveCount(0);await probe('blocked');await page.getByRole('button',{name:'Разблокировать',exact:true}).click();await expect(composer).toBeVisible();await page.getByRole('button',{name:'Действия с диалогом'}).click();await expect(page.getByRole('menu')).toBeVisible();await probe('dialog-menu');await page.getByRole('menuitem',{name:'Заблокировать',exact:true}).click();await expect(page.getByRole('alertdialog')).toBeVisible();await probe('block-confirm');await page.getByRole('alertdialog').getByRole('button',{name:'Отмена',exact:true}).click();await expect(composer).toBeVisible();expect(fixture.writes.filter(write=>write.path.endsWith('/block')).map(write=>write.body)).toEqual([{blocked:false}])
   }else if(sample.mode.startsWith('meeting')){
    await composer.fill('Черновик до встречи');await page.getByRole('button',{name:'Видеовстреча',exact:true}).click();const meeting=page.getByRole('dialog',{name:'Видеовстреча',exact:true})
    if(sample.mode==='meeting-error'){await expect(meeting.getByRole('button',{name:'Повторить',exact:true})).toBeVisible();await probe('meeting-error');await meeting.getByRole('button',{name:'Вернуться в чат',exact:true}).first().click();await expect(meeting).toHaveCount(0)}
    else{
     await expect(meeting.getByRole('button',{name:'Присоединиться',exact:true})).toBeVisible();await probe('meeting-preview');expect(fixture.writes.filter(write=>write.path.endsWith('/meeting'))).toHaveLength(0);await meeting.getByRole('button',{name:'Выключить микрофон'}).click();await expect(meeting.getByRole('button',{name:'Включить микрофон'})).toHaveAttribute('aria-pressed','true');await meeting.getByRole('button',{name:'Присоединиться',exact:true}).click();await expect(meeting.getByRole('button',{name:'Выйти из встречи'})).toBeVisible();await probe('meeting-joined');await meeting.getByRole('button',{name:'Выйти из встречи'}).click();await expect(meeting).toHaveCount(0);await expect(page.locator('.chat-meeting-card')).toContainText('Встреча завершена');expect(fixture.writes.filter(write=>write.path.endsWith('/meeting')).map(write=>(write.body as{action:string}).action)).toEqual(['prepare','joined','leave'])
    }
    await expect(composer).toHaveValue('Черновик до встречи')
   }
  }
  expect(states.length).toBeGreaterThan(0);expect(fixture.historyUnchanged()).toBe(true);expect(fixture.diagnostics).toEqual([])
  const persisted=await page.evaluate(({actor,id})=>({draft:localStorage.getItem(`fit:chat-draft:${actor}:${id}`),pending:localStorage.getItem(`fit:chat-pending:${actor}:${id}`)}),{actor:fixture.actor,id:conversationId})
  await writeFile(info.outputPath('chat-skin.json'),JSON.stringify({sample,route,states,writes:fixture.writes,reads:fixture.reads,diagnostics:fixture.diagnostics,initialMessages:fixture.initialMessages,finalMessages:fixture.messages(),persisted,historyUnchanged:fixture.historyUnchanged()}))
  for(const state of states){
   if(external){expect(state.owners).toEqual([]);continue}
   if(sample.lime&&process.env.FIT_CHAT_SKIN_BASELINE==='1'){
    expect(state.owners).toEqual([]);expect(state.matches.length+state.ancestorMatches.length+state.pseudoMatches.length).toBeGreaterThan(0)
   }else assertEditorOwnership(state,sample.lime,chatContract)
  }
 })
}
