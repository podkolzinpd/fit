import { nativeCreateConnectedAthlete, nativeSignIn, nativeRegister, nativeEnableLime, nativeRequest, closeNativeContext } from './native-local-fixture'
import { expect, test } from './native-local-fixture'
import { randomUUID } from 'node:crypto'

test('athlete compares manual-card differences and explicitly chooses each source before linking', async ({ page, browser }, info) => {
  const context=await browser.newContext({baseURL:String(info.project.use.baseURL),viewport:{width:390,height:844}})
  try {
    await nativeSignIn(page,`merge-trainer-${randomUUID()}@fit.local`,'trainer','Тренер карточки')
    const created=await nativeRequest(page,'/v1/clients',{method:'POST',body:{fullName:'Анна из карточки',gender:'female',
      ageYears:null,ageUpdatedAt:null,heightCm:175,goal:null,note:null,initialWeightKg:72,initialWeightRecordedOn:'2026-11-09'}})
    expect(created.ok).toBe(true)
    const cardId=(await created.json() as {client:{id:string}}).client.id
    const workout=await nativeRequest(page,'/v1/workouts/completed',{method:'POST',body:{clientId:cardId,workoutDate:'2026-11-07',actualDurationSec:600,exercises:[]}})
    expect(workout.ok).toBe(true)
    const workoutId=(await workout.json() as {workout:{id:string}}).workout.id
    const share=await nativeRequest(page,'/v1/invitation-links',{method:'POST',body:{clientId:cardId,targetRole:'client'}})
    expect(share.ok).toBe(true)
    const token=(await share.json() as {invitation:{token:string}}).invitation.token
    const athlete=await context.newPage()
    await nativeEnableLime(athlete,'client')
    await nativeSignIn(athlete,`merge-athlete-${randomUUID()}@fit.local`,'client','Анна из аккаунта')
    expect((await nativeRequest(athlete,'/v1/clients/me/quick',{method:'POST',body:{fullName:'Анна из аккаунта'}})).ok).toBe(true)
    const own=await nativeRequest(athlete,'/v1/clients')
    const ownId=(await own.json() as {clients:{id:string}[]}).clients[0]!.id
    const progress=await nativeRequest(athlete,'/v1/progress',{method:'POST',body:{draft:{id:null,clientId:ownId,
      recordedOn:'2026-11-09',weightKg:70,chestCm:null,waistCm:null,hipCm:null,notes:null,customMetrics:[]},expectedVersion:null}})
    expect(progress.ok).toBe(true)
    const self=await nativeRequest(athlete,'/v1/connection-directory',{method:'POST',body:{action:'self'}})
    const actorId=(await self.json() as {result:{fitId:string}}).result.fitId
    await athlete.evaluate(id=>{localStorage.setItem(`fit.clientLime.theme.${id}`,'light');localStorage.setItem('fit.appTheme','light')},actorId)
    await athlete.goto(`/invite?source=yandex&token=${token}`)
    await expect(athlete.locator('.phone-frame')).toHaveClass(/fit-client-lime/)
    const differences=athlete.getByRole('region',{name:'Расхождения данных'})
    await expect(differences).toBeVisible()
    const confirm=athlete.getByRole('button',{name:'Подключить тренера',exact:true})
    await expect(confirm).toBeDisabled()
    for(const radio of await differences.getByRole('radio').all()) await expect(radio).not.toBeChecked()
    const weight=differences.getByRole('group',{name:'Вес, кг · 2026-11-09'})
    await expect(weight.getByText('70',{exact:true})).toBeVisible()
    await expect(weight.getByText('72',{exact:true})).toBeVisible()
    for(const width of [390,430]) {
      await athlete.setViewportSize({width,height:932})
      await expect(athlete.locator('body')).toHaveJSProperty('scrollWidth',width)
      await differences.screenshot({path:info.outputPath(`merge-choices-lime-${width}.png`)})
    }
    for(const group of await differences.getByRole('group').all()) await group.getByRole('radio',{name:/Из моего аккаунта/}).check()
    await weight.getByRole('radio',{name:/Из карточки тренера/}).check()
    await confirm.click()
    await expect(athlete.getByText('Тренер подключён',{exact:true})).toBeVisible()
    const after=await nativeRequest(athlete,`/v1/clients/${ownId}/progress`)
    const bundle=await after.json() as {entries:{weightKg:number}[]}
    expect(bundle.entries[0]!.weightKg).toBe(72)
    const history=await nativeRequest(athlete,'/v1/training-data?scope=workouts&limit=100')
    expect((await history.json() as {workouts:{id:string}[]}).workouts.some(w=>w.id===workoutId)).toBe(true)
  } finally {await closeNativeContext(context)}
})

