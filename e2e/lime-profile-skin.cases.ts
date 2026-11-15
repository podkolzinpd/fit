import {expect,test} from '@playwright/test'
import {writeFile} from 'node:fs/promises'
import {prepareProfileSkin,type ProfileSkinSample} from './lime-profile-skin.fixture'
import {probeEditorSkin,assertEditorOwnership} from './lime-editor-skin.probe'
import {profileContract} from './lime-profile-skin.contract'
import {clientId} from './fit-lime-fixtures'

const samples:readonly ProfileSkinSample[]=[
 {role:'client',theme:'light',width:390,mode:'profile',lime:true},
 {role:'client',theme:'dark',width:430,mode:'profile',lime:true},
 {role:'client',theme:'light',width:375,mode:'long',lime:true},
 {role:'client',theme:'dark',width:1440,mode:'profile',lime:true},
 {role:'client',theme:'light',width:390,mode:'sports',lime:true},
 {role:'client',theme:'dark',width:430,mode:'goal',lime:true},
 {role:'client',theme:'light',width:390,mode:'photo',lime:true},
 {role:'client',theme:'dark',width:375,mode:'no-client',lime:true},
 {role:'client',theme:'light',width:390,mode:'load-error',lime:true},
 {role:'client',theme:'dark',width:390,mode:'edit',lime:true},
 {role:'client',theme:'light',width:430,mode:'edit-save',lime:true},
 {role:'client',theme:'dark',width:375,mode:'edit-validation',lime:true},
 {role:'client',theme:'light',width:390,mode:'settings',lime:true},
 {role:'client',theme:'dark',width:430,mode:'settings',lime:true},
 {role:'client',theme:'dark',width:375,mode:'training',lime:true},
 {role:'client',theme:'light',width:390,mode:'appearance',lime:true},
 {role:'client',theme:'light',width:390,mode:'feedback',lime:true},
 {role:'client',theme:'dark',width:430,mode:'install',lime:true},
 {role:'client',theme:'dark',width:375,mode:'connections',lime:true},
 {role:'client',theme:'light',width:390,mode:'invite',lime:true},
 {role:'client',theme:'dark',width:430,mode:'finance',lime:true},
 {role:'client',theme:'light',width:390,mode:'notify-working',lime:true},
 {role:'client',theme:'dark',width:430,mode:'notify-error',lime:true},
 {role:'trainer',theme:'dark',width:390,mode:'profile',lime:true},
 {role:'trainer',theme:'dark',width:390,mode:'capability-error',lime:true},
 {role:'trainer',theme:'light',width:430,mode:'profile',lime:true},
 {role:'trainer',theme:'dark',width:1440,mode:'profile',lime:true},
 {role:'trainer',theme:'dark',width:375,mode:'empty',lime:true},
 {role:'trainer',theme:'dark',width:390,mode:'readonly',lime:true},
 {role:'trainer',theme:'dark',width:390,mode:'editor',lime:true},
 {role:'trainer',theme:'light',width:430,mode:'editor-save',lime:true},
 {role:'trainer',theme:'dark',width:375,mode:'editor-details',lime:true},
 {role:'trainer',theme:'dark',width:390,mode:'metro',lime:true},
 {role:'trainer',theme:'dark',width:430,mode:'photo',lime:true},
 {role:'trainer',theme:'dark',width:390,mode:'photos',lime:true},
 {role:'trainer',theme:'light',width:430,mode:'legacy-photo',lime:true},
 {role:'trainer',theme:'dark',width:375,mode:'specialties',lime:true},
 {role:'trainer',theme:'dark',width:375,mode:'metro-more',lime:true},
 {role:'trainer',theme:'dark',width:390,mode:'published',lime:true},
 {role:'trainer',theme:'dark',width:375,mode:'unpublish',lime:true},
 {role:'trainer',theme:'light',width:430,mode:'publication-error',lime:true},
 {role:'trainer',theme:'dark',width:390,mode:'settings',lime:true},
 {role:'trainer',theme:'dark',width:430,mode:'training',lime:true,section:'training'},
 {role:'trainer',theme:'light',width:390,mode:'schedule',lime:true,section:'schedule'},
 {role:'trainer',theme:'dark',width:375,mode:'appearance',lime:true,section:'appearance'},
 {role:'trainer',theme:'dark',width:430,mode:'account-save',lime:true,section:'account'},
 {role:'trainer',theme:'light',width:390,mode:'account-cancel',lime:true,section:'account'},
 {role:'trainer',theme:'dark',width:375,mode:'help',lime:true,section:'help'},
 {role:'trainer',theme:'dark',width:390,mode:'feedback',lime:true,section:'feedback'},
 {role:'trainer',theme:'dark',width:430,mode:'install',lime:true,section:'install'},
 {role:'trainer',theme:'dark',width:375,mode:'notifications',lime:true,section:'notifications'},
 {role:'trainer',theme:'light',width:390,mode:'load-error',lime:true},
 {role:'trainer',theme:'dark',width:390,mode:'notify-working',lime:true,section:'notifications'},
 {role:'trainer',theme:'light',width:430,mode:'notify-error',lime:true,section:'notifications'},
 {role:'client',theme:'dark',width:375,mode:'profile',lime:true,reference:false},
 {role:'client',theme:'dark',width:390,mode:'settings',lime:true,reference:false},
 {role:'client',theme:'light',width:375,mode:'edit',lime:true,reference:false},
 {role:'client',theme:'dark',width:390,mode:'profile',lime:false},
 {role:'trainer',theme:'dark',width:390,mode:'profile',lime:false},
 {role:'trainer',theme:'dark',width:430,mode:'external-edit',lime:true},
 {role:'trainer',theme:'dark',width:390,mode:'external-services',lime:true},
]

