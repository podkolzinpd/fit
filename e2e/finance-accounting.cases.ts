import { expect, test, type Locator, type Page } from '@playwright/test'
import type { TrainerFinanceClientBundle, TrainerFinanceManualSessionDraft, TrainerFinancePaymentUpdate, TrainerFinanceReceipt } from '../src/data/contracts/trainer-finance'
import { clientId, conversationId, newWorkoutId, workoutId, workout, mockPilot, type MockWorkout } from './fit-lime-fixtures'

const coach = 'c0ac0000-6010-4000-8000-000000000001'
const stamp = '2026-10-01T10:00:00Z'
async function changeFinanceMonth(page: Page, direction: 'Предыдущий месяц' | 'Следующий месяц') {
  const direct = page.getByRole('button', { name: direction, exact: true })
  if (await direct.count()) return direct.click()
  await page.getByRole('button', { name: /^Месяц финансов:/ }).click()
  await page.getByRole('menuitem', { name: direction, exact: true }).click()
}
async function changeFinanceMetric(page: Page, label: 'Поступления' | 'Тренировки') {
  const direct = page.getByRole('button', { name: label, exact: true })
  if (await direct.count()) return direct.click()
  await page.getByRole('button', { name: /^Показатель итогов:/ }).click()
  await page.getByRole('menuitem', { name: label, exact: true }).click()
}
async function openFinanceSearch(page: Page) {
  const search = page.getByRole('searchbox', { name: 'Поиск клиента' })
  if (!await search.isVisible()) await page.getByRole('button', { name: 'Открыть поиск клиента' }).click()
  return search
}
async function clearFinanceSearch(page: Page) {
  const close = page.getByRole('button', { name: 'Закрыть поиск', exact: true })
  if (await close.count()) await close.click()
  else await page.getByRole('button', { name: 'Очистить поиск', exact: true }).click()
}
async function chooseFinanceFilter(page: Page, label: string) {
  const direct = page.getByRole('button', { name: label, exact: true })
  if (await direct.count()) return direct.click()
  await page.getByRole('button', { name: /^Фильтровать/ }).click()
  await page.getByRole('dialog', { name: 'Фильтр клиентов', exact: true }).getByRole('radio', { name: label, exact: true }).click()
}
async function chooseReceiptClient(page: Page, id: string) {
  const select = page.getByLabel('Клиент оплат')
  if (await select.count()) return select.selectOption(id)
  await page.getByRole('button', { name: /^Фильтровать/ }).click()
  await page.getByRole('dialog', { name: 'Фильтр оплат по клиенту' }).locator(`input[value="${id}"]`).click()
  await expect(page.getByRole('button', { name: /^Фильтровать/ })).toBeFocused()
}
async function receiptFilterGeometry(page: Page) {
  const select = page.getByLabel('Клиент оплат')
  if (await select.count()) {
    expect((await select.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    expect(await select.evaluate(node => getComputedStyle(node).fontSize)).toBe('16px')
    return
  }
  await page.getByRole('button', { name: /^Фильтровать/ }).click()
  const sheet = page.getByRole('dialog', { name: 'Фильтр оплат по клиенту' })
  expect(await sheet.evaluate(node => { const r = node.getBoundingClientRect(); return r.left >= 8 && r.right <= innerWidth - 8 && r.top >= 8 && r.bottom <= innerHeight - 7 && node.scrollWidth <= node.clientWidth })).toBe(true)
  expect(await sheet.locator('fieldset label').evaluateAll(nodes => nodes.every(node => { const r = node.getBoundingClientRect(); return r.height >= 44 && r.width >= 44 && parseFloat(getComputedStyle(node).fontSize) >= 14 }))).toBe(true)
  await sheet.getByRole('button', { name: 'Закрыть фильтры' }).click()
}
async function expectReceiptClient(page: Page, id: string) {
  const select = page.getByLabel('Клиент оплат')
  if (await select.count()) await expect(select).toHaveValue(id)
  else {
    expect(new URL(page.url()).searchParams.get('client')).toBe(id)
    await expect(page.getByRole('button', { name: 'Сбросить фильтр оплат' })).toBeVisible()
  }
}
async function accountingFixture(page: Page, fitLime = true, workouts?: MockWorkout[]) {
  await page.clock.setFixedTime(new Date('2026-11-03T09:00:00Z'))
  await mockPilot(page, { profileId: coach, fitLime, ...(workouts ? { workouts } : {}) })
  const old = { id: conversationId, clientId, trainerId: coach, kind: 'session_pack' as const,
    title: 'Октябрь — персональные тренировки с длинным названием', sessionsTotal: 2, sessionsUsed: 2,
    sessionsRemaining: 0, priceCents: 1000000, paidCents: 1000000, dueCents: 0,
    startsOn: '2026-10-01', endsOn: '2026-10-31', paymentDueOn: null, comment: null,
    packageStatus: 'completed' as const, paymentStatus: 'paid' as const, closedAt: null, version: 1, createdAt: stamp, updatedAt: stamp }
  const ledger: TrainerFinanceClientBundle = { clientId, clientName: 'Алексей Смирнов', packages: [old,
    { ...old, id: newWorkoutId, title: 'Ноябрь', sessionsTotal: 10, sessionsUsed: 0, sessionsRemaining: 10,
      startsOn: '2026-11-01', endsOn: '2026-11-30', packageStatus: 'active' }], payments: [],
    sessions: [{ id: workoutId, packageId: old.id, workoutId, disposition: 'charged', source: 'automatic',
      comment: null, workoutDate: '2026-10-15', voidedAt: null, voidReason: null, version: 1, createdAt: stamp, updatedAt: stamp }] }
  await page.route(`**/v1/clients/${clientId}/finance`, route => route.fulfill({ json: { finance: ledger } }))
  return ledger
}

async function formGeometry(form: Locator, lime = true) {
  expect(await form.locator('input,select,button').evaluateAll(nodes => nodes.every(node => {
    const target = node.matches('input[type="radio"]') ? node.closest('label')! : node
    const r = target.getBoundingClientRect(), parent = node.closest('form')!.getBoundingClientRect()
    return r.width >= 44 && r.height >= 44 && r.left >= parent.left - 1 && r.right <= parent.right + 1
  }))).toBe(true)
  const actions = form.locator('.actions')
  expect(await actions.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true)
  if (lime) expect(await form.evaluate(node => getComputedStyle(node).fontFamily)).toContain('YS Geo')
}

async function receiptFixture(page: Page, fitLime = true, extraReceipts = 0) {
  const ledger = await accountingFixture(page, fitLime)
  const name = 'Александра Константинопольская — персональные тренировки'
  ledger.clientName = name
  const service = ledger.packages[1]!
  Object.assign(service, { paidCents: 600000, dueCents: 400000, paymentStatus: 'partial' })
  const receipts: TrainerFinanceReceipt[] = [
    { id: clientId, packageId: service.id, clientId, clientName: name, archivedAt: null,
      serviceTitle: service.title, amountCents: 600000, receivedOn: '2026-11-03', source: 'manual' as const,
      comment: 'Оплата персональных тренировок', voidedAt: null as string | null, voidReason: null, version: 1, createdAt: stamp, updatedAt: stamp },
    { id: conversationId, packageId: conversationId, clientId: conversationId, clientName: 'Дарья Иванова', archivedAt: stamp,
      serviceTitle: 'Персональные тренировки', amountCents: 400000, receivedOn: '2026-11-02', source: 'opening' as const,
      comment: null, voidedAt: null as string | null, voidReason: null, version: 1, createdAt: stamp, updatedAt: stamp },
  ]
  for (let index = 1; index <= extraReceipts; index++) receipts.push({ ...receipts[0]!,
    id: `10000000-0000-4000-9000-${String(index).padStart(12, '0')}`, amountCents: 10000,
    receivedOn: '2026-11-01', comment: null })
  service.paidCents += extraReceipts * 10000
  service.dueCents = Math.max(0, service.priceCents - service.paidCents)
  ledger.payments = receipts.filter(item => item.clientId === clientId)
  const monthTotal = () => receipts.filter(item => !item.voidedAt && item.receivedOn.startsWith('2026-11')).reduce((sum,item) => sum+item.amountCents,0)
  await page.route('**/v1/finance/overview*', route => route.fulfill({ json: { overview: { month: '2026-11',
    receivedCents: monthTotal(), dueCents: service.dueCents, attentionCount: 0, clients: [] } } }))
  await page.route(/\/v1\/finance\/payments\?/, route => {
    const params = new URL(route.request().url()).searchParams
    const month = params.get('month')!, selected = params.get('clientId'), offset = Number(params.get('offset'))
    const payments = receipts.filter(item => !item.voidedAt && item.receivedOn.startsWith(month) && (!selected || item.clientId === selected))
    return route.fulfill({ json: { history: { month, clientId: selected, offset: Number(params.get('offset')), limit: 50,
      totalCount: payments.length, totalCents: payments.reduce((sum,item) => sum+item.amountCents,0),
      clients: [...new Map(receipts.filter(item => !item.voidedAt).map(item => [item.clientId, { id: item.clientId, name: item.clientName }])).values()], payments: payments.slice(offset, offset + 50) } } })
  })
  return { name, service, receipts }
}

async function uncertainCreateFixture(page: Page, kind: 'payment' | 'package', fitLime = true) {
  const ledger = await accountingFixture(page, fitLime)
  // Keep a real balance so the service CTA remains available after FIN304.
  Object.assign(ledger.packages[1]!, { paidCents: 0, dueCents: 1000000, paymentStatus: 'unpaid' })
  const commands: Record<string, unknown>[] = []
  const endpoint = kind === 'payment' ? `**/v1/finance/packages/${newWorkoutId}/payments` : `**/v1/clients/${clientId}/finance/packages`
  await page.route(endpoint, route => {
    const draft = route.request().postDataJSON() as Record<string, unknown>
    commands.push(draft)
    if (commands.length === 1) return route.fulfill({ status: 503, json: {} })
    return route.fulfill({ json: kind === 'payment' ? { payment: { id: clientId, packageId: newWorkoutId, ...draft,
      source: 'manual', voidedAt: null, voidReason: null, version: 1, createdAt: stamp, updatedAt: stamp } }
      : { package: { ...ledger.packages[1]!, id: clientId, ...draft } } })
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`/clients/${clientId}/finance`)
  const open = async () => page.getByRole('button', { name: kind === 'payment' ? 'Внести оплату' : fitLime ? 'Новая услуга' : 'Новая', exact: true }).click()
  await open()
  const form = page.locator('.finance-form')
  if (kind === 'package') {
    await form.getByLabel('Стоимость, ₽').fill('10000')
    await form.getByLabel('Уже оплачено, ₽').fill('2500')
    await form.getByLabel('Дата получения').fill('2026-10-20')
  } else {
    await form.getByLabel('Сумма, ₽').fill('2500')
    await form.getByLabel('Дата', { exact: true }).fill('2026-10-20')
  }
  await form.getByLabel('Комментарий').fill('Оплата переводом — сохранить исходную запись')
  await form.getByLabel('Комментарий').focus()
  await page.setViewportSize({ width: 390, height: 400 })
  await form.getByRole('button', { name: 'Сохранить', exact: true }).click()
  // Disabled fields dismiss the real keyboard; restore its unobscured viewport.
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(form.getByRole('button', { name: 'Повторить сохранение' })).toBeEnabled()
  await expect(form.getByText('Сохранение не подтверждено')).toBeVisible()
  await expect(form.getByLabel('Комментарий')).toBeDisabled()
  return { form, commands, open }
}

export function financeAccountingCases() {
  test('Finance monthly athlete details retain period, source attendance and return context', { tag: ['@lime-finance'] }, async ({ page }, info) => {
    const ledger=await accountingFixture(page)
    ledger.payments=[{id:workoutId,packageId:newWorkoutId,amountCents:10001,receivedOn:'2026-11-02',source:'manual',comment:'Месячная оплата',voidedAt:null,voidReason:null,version:1,createdAt:stamp,updatedAt:stamp},
      {id:newWorkoutId,packageId:newWorkoutId,amountCents:20002,receivedOn:'2026-10-02',source:'manual',comment:null,voidedAt:null,voidReason:null,version:1,createdAt:stamp,updatedAt:stamp}]
    ledger.attendedWorkouts=[{workoutId,workoutDate:'2026-11-02',title:null},{workoutId:newWorkoutId,workoutDate:'2026-11-03',title:'Проведение без списания'}]
    ledger.sessions[0]!.workoutDate='2026-11-02'
    const client={clientId,fullName:'Алексей Смирнов',archivedAt:null,activeClient:true,completedSessions:2,
      receivedCents:10001,dueCents:0,nearestPaymentDueOn:null,unpaidPackageCount:0,activePackageCount:1,
      upcomingPackageCount:0,sessionsRemaining:9,overdue:false,lowSessions:false,unassignedSessions:0,needsAttention:false}
    await page.route('**/v1/finance/overview*',route=>{const month=new URL(route.request().url()).searchParams.get('month')!;const november=month==='2026-11';return route.fulfill({json:{overview:{month,receivedCents:november?10001:20002,completedSessions:november?2:0,dueCents:0,attentionCount:0,clients:[...Array.from({length:10},(_,i)=>({...client,clientId:`70000000-0000-4000-9000-${String(i).padStart(12,'0')}`,fullName:`Алексей — тестовый спортсмен ${i}`,receivedCents:0,completedSessions:0})),{...client,receivedCents:november?10001:20002,completedSessions:november?2:0}]}}})})
    await page.goto('/finance?month=2026-11&metric=money&q=Алексей')
    const row=page.locator(`.finance-monthly-client[href^="/clients/${clientId}/finance"]`)
    const athleteColor = await row.locator('.finance-monthly-dot').evaluate(node => getComputedStyle(node).backgroundColor)
    await row.scrollIntoViewIfNeeded()
    // Native focus may reveal the link before navigation. Restore the actual
    // leaving position, captured at click, rather than pre-focus geometry.
    await row.evaluate(node=>node.addEventListener('click',()=>sessionStorage.setItem('fit.finance-leave-scroll.fixture',String(node.closest('.content')!.scrollTop)),{once:true}))
    await row.click()
    const scroll=await page.evaluate(()=>Number(sessionStorage.getItem('fit.finance-leave-scroll.fixture')))
    expect(scroll).toBeGreaterThan(0)
    const total=page.locator('[data-finance-monthly-total]')
    await expect(total).toContainText(/100,01/)
    expect(await page.locator('.finance-monthly circle[stroke]').first().evaluate(node => getComputedStyle(node).stroke)).toBe(athleteColor)
    await expect(page.locator('.finance-monthly-switch')).toHaveCount(0)
    await expect(page.locator('#finance-payments-panel .finance-payment')).toHaveCount(1)
    await expect(page.locator('.finance-monthly')).not.toContainText('%')
    await page.getByRole('tab',{name:'Занятия: 2'}).click()
    await expect(total).toHaveText('2')
    await expect(page.locator('.finance-session')).toHaveCount(2)
    await expect(page.getByText('Проведение без списания')).toBeVisible()
    await page.getByText('Проведение без списания').scrollIntoViewIfNeeded()
    await page.screenshot({path:info.outputPath('monthly-athlete-sessions.png'),fullPage:true})
    await page.getByRole('tab',{name:'Оплаты: 1'}).click()
    await page.getByRole('button',{name:'Вся история',exact:true}).click()
    await expect(page.locator('#finance-payments-panel .finance-payment')).toHaveCount(2)
    await expect(total).toContainText(/100,01/)
    await page.getByRole('button',{name:'За месяц',exact:true}).click()
    await changeFinanceMonth(page, 'Предыдущий месяц')
    await expect(total).toContainText(/200,02/)
    await expect(page.locator('#finance-payments-panel .finance-payment')).toHaveCount(1)
    await page.locator('.page-back').click()
    await expect(page).toHaveURL(/finance\?month=2026-11&metric=money&q=/)
    await expect(page.getByRole('searchbox',{name:'Поиск клиента'})).toHaveValue('Алексей')
    await expect.poll(async()=>Math.abs(await page.locator('.content').evaluate(node=>node.scrollTop)-scroll)).toBeLessThanOrEqual(2)
    // Navigation is checked at one physical viewport; resizing is a separate visual axis.
    await row.click()
    await expect(page.locator('.trainer-finance-page')).toBeVisible()
    await expect(total).toContainText(/100,01/)
    for(const width of [320,390,430,1440]){
      await page.setViewportSize({width,height:844})
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
      await page.locator('.trainer-finance-page .finance-monthly').scrollIntoViewIfNeeded()
      await page.screenshot({path:info.outputPath(`monthly-athlete-${width}.png`),fullPage:true})
    }
    await page.setViewportSize({width:320,height:844})
    await page.getByRole('button',{name:'Добавить',exact:true}).click()
    const paymentForm=page.locator('.finance-form')
    await expect(paymentForm.getByRole('heading',{name:'Добавить оплату'})).toBeVisible()
    await formGeometry(paymentForm)
    await paymentForm.getByLabel('Комментарий').fill('Месячная карточка — проверка формы')
    await paymentForm.getByLabel('Комментарий').focus()
    await page.setViewportSize({width:320,height:400})
    const save=paymentForm.getByRole('button',{name:'Сохранить',exact:true})
    await save.scrollIntoViewIfNeeded()
    expect(await save.evaluate(node=>{const r=node.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('button')===node})).toBe(true)
    await page.screenshot({path:info.outputPath('monthly-payment-keyboard.png'),fullPage:true})
    await page.setViewportSize({width:320,height:844})
    await paymentForm.getByRole('button',{name:'Отмена',exact:true}).click()
    await expect(page.locator('#finance-payments-panel .finance-payment')).toHaveCount(1)
    await expect(total).toContainText(/100,01/)
  })
  test('Finance monthly totals switch without percentages or athlete sublines', { tag: ['@lime-finance'] }, async ({ page }, info) => {
    await accountingFixture(page)
    const clients = Array.from({length:7},(_,index) => ({
      clientId: index===0?clientId:`60000000-0000-4000-8000-${String(index).padStart(12,'0')}`,
      fullName: index===0?'Александра Константинопольская — длинное имя':`Спортсмен ${index}`,
      archivedAt: index===6?stamp:null, activeClient:index!==6, completedSessions:index+1,
      receivedCents:(index+1)*10001, dueCents:0, nearestPaymentDueOn:null, unpaidPackageCount:0,
      activePackageCount:1, upcomingPackageCount:0, sessionsRemaining:10, overdue:false,
      lowSessions:false, unassignedSessions:index===0?1:0, needsAttention:index===0,
    }))
    let failed = false
    await page.route('**/v1/finance/overview*',route => {
      if(failed)return route.fulfill({status:503,json:{error:'temporarily_unavailable'}})
      const month = new URL(route.request().url()).searchParams.get('month')!
      const rows = month==='2026-11'?clients:[]
      return route.fulfill({json:{overview:{month,receivedCents:rows.reduce((n,c)=>n+c.receivedCents,0),
        completedSessions:rows.reduce((n,c)=>n+c.completedSessions,0),dueCents:0,attentionCount:rows.filter(c=>c.needsAttention).length,clients:rows}}})
    })
    await page.goto('/finance?month=2026-11')
    const total=page.locator('[data-finance-monthly-total]')
    await expect(total).toContainText(/2\s800,28/)
    await expect(page.locator('.finance-monthly-name').first()).toHaveText(clients[0]!.fullName)
    await expect(page.locator('.finance-monthly-name small')).toHaveCount(0)
    await expect(page.locator('.finance-monthly')).not.toContainText('%')
    await expect(page.locator('.finance-monthly-client')).toHaveCount(6)
    const firstDot = page.locator('.finance-monthly-client').first().locator('.finance-monthly-dot')
    const firstColor = await firstDot.evaluate(node => getComputedStyle(node).backgroundColor)
    const chartColors = () => page.locator('.finance-monthly circle[stroke]').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).stroke))
    const moneyColors = await chartColors()
    expect(new Set(moneyColors).size).toBe(moneyColors.length)
    for (const circle of await page.locator('.finance-monthly circle[stroke]').all()) {
      const name = (await circle.locator('title').textContent())!.split(':')[0]!
      const row = page.locator('.finance-monthly-client').filter({ has: page.locator('.finance-monthly-name strong').filter({ hasText: name }) })
      if (await row.count()) expect(await row.locator('.finance-monthly-dot').evaluate(node => getComputedStyle(node).backgroundColor)).toBe(await circle.evaluate(node => getComputedStyle(node).stroke))
    }
    await page.getByRole('button',{name:'Требуют внимания сейчас: 1'}).click()
    await expect(page.locator('.finance-monthly-client')).toHaveCount(1)
    await expect(total).toContainText(/2\s800,28/)
    await chooseFinanceFilter(page, 'Все')
    for(const width of [320,390,430,1440]){
      await page.setViewportSize({width,height:844})
      await page.locator('.content').evaluate(node => { node.scrollTop = 0 })
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
      expect(await page.locator('.finance-monthly-name').evaluateAll(nodes=>nodes.every(node=>getComputedStyle(node).fontFamily.includes('YS Geo')))).toBe(true)
      expect(await page.locator('.finance-overview-list').evaluate(node => node.getBoundingClientRect().top - node.closest('main')!.getBoundingClientRect().top)).toBeLessThanOrEqual(390)
      expect(await page.locator('.finance-monthly-card').evaluate(node=>{
        const ring=node.querySelector('.finance-monthly-ring')!.getBoundingClientRect()
        const figures=node.querySelector('.finance-monthly-figures')!.getBoundingClientRect()
        const bounds=node.getBoundingClientRect()
        return ring.width<=112.5 && figures.left>=ring.right+10 && figures.right<=bounds.right-11 && bounds.height<=190
      })).toBe(true)
      await expect(page.locator('.finance-monthly-companion')).toHaveCount(0)
      await expect(page.locator('.finance-period-block')).toHaveCount(0)
      await expect(page.locator('.page-header').getByRole('button',{name:/^Месяц финансов:/})).toBeVisible()
      await page.locator('.finance-monthly').scrollIntoViewIfNeeded()
      expect(await page.locator('.finance-compact-current button').evaluateAll(nodes=>{
        const [first,last]=nodes.map(node=>node.getBoundingClientRect())
        return !!first && !!last && Math.abs(first.y-last.y)<=1 && first.height>=44 && last.height>=44
      })).toBe(true)
      await page.screenshot({path:info.outputPath(`monthly-money-${width}.png`),fullPage:true})
      const filterButton = page.getByRole('button', { name: /^Фильтровать/ })
      await filterButton.click()
      const filters = page.getByRole('dialog', { name: 'Фильтр клиентов', exact: true })
      expect(await filters.evaluate(node => { const r = node.getBoundingClientRect(); return r.left >= 8 && r.right <= innerWidth - 8 && r.top >= 8 && r.bottom <= innerHeight - 7 && node.scrollWidth <= node.clientWidth })).toBe(true)
      expect(await filters.locator('fieldset label').evaluateAll(nodes => nodes.every(node => node.getBoundingClientRect().height >= 44))).toBe(true)
      await page.screenshot({path:info.outputPath(`monthly-filters-${width}.png`),fullPage:true})
      await page.keyboard.press('Escape')
      await expect(filters).toHaveCount(0)
      await expect(filterButton).toBeFocused()
      const last = page.locator('.finance-monthly-client').last()
      await last.scrollIntoViewIfNeeded()
      expect(await last.evaluate(node=>{const r=node.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('a')===node})).toBe(true)
      await page.screenshot({path:info.outputPath(`monthly-clients-${width}.png`),fullPage:true})
    }
    await changeFinanceMetric(page, 'Тренировки')
    await expect(total).toHaveText('28')
    expect(await chartColors()).toEqual(moneyColors)
    expect(await firstDot.evaluate(node => getComputedStyle(node).backgroundColor)).toBe(firstColor)
    await expect(page.locator('.finance-monthly-value').first()).toHaveText('1')
    const search=await openFinanceSearch(page)
    await search.fill('Александра')
    await expect(page.locator('.finance-monthly-client')).toHaveCount(1)
    expect(await firstDot.evaluate(node => getComputedStyle(node).backgroundColor)).toBe(firstColor)
    expect(await chartColors()).toEqual(moneyColors)
    await expect(total).toHaveText('28')
    await expect(page.locator('.finance-monthly-client')).toHaveAttribute('href',`/clients/${clientId}/finance?month=2026-11&metric=sessions`)
    await clearFinanceSearch(page)
    await chooseFinanceFilter(page, 'Архив')
    await expect(page.locator('.finance-monthly-client')).toHaveCount(1)
    await expect(page.locator('.finance-monthly-client')).toContainText('Спортсмен 6')
    await expect(total).toHaveText('28')
    await page.screenshot({path:info.outputPath('monthly-sessions-archive.png'),fullPage:true})
    await changeFinanceMonth(page, 'Предыдущий месяц')
    await expect(total).toHaveText('0')
    await expect(page.getByText('Проведённых занятий за месяц нет')).toBeVisible()
    failed=true
    await page.goto('/finance?month=2026-09')
    await expect(page.getByRole('button',{name:'Повторить'})).toBeVisible()
    failed=false
    await page.getByRole('button',{name:'Повторить'}).click()
    await expect(page.locator('.finance-monthly')).toBeVisible()
    // The accepted compact layout puts the exact amount beside the disk; neither may overlap or overflow.
    clients[0]!.receivedCents=98765432101
    await page.goto('/finance?month=2026-11')
    await expect(total).toContainText(/987\s657\s021,28/)
    await page.evaluate(()=>document.fonts.ready)
    for(const width of [320,430]){
      await page.setViewportSize({width,height:844})
      await page.locator('.finance-monthly').scrollIntoViewIfNeeded()
      expect(await total.evaluate(node=>{const r=node.getBoundingClientRect(),card=node.closest('.finance-monthly-card')!.getBoundingClientRect(),ring=node.closest('.finance-monthly-card')!.querySelector('.finance-monthly-ring')!.getBoundingClientRect();return node.scrollWidth<=node.clientWidth+1 && r.left>=ring.right+10 && r.right<=card.right-11 && r.bottom<=card.bottom-11})).toBe(true)
      await page.screenshot({path:info.outputPath(`monthly-large-ring-${width}.png`),fullPage:true})
      await page.locator('.finance-monthly-client').first().scrollIntoViewIfNeeded()
      expect(await page.locator('.finance-monthly-value').first().evaluate(node=>node.scrollWidth<=node.clientWidth+1)).toBe(true)
      await page.screenshot({path:info.outputPath(`monthly-large-row-${width}.png`),fullPage:true})
    }
  })
  test('Finance package choice distinguishes periods and preserves explicit attendance accounting', { tag: ['@lime-finance'] }, async ({ page }, info) => {
    const target: MockWorkout = { ...workout, createdBy: coach, workoutDate: '2026-11-03', status: 'planned', exercises: [] }
    const ledger = await accountingFixture(page, true, [target])
    const title = 'Персональные тренировки с индивидуальной программой'
    Object.assign(ledger.packages[0]!, { title, startsOn: '2026-11-01', endsOn: '2026-11-30', packageStatus: 'active', sessionsTotal: 10, sessionsUsed: 7, sessionsRemaining: 3 })
    Object.assign(ledger.packages[1]!, { title, startsOn: '2026-11-03', endsOn: '2026-12-02' })
    ledger.sessions = []
    const commands: Array<{ attendance: { disposition: string; packageId: string } }> = []
    await page.route(`**/v1/workouts/${workoutId}/finish`, async route => {
      const command = route.request().postDataJSON() as typeof commands[number]
      commands.push(command)
      expect(command.attendance).toEqual({ disposition: 'charged', packageId: newWorkoutId })
      Object.assign(target, { status: 'done', version: target.version + 1, completedAt: '2026-11-03T09:00:00Z' })
      Object.assign(ledger.packages[1]!, { sessionsUsed: 1, sessionsRemaining: 9 })
      ledger.sessions.push({ id: workoutId, packageId: newWorkoutId, workoutId, disposition: 'charged', source: 'manual',
        comment: null, workoutDate: target.workoutDate, voidedAt: null, voidReason: null, version: 1, createdAt: stamp, updatedAt: stamp })
      await route.fulfill({ json: { workout: { version: target.version, replayed: false } } })
    })
    await page.goto(`/workouts/${workoutId}`)
    await page.getByRole('button', { name: 'Отметить проведённой', exact: true }).click()
    const sheet = page.getByRole('dialog', { name: 'Отметить проведённой', exact: true })
    await expect(sheet.getByText('Абонемент не выбран', { exact: true })).toBeVisible()
    await sheet.getByRole('button', { name: 'Выбрать', exact: true }).click()
    await expect(sheet.getByText('По текущим условиям')).toHaveCount(0)
    const first = sheet.getByRole('radio', { name: /01.11.2026 — 30.11.2026 · осталось 3/ })
    const second = sheet.getByRole('radio', { name: /03.11.2026 — 02.12.2026 · осталось 10/ })
    await expect(first).not.toBeChecked(); await expect(second).not.toBeChecked()
    for (const width of [320, 390, 430, 1440]) {
      await page.setViewportSize({ width, height: 844 })
      await first.scrollIntoViewIfNeeded()
      expect(await sheet.locator('.finance-accounting-choices label').evaluateAll(nodes => nodes.every(node => {
        const r = node.getBoundingClientRect(), parent = node.closest('fieldset')!.getBoundingClientRect()
        return r.width >= 44 && r.height >= 44 && r.left >= parent.left - 1 && r.right <= parent.right + 1 && node.scrollWidth <= node.clientWidth + 1
      }))).toBe(true)
      expect(await sheet.evaluate(node => getComputedStyle(node).fontFamily)).toContain('YS Geo')
      await page.screenshot({ path: info.outputPath(`package-choice-${width}.png`) })
    }
    await page.setViewportSize({ width: 320, height: 600 })
    await second.click()
    await expect(sheet.getByText(/03.11.2026 — 02.12.2026 · останется 9/)).toBeVisible()
    await sheet.getByRole('button', { name: 'Подтвердить проведение', exact: true }).click()
    await expect(sheet).toHaveCount(0)
    expect(commands).toHaveLength(1)
    await expect(page.locator('.workout-finance-confirmation')).toContainText('03.11.2026 — 02.12.2026 · осталось 9')
    await page.goto(`/clients/${clientId}/finance`)
    await page.getByRole('tab', { name: 'Занятия: 1' }).click()
    await page.getByRole('button', { name: 'Добавить', exact: true }).click()
    const form = page.locator('.finance-manual-session')
    await expect(form.getByRole('radio', { name: /03.11.2026 — 02.12.2026 · осталось 9/ })).toBeVisible()
    for (const width of [320, 390, 430, 1440]) {
      await page.setViewportSize({ width, height: 844 })
      await form.scrollIntoViewIfNeeded()
      await formGeometry(form)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: info.outputPath(`manual-package-choice-${width}.png`), fullPage: true })
    }
    await form.getByRole('button', { name: 'Отмена', exact: true }).click()
    await expect(form).toHaveCount(0)
    expect(ledger.sessions).toHaveLength(1)
  })

  test('Finance Lime owns readable cards, forms and payment actions', { tag: ['@lime-finance'] }, async ({ page }, info) => {
    await receiptFixture(page)
    await page.goto(`/clients/${clientId}/finance`)
    await expect(page.locator('.phone-frame')).toHaveClass(/finance-lime-shell/)
    await expect(page.locator('.phone-frame')).not.toHaveClass(/trainer-finance-identity/)
    const card = page.locator('.finance-package').first()
    for (const width of [320, 390, 430, 1440]) {
      await page.setViewportSize({ width, height: 844 })
      await expect(card).toBeVisible()
      expect(await card.evaluate(node => {
        const header = node.querySelector('header')!.getBoundingClientRect()
        const balance = node.querySelector('.finance-service-balance')!.getBoundingClientRect()
        return Math.abs(header.width - balance.width) < 2 && header.width > node.getBoundingClientRect().width - 36
      })).toBe(true)
      const title = page.locator('.page-title-group > p')
      expect(await title.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: info.outputPath(`lime-service-${width}.png`), fullPage: true })
    }
    await page.setViewportSize({ width: 320, height: 500 })
    // Start with a short viewport; resizing an unfocused page is not a keyboard gesture.
    await page.reload()
    await expect(card).toBeVisible()
    const history = page.locator('.finance-history > summary')
    await history.click()
    await expect(page.locator('.finance-history')).toHaveAttribute('open', '')
    await history.click()
    await card.locator('.finance-package-details > summary').click()
    await expect(card.getByRole('button', { name: 'Продлить', exact: true })).toHaveCount(0)
    await card.getByRole('button', { name: /Действия с услугой/ }).click()
    await page.getByRole('menuitem', { name: 'Продлить', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Продление', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Отмена', exact: true }).click()
    await page.getByRole('tab', { name: /Оплаты:/ }).click()
    for (const width of [320, 390, 430, 1440]) {
      await page.setViewportSize({ width, height: 844 })
      expect(await page.locator('.finance-payment').first().evaluate(node => [...node.querySelectorAll('span')].every(span => span.scrollWidth <= span.clientWidth + 1))).toBe(true)
      await page.screenshot({ path: info.outputPath(`lime-payments-${width}.png`), fullPage: true })
    }
    await page.getByRole('button', { name: /Действия с оплатой/ }).first().click()
    await page.getByRole('menuitem', { name: 'Изменить', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Изменить оплату', exact: true })).toBeVisible()
    await expect(page.locator('textarea[name="comment"]')).toBeVisible()
    await page.locator('textarea[name="comment"]').focus()
    await page.setViewportSize({ width: 320, height: 500 })
    await formGeometry(page.locator('.finance-form'))
    await page.screenshot({ path: info.outputPath('lime-payment-edit-small-viewport.png'), fullPage: true })
    await page.getByRole('button', { name: 'Отмена', exact: true }).click()
    await expect(page.locator('.finance-form')).toHaveCount(0)
  })

  test('Finance exact kopecks and mixed overdue debt use separate amounts', { tag: ['@lime-finance'] }, async ({ page }, info) => {
    const ledger = await accountingFixture(page)
    await page.route('**/v1/finance/overview*', route => route.fulfill({ json: { overview: {
      month: '2026-11', receivedCents: 10001, dueCents: 1100001, attentionCount: 1,
      clients: [{ clientId, fullName: 'Александра Константинопольская', archivedAt: null, activeClient: true,
        receivedCents: 10001, dueCents: 1100001, overdueCents: 100001, nearestPaymentDueOn: '2026-11-01', unpaidPackageCount: 2,
        activePackageCount: 1, upcomingPackageCount: 1, sessionsRemaining: 5, overdue: true, lowSessions: false,
        unassignedSessions: 0, needsAttention: true }],
    } } }))
    await page.goto('/finance')
    await expect(page.locator('.finance-overview-client')).toContainText(/К оплате 11\s000,01/)
    await expect(page.locator('.finance-overview-client')).toContainText(/Из них просрочено 1\s000,01/)
    await expect(page.locator('.page-header').getByRole('button', { name: /^Месяц финансов:/ })).toBeVisible()
    for (const width of [320, 390, 430, 1440]) {
      await page.setViewportSize({ width, height: 844 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: info.outputPath(`mixed-debt-${width}.png`), fullPage: true })
    }
    await mockPilot(page, { role: 'client', profileId: clientId, clientLime: true })
    const service = { ...ledger.packages[1]!, priceCents: 10001, paidCents: 10000, dueCents: 1, paymentStatus: 'partial' }
    await page.route('**/v1/me/finance', route => route.fulfill({ json: { finance: { trainers: [{
      trainerId: coach, trainerName: 'Тестовый тренер', packages: [service], payments: [],
    }] } } }))
    for (const theme of ['light', 'dark']) {
      await page.evaluate(({ id, theme }) => localStorage.setItem(`fit.clientLime.theme.${id}`, theme), { id: clientId, theme })
      await page.goto('/me/finance')
      await expect(page.locator('.phone-frame')).toHaveClass(/fit-client-lime/)
      await expect(page.locator('.client-finance-package-money')).toContainText(/0,01\s₽/)
      for (const width of [320, 390, 430, 1440]) {
        await page.setViewportSize({ width, height: 844 })
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        await page.screenshot({ path: info.outputPath(`client-one-kopeck-${theme}-${width}.png`), fullPage: true })
      }
    }
  })

  // Payment and service have separate endpoints and native date/amount layouts.
  for (const kind of ['payment', 'package'] as const) test(`Finance uncertain ${kind} creation restores the same operation`, { tag: ['@lime-finance'] }, async ({ page }, info) => {
    const { form, commands } = await uncertainCreateFixture(page, kind)
    await page.reload()
    await page.getByRole('button', { name: 'Проверить сохранение', exact: true }).click()
    await expect(form.getByLabel('Комментарий')).toHaveValue('Оплата переводом — сохранить исходную запись')
    await expect(form.getByLabel('Комментарий')).toBeDisabled()
    if (kind === 'package') await form.locator('summary').click()
    for (const width of [320, 430, 1440]) {
      await page.setViewportSize({ width, height: 844 })
      await formGeometry(form)
      await page.locator('.content').evaluate(node => { node.scrollTop = 0 })
      await page.screenshot({ path: info.outputPath(`${kind}-uncertain-top-${width}.png`), fullPage: true })
      await form.getByRole('button', { name: 'Повторить сохранение' }).scrollIntoViewIfNeeded()
      await expect(form.getByLabel('Комментарий')).toHaveCSS('opacity', '1')
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: info.outputPath(`${kind}-uncertain-${width}.png`), fullPage: true })
    }
    await page.setViewportSize({ width: 390, height: 844 })
    await form.getByRole('button', { name: 'Отмена' }).click()
    await page.setViewportSize({ width: 320, height: 844 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: info.outputPath(`${kind}-pending-return.png`), fullPage: true })
    await page.getByRole('button', { name: 'Проверить сохранение', exact: true }).click()
    await expect(form.getByLabel('Комментарий')).toHaveValue('Оплата переводом — сохранить исходную запись')
    await expect(form.getByLabel(kind === 'payment' ? 'Дата' : 'Дата получения', { exact: true })).toHaveValue('2026-10-20')
    await form.getByRole('button', { name: 'Повторить сохранение' }).scrollIntoViewIfNeeded()
    await page.screenshot({ path: info.outputPath(`${kind}-retry-restored.png`), fullPage: true })
    await form.getByRole('button', { name: 'Повторить сохранение' }).click()
    await expect(form).toHaveCount(0)
    expect(commands).toHaveLength(2)
    expect(commands[1]).toEqual(commands[0])
  })
  // Short visual-only Mono states cover the different light/dark text tokens;
  // business replay is exercised above, without multiplying the full chain.
  for (const theme of ['light', 'dark']) test(`Finance uncertain create forms retain Mono ${theme} readability`, { tag: ['@lime-finance'] }, async ({ page }, info) => {
    await page.addInitScript(theme => localStorage.setItem('fit.appTheme', theme), theme)
    await page.setViewportSize({ width: 320, height: 640 })
    for (const kind of ['payment', 'package'] as const) {
      const { form } = await uncertainCreateFixture(page, kind, false)
      expect(await form.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true)
      await expect(form.getByLabel(kind === 'payment' ? 'Дата' : 'Дата получения', { exact: true })).toHaveCSS('opacity', '1')
      await page.screenshot({ path: info.outputPath(`mono-${theme}-${kind}-uncertain.png`), fullPage: true })
    }
  })


  test('Finance receipts filter, correct and delete across clients with retained context', { tag: ['@lime-finance'] }, async ({ page }, info) => {
    const { name, service, receipts } = await receiptFixture(page)
    await page.route(`**/v1/finance/payments/${clientId}`, route => {
      const draft = route.request().postDataJSON() as TrainerFinancePaymentUpdate
      expect(draft).toMatchObject({ amountCents: 500000, receivedOn: '2026-11-03', expectedVersion: 1 })
      Object.assign(receipts[0]!, draft, { version: 2 })
      Object.assign(service, { paidCents: 500000, dueCents: 500000 })
      return route.fulfill({ json: { payment: receipts[0] } })
    })
    await page.route(`**/v1/finance/payments/${conversationId}`, route => {
      expect(route.request().method()).toBe('DELETE')
      expect(route.request().postDataJSON()).toMatchObject({ expectedVersion: 1 })
      receipts[1]!.voidedAt = stamp
      return route.fulfill({ status: 204 })
    })
    await page.goto('/finance?month=2026-11')
    await expect(page.locator('.finance-overview-summary')).toContainText(/10\s000/)
    await page.getByRole('group', { name: 'Раздел финансов' }).getByRole('button', { name: 'Оплаты', exact: true }).click()
    const history = page.getByRole('region', { name: 'История оплат' })
    await expect(history.locator('.finance-payment')).toHaveCount(2)
    await expect(history.locator('.finance-receipts-total')).toContainText(/10\s000/)
    for (const width of [320, 430, 1440]) {
      await page.setViewportSize({ width, height: 844 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await receiptFilterGeometry(page)
      await page.screenshot({ path: info.outputPath(`receipts-all-${width}.png`), fullPage: true })
    }
    await chooseReceiptClient(page, clientId)
    await expect(history.locator('.finance-payment')).toHaveCount(1)
    const returnUrl = page.url()
    await history.getByRole('link', { name }).click()
    await expect(page.locator('.page-title-group')).toContainText(name)
    await page.getByRole('button', { name: 'Назад', exact: true }).click()
    await expect(page).toHaveURL(returnUrl)
    await expectReceiptClient(page, clientId)
    await history.getByRole('button', { name: /Действия с оплатой/ }).click()
    await page.getByRole('menuitem', { name: 'Изменить' }).click()
    await page.getByLabel('Сумма, ₽').fill('5000')
    for (const width of [320, 1440]) {
      await page.setViewportSize({ width, height: 844 })
      await page.locator('.finance-form').scrollIntoViewIfNeeded()
      await page.screenshot({ path: info.outputPath(`receipt-edit-${width}.png`), fullPage: true })
    }
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click()
    await expect(page.locator('.finance-form')).toHaveCount(0)
    await expect(history.locator('.finance-receipts-total')).toContainText(/5\s000/)
    await chooseReceiptClient(page, '')
    await expect(history.locator('.finance-receipts-total')).toContainText(/9\s000/)
    await history.getByRole('button', { name: /Действия с оплатой Дарья/ }).click()
    await page.getByRole('menuitem', { name: 'Удалить' }).click()
    await page.setViewportSize({ width: 320, height: 844 })
    await page.screenshot({ path: info.outputPath('receipt-delete-confirm.png'), fullPage: true })
    await page.getByRole('alertdialog').getByRole('button', { name: 'Удалить', exact: true }).click()
    await expect(history.locator('.finance-payment')).toHaveCount(1)
    await expect(history.locator('.finance-receipts-total')).toContainText(/5\s000/)
    await changeFinanceMonth(page, 'Предыдущий месяц')
    await expect(page.getByText('Оплат за этот месяц нет.')).toBeVisible()
    await page.screenshot({ path: info.outputPath('receipts-empty-month.png'), fullPage: true })
    await changeFinanceMonth(page, 'Следующий месяц')
    await page.getByRole('group', { name: 'Раздел финансов' }).getByRole('button', { name: 'Клиенты', exact: true }).click()
    await expect(page.locator('.finance-overview-summary')).toContainText(/5\s000/)
  })

  // Theme variants seed the same ledger; only rendering, native controls and
  // keyboard/scroll geometry repeat. The correction/delete chain above runs once.
  for (const [fitLime, theme] of [[false, 'light'], [false, 'dark'], [true, 'light']] as const) {
    test(`Finance receipt layout ${fitLime ? 'Lime' : 'Mono'} ${theme}`, { tag: ['@lime-finance'] }, async ({ page }, info) => {
      await page.addInitScript(value => localStorage.setItem('fit.appTheme', value), theme)
      await receiptFixture(page, fitLime, 50)
      await page.goto('/finance?month=2026-11&view=payments')
      const history = page.getByRole('region', { name: 'История оплат' })
      await expect(history.locator('.finance-payment')).toHaveCount(50)
      for (const width of [320, 430, 1440]) {
        await page.setViewportSize({ width, height: 844 })
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        await receiptFilterGeometry(page)
        await page.screenshot({ path: info.outputPath(`receipt-ledger-${width}.png`), fullPage: true })
      }
      const pagination = page.getByLabel('Страницы оплат')
      for (const width of [320, 1440]) {
        await page.setViewportSize({ width, height: 844 })
        await pagination.scrollIntoViewIfNeeded()
        expect(await pagination.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true)
        for (const button of await pagination.getByRole('button').all()) expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44)
        await expect(pagination).toBeInViewport()
        await pagination.screenshot({ path: info.outputPath(`receipt-pagination-controls-${width}.png`) })
        await page.screenshot({ path: info.outputPath(`receipt-pagination-${width}.png`) })
      }
      await pagination.getByRole('button', { name: 'Следующие', exact: true }).click()
      await expect(history.locator('.finance-payment')).toHaveCount(2)
      await expect(pagination).toContainText('51–52 из 52')
      await pagination.getByRole('button', { name: 'Предыдущие', exact: true }).click()
      await expect(history.locator('.finance-payment')).toHaveCount(50)
      await history.getByRole('button', { name: /Действия с оплатой Александра/ }).first().click()
      await page.getByRole('menuitem', { name: 'Изменить' }).click()
      const form = page.locator('.finance-form')
      for (const width of [320, 1440]) {
        await page.setViewportSize({ width, height: 844 })
        await form.scrollIntoViewIfNeeded()
        await formGeometry(form, fitLime)
        await page.screenshot({ path: info.outputPath(`receipt-editor-${width}.png`), fullPage: true })
      }
      await page.setViewportSize({ width: 320, height: 400 })
      await form.getByLabel('Комментарий').focus()
      await form.getByRole('button', { name: 'Сохранить', exact: true }).scrollIntoViewIfNeeded()
      await expect(form.getByRole('button', { name: 'Сохранить', exact: true })).toBeInViewport()
    })
  }

  test('Finance receipt loading, failure and retry retain the selected period and client', { tag: ['@lime-finance'] }, async ({ page }, info) => {
    await accountingFixture(page)
    await page.addInitScript(() => document.addEventListener('click', event => {
      if ((event.target as Element).closest('button')?.textContent === 'Повторить') sessionStorage.setItem('receipt-explicit-retry', 'yes')
    }, true))
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    await page.route(/\/v1\/finance\/payments\?/, async route => {
      await gate
      const retry = await page.evaluate(() => sessionStorage.getItem('receipt-explicit-retry') === 'yes')
      if (!retry) return route.fulfill({ status: 503, json: {} })
      const params = new URL(route.request().url()).searchParams
      expect(params.get('month')).toBe('2026-10')
      expect(params.get('clientId')).toBe(clientId)
      return route.fulfill({ json: { history: { month: '2026-10', clientId, offset: 0, limit: 50, totalCount: 0,
        totalCents: 0, clients: [{ id: clientId, name: 'Алексей Смирнов' }], payments: [] } } })
    })
    await page.goto(`/finance?view=payments&month=2026-10&client=${clientId}`)
    await expect(page.getByRole('region', { name: 'История оплат' }).getByRole('status', { name: 'Загрузка' })).toBeVisible()
    await page.screenshot({ path: info.outputPath('receipts-loading.png'), fullPage: true })
    release()
    await expect(page.getByRole('button', { name: 'Повторить', exact: true })).toBeVisible()
    for (const width of [320, 1440]) {
      await page.setViewportSize({ width, height: 844 })
      await page.screenshot({ path: info.outputPath(`receipts-error-${width}.png`), fullPage: true })
    }
    await page.getByRole('button', { name: 'Повторить', exact: true }).click()
    await expect(page.getByText('Оплат за этот месяц нет.')).toBeVisible()
    await expectReceiptClient(page, clientId)
    await expect(page.getByText('Октябрь 2026')).toBeVisible()
  })

  test('Finance overview search and archive preserve return context without a duplicate clients entry', { tag: ['@lime-finance'] }, async ({ page }, info) => {
    const ledger = await accountingFixture(page)
    const active = { clientId, fullName: ledger.clientName!, archivedAt: null, activeClient: true,
      receivedCents: 1000000, dueCents: 0, nearestPaymentDueOn: null, unpaidPackageCount: 0,
      activePackageCount: 2, upcomingPackageCount: 0, sessionsRemaining: 10, overdue: false,
      lowSessions: false, unassignedSessions: 0, needsAttention: false }
    const archived = { ...active, clientId: conversationId, fullName: 'Дарья Иванова',
      archivedAt: stamp, activeClient: false, receivedCents: 500000, dueCents: 200000,
      nearestPaymentDueOn: '2026-10-31', unpaidPackageCount: 1, overdue: true, needsAttention: true }
    await page.route('**/v1/finance/overview*', route => route.fulfill({ json: { overview: {
      month: '2026-11', receivedCents: 1500000, dueCents: 200000, attentionCount: 1,
      clients: [active, archived],
    } } }))
    await page.goto('/clients')
    await expect(page.locator('.clients-finance-entry')).toHaveCount(0)
    await expect(page.getByRole('searchbox', { name: 'Поиск клиента' })).toBeVisible()
    await page.getByRole('button', { name: 'Понятно', exact: true }).click()
    for (const width of [320, 430, 1440]) {
      await page.setViewportSize({ width, height: 844 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: info.outputPath(`clients-single-finance-entry-${width}.png`), fullPage: true })
    }
    await page.getByRole('navigation', { name: 'Основная навигация' }).getByRole('link', { name: 'Финансы' }).click()
    const rows = page.locator('.finance-overview-client')
    await expect(rows).toHaveCount(1)
    await expect(rows).toContainText('Алексей')
    const search = await openFinanceSearch(page)
    await search.fill('никого')
    await expect(page.getByText('Ничего не найдено.')).toBeVisible()
    await page.screenshot({ path: info.outputPath('finance-empty-search.png'), fullPage: true })
    await clearFinanceSearch(page)
    await chooseFinanceFilter(page, 'Архив')
    await expect(rows).toHaveCount(1)
    await expect(rows).toContainText('Дарья Иванова')
    await expect(rows).toContainText('В архиве')
    for (const width of [320, 430, 1440]) {
      await page.setViewportSize({ width, height: 844 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: info.outputPath(`finance-archive-${width}.png`), fullPage: true })
    }
    await chooseFinanceFilter(page, 'Все')
    await expect(rows).toContainText('Алексей')
    await (await openFinanceSearch(page)).fill('алексей')
    await expect(page).toHaveURL(/q=/)
    await expect(rows).toContainText('Алексей')
    const returnUrl = page.url()
    await rows.click()
    await page.getByRole('button', { name: 'Назад', exact: true }).click()
    await expect(page).toHaveURL(returnUrl)
    await expect(search).toHaveValue('алексей')
  })

  test('Finance overview failure and explicit retry remain readable', { tag: ['@lime-finance'] }, async ({ page }, info) => {
    await accountingFixture(page)
    await page.addInitScript(() => document.addEventListener('click', event => {
      if ((event.target as Element).closest('button')?.textContent === 'Повторить') sessionStorage.setItem('finance-explicit-retry', 'yes')
    }, true))
    await page.route('**/v1/finance/overview*', async route => {
      const retry = await page.evaluate(() => sessionStorage.getItem('finance-explicit-retry') === 'yes')
      if (!retry) return route.fulfill({ status: 503, json: {} })
      return route.fulfill({ json: { overview: { month: '2026-11', receivedCents: 0, dueCents: 0, attentionCount: 0, clients: [] } } })
    })
    await page.goto('/finance')
    const retry = page.getByRole('button', { name: 'Повторить', exact: true })
    await expect(retry).toBeVisible()
    for (const width of [320, 1440]) {
      await page.setViewportSize({ width, height: 844 })
      await page.screenshot({ path: info.outputPath(`finance-read-error-${width}.png`), fullPage: true })
    }
    await retry.click()
    await expect(page.getByText('В этом разделе клиентов нет.')).toBeVisible()
    await page.screenshot({ path: info.outputPath('finance-empty-ledger.png'), fullPage: true })
  })

  test('Finance workout deletion clears fresh attendance and overview caches', { tag: ['@lime-finance'] }, async ({ page }, info) => {
    await page.setViewportSize({ width: 390, height: 844 })
    const attendance = { ...workout, trainerId: coach, createdBy: coach, status: 'done' as const,
      workoutDate: '2026-11-03', completedAt: '2026-11-03T09:00:00Z' }
    const ledger = await accountingFixture(page, true, [attendance])
    const service = ledger.packages[1]!
    Object.assign(service, { sessionsTotal: 3, sessionsUsed: 1, sessionsRemaining: 2,
      priceCents: 300000, paidCents: 300000, dueCents: 0 })
    ledger.packages = [service]
    ledger.payments.push({ id: clientId, packageId: service.id, amountCents: 300000, receivedOn: '2026-11-01',
      source: 'manual', comment: null, voidedAt: null, voidReason: null, version: 1, createdAt: stamp, updatedAt: stamp })
    Object.assign(ledger.sessions[0]!, { packageId: service.id, workoutDate: '2026-11-03' })
    let financeReads = 0, overviewReads = 0, deletes = 0
    await page.route(`**/v1/clients/${clientId}/finance`, route => {
      financeReads++
      return route.fulfill({ json: { finance: ledger } })
    })
    await page.route('**/v1/finance/overview*', route => {
      overviewReads++
      return route.fulfill({ json: { overview: { month: '2026-11', receivedCents: 300000, dueCents: 0,
        attentionCount: service.sessionsRemaining === 2 ? 1 : 0,
        clients: [{ clientId, fullName: ledger.clientName, archivedAt: null, receivedCents: 300000,
          dueCents: 0, nearestPaymentDueOn: null, unpaidPackageCount: 0, activePackageCount: 1,
          upcomingPackageCount: 0, sessionsRemaining: service.sessionsRemaining, overdue: false,
          lowSessions: service.sessionsRemaining === 2, unassignedSessions: 0,
          needsAttention: service.sessionsRemaining === 2 }],
      } } })
    })
    await page.route(`**/v1/workouts/${workoutId}`, route => {
      if (route.request().method() !== 'DELETE') return route.fallback()
      expect(route.request().postDataJSON()).toMatchObject({ expectedVersion: attendance.version })
      deletes++
      ledger.sessions[0]!.voidedAt = '2026-11-03T09:01:00Z'
      service.sessionsUsed = 0; service.sessionsRemaining = 3
      return route.fulfill({ json: { workout: { version: attendance.version + 1 } } })
    })
    await page.goto('/finance')
    const row = page.locator('.finance-overview-client')
    await expect(row).toContainText(/Осталось 2 /)
    await expect(page.locator('.finance-overview-summary').getByText('1', { exact: true })).toBeVisible()
    await row.click()
    await page.getByRole('tab', { name: /^Занятия:/ }).click()
    await expect(page.locator('.finance-session')).toHaveCount(1)
    const beforeDelete = financeReads
    await page.locator('.finance-session').getByRole('link').click()
    await expect(page.getByText('Проведена', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Изменить дату и время тренировки', exact: true })).toContainText('3 ноября 2026')
    await page.getByRole('button', { name: 'Другие действия с тренировкой', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Удалить тренировку', exact: true }).click()
    const dialog = page.getByRole('alertdialog')
    await expect(dialog).toBeVisible()
    await page.screenshot({ path: info.outputPath('workout-delete-confirm.png'), fullPage: true })
    await dialog.getByRole('button', { name: 'Удалить', exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/clients/${clientId}/finance$`))
    // Date.now is fixed by accountingFixture: the 20s cache cannot expire on its own.
    await expect.poll(() => financeReads).toBeGreaterThan(beforeDelete)
    await expect(page.getByRole('tab', { name: 'Оплаты: 1', exact: true })).toBeVisible()
    await page.getByRole('tab', { name: 'Занятия: 0', exact: true }).click()
    await expect(page.locator('.finance-session')).toHaveCount(0)
    await page.screenshot({ path: info.outputPath('finance-after-workout-delete.png'), fullPage: true })
    await page.getByRole('button', { name: 'Назад', exact: true }).click()
    await expect(page).toHaveURL(/\/finance$/)
    await expect(row).toContainText(/Осталось 3 /)
    await expect(page.locator('.finance-overview-summary').getByText('0', { exact: true })).toBeVisible()
    expect(overviewReads).toBeGreaterThan(1)
    expect(deletes).toBe(1)
    await page.screenshot({ path: info.outputPath('overview-after-workout-delete.png'), fullPage: true })
  })

  test('Finance former-client history and refreshed overview keep debt visible with unassigned sessions', { tag: ['@lime-finance'] }, async ({ page }, info) => {
    await page.setViewportSize({ width: 390, height: 844 })
    const ledger = await accountingFixture(page)
    ledger.clientName = 'Александра Константинопольская — история занятий'
    ledger.canCreate = false
    const service = ledger.packages[0]!
    Object.assign(service, { priceCents: 2500000, paidCents: 1000000, dueCents: 1500000, paymentStatus: 'overdue' })
    Object.assign(ledger.packages[1]!, { priceCents: 0, paidCents: 0 })
    ledger.payments.push({ id: conversationId, packageId: service.id, amountCents: 1000000,
      receivedOn: '2026-10-01', source: 'opening', comment: null, voidedAt: null, voidReason: null,
      version: 1, createdAt: stamp, updatedAt: stamp })
    Object.assign(ledger.sessions[0]!, { disposition: 'unassigned', packageId: null })
    await page.route('**/v1/clients?*', route => route.fulfill({ status: 403, json: {} }))
    await page.route('**/v1/finance/overview*', route => route.fulfill({ json: { overview: {
      month: '2026-11', receivedCents: service.paidCents - 1000000, dueCents: service.dueCents, attentionCount: 1,
      clients: [{ clientId, fullName: ledger.clientName, archivedAt: null, receivedCents: 0,
        dueCents: service.dueCents, overdueCents: service.dueCents, nearestPaymentDueOn: '2026-10-31', unpaidPackageCount: 1,
        activePackageCount: 1, upcomingPackageCount: 0, sessionsRemaining: 10, overdue: true,
        lowSessions: false, unassignedSessions: 1, needsAttention: true }],
    } } }))
    await page.route(`**/v1/finance/packages/${service.id}/payments`, route => {
      expect(route.request().postDataJSON()).toMatchObject({ amountCents: 500000 })
      service.paidCents += 500000; service.dueCents -= 500000
      const payment = { id: clientId, packageId: service.id, amountCents: 500000, receivedOn: '2026-11-03',
        source: 'manual' as const, comment: null, voidedAt: null, voidReason: null, version: 1, createdAt: stamp, updatedAt: stamp }
      ledger.payments.push(payment)
      return route.fulfill({ json: { payment } })
    })
    await page.goto('/finance?filter=due')
    const row = page.locator('.finance-overview-client')
    await expect(row).toContainText(/К оплате 15\s000/)
    await expect(row).toContainText(/Из них просрочено 15\s000/)
    await expect(row).toContainText('Не привязано: 1')
    for (const width of [320, 430, 1440]) {
      await page.setViewportSize({ width, height: 844 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: info.outputPath(`debt-and-unassigned-${width}.png`), fullPage: true })
    }
    await row.click()
    await expect(page.locator('.page-title-group')).toContainText(ledger.clientName)
    await page.locator('.finance-history > summary').click()
    const history = page.locator('.finance-history .finance-package')
    await expect(history).toContainText(service.title)
    for (const width of [320, 430, 1440]) {
      await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 })
      await history.scrollIntoViewIfNeeded()
      await expect(history.getByRole('button', { name: 'Внести оплату', exact: true })).toBeInViewport()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: info.outputPath(`former-client-history-${width}.png`), fullPage: true })
    }
    await history.getByRole('button', { name: 'Внести оплату', exact: true }).click()
    await page.getByLabel('Сумма, ₽').fill('5000')
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click()
    await expect(page.locator('.finance-form')).toHaveCount(0)
    await page.getByRole('button', { name: 'Назад', exact: true }).click()
    await expect(page).toHaveURL(/\/finance\?filter=due$/)
    await expect(row).toContainText(/К оплате 10\s000/)
    await expect(row).toContainText(/Из них просрочено 10\s000/)
    await expect(row).toContainText('Не привязано: 1')
    await page.screenshot({ path: info.outputPath('overview-after-payment.png'), fullPage: true })
  })

  // One behavior chain per engine; responsive snapshots resize the same state
  // to check native date/select, long names and the retry CTA, without replays.
  test('Finance accounting dates and uncertain manual retry preserve one operation', { tag: ['@lime-finance'] }, async ({ page }, info) => {
    await page.setViewportSize({ width: 390, height: 844 })
    const ledger = await accountingFixture(page)
    const commands: TrainerFinanceManualSessionDraft[] = []
    await page.route(`**/v1/clients/${clientId}/finance/sessions`, async route => {
      const draft = route.request().postDataJSON() as TrainerFinanceManualSessionDraft
      commands.push(draft)
      if (commands.length === 1) return route.fulfill({ status: 503, json: {} })
      const session = { ...ledger.sessions[0]!, id: commands.length === 2 ? newWorkoutId : clientId, workoutId: commands.length === 2 ? newWorkoutId : clientId,
        packageId: draft.packageId, disposition: draft.disposition, workoutDate: draft.workoutDate,
        source: 'manual' as const, comment: draft.comment }
      ledger.sessions.push(session)
      return route.fulfill({ json: { session } })
    })
    await page.goto(`/clients/${clientId}/finance`)
    await page.getByRole('tab', { name: 'Занятия: 1' }).click()
    await page.getByRole('button', { name: 'Добавить', exact: true }).click()
    const form = page.locator('.finance-manual-session')
    await form.getByLabel('Дата занятия').fill('2026-10-20')
    // A fully consumed October service is unavailable to a new session.
    await expect(form.locator('input[type=radio][value^="charged:"]')).toHaveCount(0)
    await form.getByRole('radio', { name: 'Пробное занятие' }).click()
    await form.getByLabel('Комментарий').fill('Пробное занятие после перерыва')
    await form.getByRole('button', { name: 'Добавить', exact: true }).click()
    await expect(form.getByRole('button', { name: 'Повторить сохранение' })).toBeEnabled()
    await expect(form.getByLabel('Дата занятия')).toBeDisabled()
    await expect(form.getByLabel('Дата занятия')).toHaveCSS('opacity', '1')
    await expect(form.getByRole('alert')).toBeVisible()
    for (const width of [320, 430, 1440]) {
      await page.setViewportSize({ width, height: 844 })
      await formGeometry(form)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: info.outputPath(`manual-uncertain-${width}.png`), fullPage: true })
    }
    await form.getByRole('button', { name: 'Отмена' }).click()
    expect(commands).toHaveLength(1)
    await page.getByRole('button', { name: 'Проверить сохранение' }).click()
    await expect(form.getByLabel('Комментарий')).toHaveValue('Пробное занятие после перерыва')
    await form.getByRole('button', { name: 'Повторить сохранение' }).click()
    await expect(page.getByRole('tab', { name: 'Занятия: 2' })).toBeVisible()
    expect(commands).toHaveLength(2)
    expect(commands[1]).toEqual(commands[0])
    await page.getByRole('button', { name: 'Добавить', exact: true }).click()
    await form.getByLabel('Дата занятия').fill('2026-11-03')
    await expect(form.getByRole('radio', { name: /Ноябрь.*осталось/ })).toBeAttached()
    await form.locator(`input[type=radio][value="charged:${newWorkoutId}"]`).check()
    await form.getByRole('button', { name: 'Добавить', exact: true }).click()
    await expect(page.getByRole('tab', { name: 'Занятия: 3' })).toBeVisible()
    expect(commands[2]!.requestId).not.toBe(commands[0]!.requestId)
  })

  test('Finance session date editor retains its current charge and updates eligible services', { tag: ['@lime-finance'] }, async ({ page }, info) => {
    await page.setViewportSize({ width: 390, height: 844 })
    const ledger = await accountingFixture(page)
    await page.goto(`/clients/${clientId}/finance`)
    await page.getByRole('tab', { name: 'Занятия: 1' }).click()
    await page.getByRole('button', { name: /Действия с занятием/ }).click()
    await page.getByRole('menuitem', { name: 'Изменить учёт' }).click()
    const form = page.locator('.finance-session-editor')
    await expect(form.locator(`input[type=radio][value="charged:${conversationId}"]`)).toBeChecked()
    await page.screenshot({ path: info.outputPath('current-charge.png'), fullPage: true })
    await form.getByLabel('Дата').fill('2026-11-03')
    await expect(form.getByRole('radio', { name: 'Выбрать абонемент позже' })).toBeChecked()
    await expect(form.getByRole('radio', { name: /Октябрь/ })).toHaveCount(0)
    await form.locator(`input[type=radio][value="charged:${newWorkoutId}"]`).check()
    await page.route(`**/v1/finance/sessions/${workoutId}`, route => {
      expect(route.request().postDataJSON()).toMatchObject({ workoutDate: '2026-11-03', packageId: newWorkoutId, disposition: 'charged' })
      Object.assign(ledger.sessions[0]!, { workoutDate: '2026-11-03', packageId: newWorkoutId, version: 2 })
      return route.fulfill({ json: { session: ledger.sessions[0] } })
    })
    for (const width of [320, 430, 1440]) {
      await page.setViewportSize({ width, height: 844 })
      await formGeometry(form)
      await page.screenshot({ path: info.outputPath(`session-new-date-${width}.png`), fullPage: true })
    }
    await form.getByRole('button', { name: 'Сохранить', exact: true }).click()
    await expect(form).toHaveCount(0)
    await expect(page.locator('.finance-session-list')).toContainText('Ноябрь')
  })
}