test('trainer creates a manual card and starts a workout without athlete registration', async ({ page }, info) => {
  await nativeEnableLime(page, 'trainer')
  await page.goto('/auth')
  await nativeRegister(page, { key: `client-form-${randomUUID()}@fit.local`, firstName: 'Manual card trainer', role: 'trainer' })
  await expect(page).toHaveURL(/\/(today|clients)$/)
  await page.goto('/clients')
  await page.getByRole('button', { name: /Добавить(?: спортсмена)?$/ }).click()
  await expect(page.locator('.phone-frame')).toHaveClass(/fit-lime-shell/)
  await page.screenshot({ path: info.outputPath('manual-card-entry-lime.png'), fullPage: true })
  await page.getByRole('link', { name: 'Создать карточку без регистрации' }).click()
  await expect(page).toHaveURL(/\/clients\/new$/)
  await expect(page.getByRole('heading', { name: 'Новый клиент' })).toBeVisible()
  await expect(page.locator('.phone-frame')).toHaveClass(/fit-lime-shell/)
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(page.getByText('Введите имя')).toBeVisible()
  await page.locator('input[name=fullName]').fill('Спортсмен без регистрации')
  await page.getByLabel('Пол').selectOption('male')
  for (const theme of ['light', 'dark']) {
    await page.evaluate(value => { localStorage.setItem('fit.appTheme', value); window.dispatchEvent(new Event('fit-theme-change')) }, theme)
    await page.screenshot({ path: info.outputPath(`manual-card-form-${theme}.png`), fullPage: true })
  }
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Спортсмен без регистрации' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Начать тренировку', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Начать тренировку', exact: true }).click()
  await expect(page.getByRole('group', { name: 'Формат тренировки' })).toBeVisible()
  await page.getByRole('button', { name: 'Начать тренировку', exact: true }).click()
  await expect(page).toHaveURL(/\/workouts\/[^/]+\/live$/)
})

test('trainer connected-client edit keeps existing validation under monochrome preview', async ({ page }) => {
  await page.goto('/auth')
  await nativeSignIn(page, 'trainer@fit.local')
  await expect(page).toHaveURL(/\/(today|clients)$/)
  const athlete = await nativeCreateConnectedAthlete(page, { name: 'Анкета спортсмена' })
  await page.goto(`/clients/${athlete.clientId}/edit`)
  await expect(page.locator('.phone-frame')).toHaveClass(/trainer-client-form-identity/)

  await page.getByLabel('Имя', { exact: true }).fill('')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByText('Введите имя')).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`/clients/${athlete.clientId}/edit$`))
})

test('trainer edits a registered client without requiring age, height or weight', async ({ page }) => {
  const clientName = `Клиент без замеров ${randomUUID().slice(0, 8)}`
  const trainerEmail = `optional-client-fields-${randomUUID()}@fit.local`
  await page.goto('/auth')
  await nativeRegister(page, { key: trainerEmail, firstName: 'Optional fields trainer', role: 'trainer' })
  await expect(page).toHaveURL(/\/(today|clients)$/)

  const athlete = await nativeCreateConnectedAthlete(page, { name: clientName })
  await page.goto(`/clients/${athlete.clientId}/edit`)
  await page.getByLabel('Имя', { exact: true }).fill(clientName)
  await page.getByLabel('Пол').selectOption('male')
  await expect(page.getByLabel('Возраст')).toHaveValue('')
  await expect(page.getByLabel('Рост, см')).toHaveValue('')
  await expect(page.getByLabel('Начальный вес, кг')).toHaveCount(0)
  await page.getByRole('button', { name: 'Сохранить' }).click()

  await expect(page.getByRole('heading', { name: clientName })).toBeVisible()
})