export function limeProfileSkinCases(){
 for(const sample of samples)test(`Profile Lime skin ownership ${sample.role}-${sample.theme}-${sample.width}-${sample.mode}-${sample.lime}`,async({page},info)=>{
  const fixture=await prepareProfileSkin(page,sample),external=sample.mode.startsWith('external-')
  const settings=sample.mode.startsWith('notify-')||['settings','training','appearance','feedback','install','schedule','account-save','account-cancel','help','notifications'].includes(sample.mode)
  const edit=sample.role==='client'&&sample.mode.startsWith('edit')
  const route=sample.mode==='external-edit'?`/clients/${clientId}/edit`:sample.mode==='external-services'?'/profile/yandex-services':sample.role==='client'?(edit?'/me/edit':settings?'/me/settings':'/me/profile'):settings?'/profile/settings'+(sample.section?'?section='+sample.section:''):'/profile'
  const selector=external?'.content,.tab-bar':profileContract.selector
  const states:(Awaited<ReturnType<typeof probeEditorSkin>>&{state:string;url:string})[]=[]
  const probe=async(state:string)=>{await page.mouse.move(0,0);states.push({...await probeEditorSkin(page,info.outputPath('profile-'+state+'.png'),selector,profileContract),state,url:new URL(page.url()).pathname+new URL(page.url()).search+new URL(page.url()).hash})}
  const content=page.locator('.content'),profile=page.getByRole('region',{name:'Анкета тренера',exact:true})
  const editor=()=>page.getByRole('form',{name:'Редактирование анкеты тренера',exact:true})
  const openEditor=async()=>{await profile.getByRole('button',{name:/^(Редактировать|Заполнить анкету)$/}).click();await expect(editor()).toBeVisible()}
  const ready=async()=>{
   if(external){await expect(content).toBeVisible();await expect(page.locator('.client-profile-page,.client-self-edit-page,.profile-page')).toHaveCount(0);return}
   if(settings){await expect(page.getByRole('heading',{level:1})).toBeVisible();return}
   if(edit){await expect(page.getByLabel('Имя',{exact:true})).toHaveValue('Алексей Смирнов');return}
   if(sample.role==='client'){if(sample.lime)await expect(page.getByRole('region',{name:'Мои данные'})).toBeVisible();else await expect(page.locator('.client-profile-card').first()).toBeVisible()}
   else await expect(profile).toBeVisible()
  }
  await page.goto(route)
  if(sample.mode==='load-error'){
   await expect(page.getByRole('alert').first()).toBeVisible();await probe('load-error');fixture.recoverQuery();await page.getByRole('button',{name:'Повторить',exact:true}).first().click();await ready();await probe('load-recovered')
  }else if(sample.mode==='no-client'){
   await expect(page.getByRole('heading',{level:1,name:'Профиль'})).toBeVisible();await expect(page.getByRole('region',{name:'Мои данные'})).toHaveCount(0);await probe('no-client')
  }else{
   await ready()
   if(external||sample.mode==='profile'||sample.mode==='capability-error'||sample.mode==='long'||sample.mode==='empty'||sample.mode==='readonly'||sample.mode==='published'||sample.mode==='settings'||sample.mode==='notifications'||sample.mode==='help'){
    if(sample.mode==='readonly')await expect(profile.getByRole('form')).toHaveCount(0)
    if(sample.mode==='long')await expect(page.getByRole('region',{name:'Мои данные'})).toContainText('Смирнов-Задонский')
    if(sample.mode==='published'){await profile.locator('.trainer-publication-disclosure > summary').click();await expect(profile.getByRole('switch',{name:'Показывать в каталоге'})).toBeChecked()}
    await probe(sample.mode)
   }else if(sample.mode==='sports'){
    const sports=page.locator('.athlete-sport-card');await expect(sports.locator('.athlete-sport-tag')).toHaveCount(6);await sports.getByRole('button',{name:/Показать ещё/}).click();await expect(sports.locator('.athlete-sport-tag')).toHaveCount(8);await probe('sports-expanded');await sports.getByRole('button',{name:'Свернуть'}).click();await expect(sports.locator('.athlete-sport-tag')).toHaveCount(6);await probe('sports-collapsed')
   }else if(sample.mode==='goal'){
    const goal=page.getByRole('region',{name:'Моя цель'});await goal.getByText(/Все подцели/).click();await expect(goal.locator('li')).toHaveCount(1);await probe('goal-expanded');await goal.getByText(/Все подцели/).click();await probe('goal-collapsed')
   }else if(sample.mode==='invite'){
    const connections=page.getByRole('region',{name:'Связь с тренером'});await expect(connections.getByRole('heading',{name:'Найдите своего тренера'})).toBeVisible();await probe('no-trainer');await connections.getByRole('button',{name:'Пригласить тренера',exact:true}).click();const dialog=page.locator('.invitation-share-dialog');await expect(dialog).toBeVisible();await probe('invitation-dialog');await dialog.getByRole('button',{name:'Показать QR-код',exact:true}).click();await expect(dialog.getByRole('img',{name:'QR-код приглашения в Fit'})).toBeVisible();await probe('invitation-qr');await dialog.getByRole('button',{name:'Отменить приглашение',exact:true}).click();await expect(page.getByRole('alertdialog')).toBeVisible();await probe('invitation-revoke-confirm');await page.getByRole('alertdialog').getByRole('button',{name:'Отмена',exact:true}).click();await dialog.getByRole('button',{name:'Закрыть',exact:true}).click();await expect(connections.locator('.client-home-invitations article')).toHaveCount(1);await probe('active-invitation')
   }else if(sample.mode==='finance'){
    const finance=page.locator('.client-finance-home');await expect(finance.locator('.client-finance-home-row').first()).toBeVisible();await probe('finance-populated')
   }else if(sample.mode==='connections'){
    const connections=page.getByRole('region',{name:'Связь с тренером'});await connections.getByRole('button',{name:/Действия с тренером/}).click();await expect(page.getByRole('menu')).toBeVisible();await probe('connection-menu');await page.getByRole('menuitem',{name:'Отключить'}).click();await expect(page.getByRole('alertdialog')).toBeVisible();await probe('connection-confirm');await page.getByRole('alertdialog').getByRole('button',{name:'Отмена'}).click();await expect(page.getByRole('alertdialog')).toHaveCount(0);await expect(connections.locator('.client-trainer-connection-card')).toHaveCount(1)
   }else if(edit){
    const name=page.getByLabel('Имя',{exact:true});await probe('edit-ready')
    if(sample.mode==='edit-validation'){await name.fill('');await page.getByRole('button',{name:'Сохранить',exact:true}).click();await expect(page.locator('.client-profile-form .field-error').or(page.locator('.client-profile-form .error')).first()).toBeVisible();await probe('edit-invalid')}
    else{
     await name.fill('Алексей MC54');await page.getByLabel('Рост, см').fill('182.5');await page.getByRole('textbox',{name:'Цель',exact:true}).fill('Сохраняемый текст цели MC54');await probe('edit-input')
     if(sample.mode==='edit-save'){
      await page.getByRole('button',{name:'Сохранить',exact:true}).click();await expect.poll(()=>fixture.held()).toBe(1);await expect(page.getByRole('button',{name:'Отмена',exact:true})).toBeDisabled();await probe('edit-pending');fixture.release();await expect(page.locator('.client-profile-form .error')).toBeVisible();await expect(name).toHaveValue('Алексей MC54');await probe('edit-error');await page.getByRole('button',{name:'Сохранить',exact:true}).click();await expect(page).toHaveURL(/\/me$/);expect(fixture.attempts()).toBe(2);expect(fixture.data().client.canonicalFullName).toBe('Алексей MC54')
     }else{await page.getByRole('button',{name:'Отмена',exact:true}).click();await expect(page).toHaveURL(/\/me\/profile$/);await expect(page.getByRole('region',{name:'Мои данные'})).toContainText('Алексей Смирнов')}
    }
   }else if(sample.mode.startsWith('editor')||sample.mode.startsWith('metro')||['photos','legacy-photo','specialties'].includes(sample.mode)||sample.mode==='photo'&&sample.role==='trainer'){
    await openEditor();await probe('editor-ready')
    if(sample.mode==='photos'){
     await expect(editor().locator('.trainer-photo-list > li')).toHaveCount(3);await expect(editor().getByLabel('Выбрать фото')).toBeDisabled();await probe('three-photos');await editor().locator('.trainer-photo-list > li').nth(1).getByRole('button',{name:'Удалить',exact:true}).click();await expect(page.getByRole('alertdialog')).toBeVisible();await probe('photo-delete-confirm');await page.getByRole('alertdialog').getByRole('button',{name:'Отмена',exact:true}).click();await expect(editor().locator('.trainer-photo-list > li')).toHaveCount(3)
    }else if(sample.mode==='legacy-photo'){
     await expect(editor().locator('.trainer-photo-legacy img')).toBeVisible();await probe('legacy-photo')
    }else if(sample.mode==='specialties'){
     await editor().getByText(/^Направления ·/).click();await expect(editor().locator('.trainer-specialties-limit-note')).toBeVisible();await expect(editor().locator('.trainer-specialty-option-legacy')).toContainText('Прежнее направление MC54');await probe('specialties-limit');await editor().locator('.trainer-specialty-option-legacy').getByRole('button',{name:'Убрать',exact:true}).click();await expect(editor().locator('.trainer-specialties-limit-note')).toHaveCount(0);await probe('specialties-legacy-removed');await editor().getByRole('checkbox').filter({visible:true}).nth(5).check();await expect(editor().locator('.trainer-specialties-limit-note')).toBeVisible();await probe('specialties-reselected')
    }else if(sample.mode==='editor-details'||sample.mode.startsWith('metro')){
     await editor().getByText(/^Направления ·/).click();await expect(editor().getByRole('checkbox').first()).toBeVisible();await probe('editor-specialties')
     for(const details of await editor().locator('details').all())if(!await details.getAttribute('open'))await details.locator(':scope > summary').click()
     if(sample.mode.startsWith('metro')){
      const metro=editor().getByRole('combobox',{name:/Метро/});await metro.fill('Динамо');await expect(page.getByRole('listbox')).toBeVisible();await probe('metro-results');await page.getByRole('option',{name:/Динамо/}).first().click();await expect(editor().getByRole('button',{name:'Убрать станцию Динамо'})).toBeVisible();await probe('metro-selected')
      if(sample.mode==='metro-more'){await metro.fill('Несуществующая станция MC54');await expect(editor().locator('.metro-picker-empty')).toBeVisible();await probe('metro-empty');await metro.fill('Парк');await expect(page.getByRole('listbox')).toBeVisible();await metro.press('Escape');await expect(page.getByRole('listbox')).toHaveCount(0);await probe('metro-keyboard-closed')}
     }else await probe('editor-details')
    }else if(sample.mode==='photo'){
     await editor().getByLabel('Выбрать фото').setInputFiles('public/exercises/reference/close-grip-lat-pulldown.jpg');await expect(editor().locator('.trainer-photo-editor').getByRole('alert')).toBeVisible();await probe('trainer-photo-error')
    }else{
     await editor().getByRole('textbox',{name:'О себе',exact:true}).fill('Сохраняемый текст профессиональной анкеты MC54');await probe('editor-input')
     if(sample.mode==='editor-save'){
      await editor().getByRole('button',{name:'Сохранить',exact:true}).click();await expect.poll(()=>fixture.held()).toBe(1);await probe('editor-pending');fixture.release();await expect(editor().getByRole('alert')).toBeVisible();await expect(editor().getByRole('textbox',{name:'О себе',exact:true})).toHaveValue('Сохраняемый текст профессиональной анкеты MC54');await probe('editor-error');await editor().getByRole('button',{name:'Сохранить',exact:true}).click();await expect(editor()).toHaveCount(0);expect(fixture.attempts()).toBe(2);await probe('editor-saved')
     }else{await editor().getByRole('button',{name:'Отмена',exact:true}).click();await expect(editor()).toHaveCount(0);await probe('editor-cancelled')}
    }
   }else if(sample.mode==='photo'){
    const hero=page.getByRole('region',{name:'Мои данные'});await hero.locator('input[type=file]').setInputFiles('public/exercises/reference/close-grip-lat-pulldown.jpg');await expect.poll(()=>fixture.held()).toBe(1);await probe('photo-pending');fixture.release();await expect(hero.getByRole('alert')).toBeVisible();await probe('photo-error');await hero.getByRole('button',{name:'Повторить загрузку фото'}).click();await expect(hero.getByRole('img')).toBeVisible();await probe('photo-saved');expect(fixture.attempts()).toBe(2)
   }else if(sample.mode==='unpublish'||sample.mode==='publication-error'){
    if(sample.mode==='publication-error'){
     // Exercise the publication setting while rendered through its real disclosure.
     // The closed-disclosure CI capture changed only native checkbox color after failure.
     const publication=profile.locator('.trainer-publication-disclosure')
     await publication.locator('summary').click();await expect(publication).toHaveAttribute('open','')
     const catalog=publication.getByRole('switch',{name:'Показывать в каталоге',exact:true})
     await expect(catalog).toBeVisible();await expect(catalog).toBeChecked();await expect(catalog).toBeEnabled()
     await publication.locator('summary').click();await expect(publication).not.toHaveAttribute('open','')
    }
    await profile.getByRole('button',{name:'Снять с публикации'}).click();await expect(page.getByRole('alertdialog')).toBeVisible();await probe('unpublish-confirm')
    if(sample.mode==='unpublish')await page.getByRole('alertdialog').getByRole('button',{name:'Отмена'}).click()
    else{
     await page.getByRole('alertdialog').getByRole('button',{name:'Снять',exact:true}).click();await expect(profile.getByRole('alert')).toBeVisible()
     await expect(page.getByRole('alertdialog')).toHaveCount(0)
     const unpublish=profile.getByRole('button',{name:'Снять с публикации',exact:true}),publication=profile.locator('.trainer-publication-disclosure'),catalog=publication.locator('.switch-input')
     await expect(unpublish).toBeEnabled();await expect(unpublish).toHaveAttribute('aria-busy','false')
     await expect(publication).not.toHaveAttribute('open','');await expect(catalog).toBeChecked();await expect(catalog).toBeEnabled()
     await probe('unpublish-error')
    }
   }else if(sample.mode==='training'){
    const density=page.getByRole('radiogroup',{name:'Вид Live-тренировки'});await expect(density).toBeVisible();await density.getByRole('radio',{name:'Компактный',exact:true}).click();await expect(density.getByRole('radio',{name:'Компактный',exact:true})).toHaveAttribute('aria-checked','true')
    const animation=page.getByRole('switch',{name:sample.role==='client'?'Анимация в Live':'Анимация упражнения',exact:true});await animation.setChecked(false);await expect(animation).not.toBeChecked();await probe('training-off');await animation.setChecked(true);await probe('training-on');await page.reload();await expect(density.getByRole('radio',{name:'Компактный',exact:true})).toHaveAttribute('aria-checked','true');await expect(animation).toBeChecked();await probe('training-reloaded')
   }else if(sample.mode==='appearance'){
    const figure=page.getByRole('radio',{name:'Список',exact:true});await figure.click();await expect(figure).toHaveAttribute('aria-checked','true');await probe('appearance-list')
    if(sample.role==='client'){const theme=page.getByLabel('Тема оформления');await theme.selectOption(sample.theme==='light'?'dark':'light');await expect(theme).toHaveValue(sample.theme==='light'?'dark':'light');await probe('appearance-theme');await theme.selectOption('system');await probe('appearance-system')}
    await page.reload();await expect(figure).toHaveAttribute('aria-checked','true')
   }else if(sample.mode==='schedule'){
    const compact=page.getByRole('radio',{name:'Компактная',exact:true});await compact.click();await expect.poll(()=>fixture.held()).toBe(1);await expect(compact).toBeDisabled();await probe('schedule-pending');fixture.release();await expect(page.getByRole('alert')).toBeVisible();await probe('schedule-error');await page.getByRole('button',{name:'Повторить',exact:true}).click();await expect(compact).toHaveAttribute('aria-checked','true');await expect(compact).toBeEnabled();await probe('schedule-saved');expect(fixture.data().grid).toBe('compact')
   }else if(sample.mode.startsWith('account-')){
    await page.getByRole('button',{name:'Изменить данные',exact:true}).click();const form=page.locator('.account-settings-form');await form.getByLabel('Имя',{exact:true}).fill('Антон MC54');await form.getByLabel('Часовой пояс').fill('Europe/Samara');await probe('account-input')
    if(sample.mode==='account-save'){
     await form.getByRole('button',{name:'Сохранить',exact:true}).click();await expect.poll(()=>fixture.held()).toBe(1);await probe('account-pending');fixture.release();await expect(form.getByRole('alert')).toBeVisible();await expect(form.getByLabel('Имя',{exact:true})).toHaveValue('Антон MC54');await probe('account-error');await form.getByRole('button',{name:'Сохранить',exact:true}).click();await expect(form).toHaveCount(0);await expect(page.locator('.account-settings-summary')).toContainText('Антон MC54');await probe('account-saved')
    }else{await form.getByRole('button',{name:'Отмена',exact:true}).click();await expect(form).toHaveCount(0);await page.getByRole('button',{name:'Изменить данные',exact:true}).click();await expect(form.getByLabel('Имя',{exact:true})).toHaveValue('Антон');await probe('account-cancelled')}
   }else if(sample.mode==='feedback'){
    if(sample.role==='client')await page.getByRole('button',{name:'Предложение или проблема'}).click()
    const form=page.locator('.app-feedback-card');await form.getByRole('button',{name:'Проблема',exact:true}).click();await form.getByLabel('Сообщение',{exact:true}).fill('Не');await expect(form.getByRole('button',{name:'Отправить',exact:true})).toBeDisabled();await probe('feedback-disabled');await form.getByLabel('Сообщение',{exact:true}).fill('Сохраняемый текст обратной связи MC54');await form.getByRole('button',{name:'Отправить',exact:true}).click();await expect.poll(()=>fixture.held()).toBe(1);await probe('feedback-pending');fixture.release();await expect(form.getByRole('alert')).toBeVisible();await expect(form.getByLabel('Сообщение',{exact:true})).toHaveValue('Сохраняемый текст обратной связи MC54');await probe('feedback-error');await form.getByRole('button',{name:'Отправить',exact:true}).click();await expect(page.getByRole('heading',{name:'Сообщение отправлено',exact:true})).toBeVisible();await probe('feedback-sent');expect(fixture.feedbackCount()).toBe(1)
   }else if(sample.mode.startsWith('notify-')){
    if(sample.mode==='notify-error'){
     await expect(page.getByRole('alert').filter({hasText:'Не удалось проверить разрешение и подключение'})).toBeVisible();await probe('notifications-error');fixture.recoverNotify();await page.getByRole('button',{name:'Повторить',exact:true}).click()
    }
    const messages=page.getByRole('switch',{name:'Новые сообщения',exact:true});await expect(messages).toBeEnabled();await expect(messages).not.toBeChecked();await probe('notifications-working')
    if(sample.mode==='notify-working'){
     await messages.click();await expect.poll(()=>fixture.held()).toBe(1);await expect(messages).toBeDisabled();await probe('notifications-pending');fixture.release();await expect(page.getByRole('alert')).toBeVisible();await expect(messages).not.toBeChecked();await probe('notifications-category-error');await messages.click();await expect(messages).toBeChecked();await expect(messages).toBeEnabled();await probe('notifications-saved');expect(fixture.attempts()).toBe(2)
     await page.getByRole('button',{name:'Отправить тестовое уведомление',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'Тестовое уведомление отправлено в очередь'})).toBeVisible();await probe('notifications-test-queued')
    }
   }else if(sample.mode==='install'){
    if(sample.role==='client')await page.getByRole('button',{name:'Fit на экране «Домой»',exact:true}).click()
    await expect(page.locator('.app-install-card,.app-install-panel').first()).toBeVisible();await probe('install-open');await page.getByRole('button',{name:'Закрыть',exact:true}).last().click()
   }else throw Error('Unimplemented profile sample: '+sample.mode)
  }
  expect(fixture.workoutHistoryUnchanged()).toBe(true);expect(fixture.diagnostics.errors).toEqual([])
  const preferences=await page.evaluate(()=>Object.fromEntries(Object.entries(localStorage).filter(([key])=>/fit\.(?:clientLive|coachLive|liveExercise|clientLime\.theme|appTheme|bodyMap|workoutTime|exercisePlan|rpe|preference)/.test(key))))
  await writeFile(info.outputPath('profile-skin.json'),JSON.stringify({sample,route,initialData:fixture.initialData,finalData:fixture.data(),writes:fixture.writes,reads:fixture.reads,diagnostics:fixture.diagnostics,mutationAttempts:fixture.attempts(),preferences,unchangedWorkoutHistory:fixture.workoutHistoryUnchanged(),states}))
  if(external)for(const state of states)expect(state.owners).toEqual([])
  else for(const state of states)assertEditorOwnership(state,sample.lime,profileContract)
 })
}
