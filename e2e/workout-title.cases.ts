import { expect, test } from '@playwright/test'
import { mockPilot, restTimerWorkout, workoutId, coachGestureWorkout, clientId } from './fit-lime-fixtures'

export function workoutTitleCases() {
  test('title rename changes metadata and the athlete reads the same title without author controls', async ({ page }, info) => {
    const coach = '69200000-0000-4000-8000-000000000001'
    const athlete = '69200000-0000-4000-8000-000000000002'
    const source = { ...restTimerWorkout(), title: 'Ноги', status: 'done' as const, createdBy: coach, completedAt: '2026-10-29T10:00:00Z' }
    const original = structuredClone(source)
    const backend = await mockPilot(page, { profileId: coach, fitLime: true, workouts: [source] })
    const writes: unknown[] = []
    await page.route(`**/v1/workouts/${workoutId}/title`, async route => {
      const body = route.request().postDataJSON() as { title: string; expectedVersion: number }
      writes.push(body)
      const current = backend.getWorkouts()[0]!
      expect(body.expectedVersion).toBe(current.version)
      Object.assign(current, { title: body.title, version: current.version + 1 })
      await route.fulfill({ json: { workout: { id: workoutId, version: current.version } } })
    })
    const base = `http://127.0.0.1:${Number(process.env.FIT_TEST_PORT ?? 5173) + 1000}`
    await page.goto(`${base}/workouts/${workoutId}`)
    const detail = page.locator('.coach-exercise-first')
    const summary = detail.locator('.coach-workout-summary')
    await expect(detail.getByRole('heading', { name: 'Ноги', exact: true })).toHaveCSS('font-size', '32px')
    await expect(detail.locator('.workout-header-meta')).toHaveCSS('font-size', '15px')
    await expect(summary).toHaveJSProperty('open', false)
    await expect(detail.locator('.workout-fact-summary')).toBeHidden()
    expect(await detail.evaluate(element => {
      const review = element.querySelector('.coach-trainer-review')!, exercises = element.querySelector('.completed-exercise-list')!, totals = element.querySelector('.coach-workout-summary')!
      return Boolean(review.compareDocumentPosition(exercises) & Node.DOCUMENT_POSITION_FOLLOWING)
        && Boolean(exercises.compareDocumentPosition(totals) & Node.DOCUMENT_POSITION_FOLLOWING)
    })).toBe(true)
    await summary.locator('summary').click()
    await expect(detail.locator('.workout-fact-summary')).toBeVisible()
    await expect(summary.getByRole('button', { name: /^(Указать|Изменить) длительность$/ })).toBeVisible()
    await summary.locator('summary').click()
    await page.locator('.content').evaluate(element => { element.scrollTop = 0 })
    await page.screenshot({ path: info.outputPath('coach-exercises-before-totals.png') })
    await page.getByRole('button', { name: 'Другие действия с тренировкой', exact: true }).click()
    const content = page.locator('.content')
    const beforeRename = await content.evaluate(element => element.scrollTop)
    await page.getByRole('menuitem', { name: 'Переименовать тренировку', exact: true }).click()
    const sheet = page.getByRole('dialog', { name: 'Переименовать тренировку', exact: true })
    await expect(sheet.getByLabel('Название', { exact: true })).toHaveValue('Ноги')
    // Viewport geometry is simulated; this is not a physical keyboard test.
    await page.evaluate(() => {
      Object.defineProperty(window.visualViewport, 'height', { configurable: true, value: 400 })
      Object.defineProperty(window.visualViewport, 'offsetTop', { configurable: true, value: 70 })
      window.visualViewport!.dispatchEvent(new Event('resize'))
    })
    await expect.poll(() => sheet.getByLabel('Название', { exact: true }).evaluate(element => element.getBoundingClientRect().bottom)).toBeLessThanOrEqual(470)
    await sheet.getByRole('button', { name: 'Закрыть', exact: true }).click()
    await expect(sheet).toHaveCount(0)
    await page.evaluate(() => {
      Object.defineProperty(window.visualViewport, 'height', { configurable: true, value: innerHeight })
      Object.defineProperty(window.visualViewport, 'offsetTop', { configurable: true, value: 0 })
      window.visualViewport!.dispatchEvent(new Event('resize'))
    })
    await expect.poll(() => content.evaluate(element => element.scrollTop)).toBe(beforeRename)
    await page.getByRole('button', { name: 'Другие действия с тренировкой', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Переименовать тренировку', exact: true }).click()
    await sheet.getByLabel('Название', { exact: true }).fill('Ноги и спина')
    await sheet.getByRole('button', { name: 'Сохранить', exact: true }).click()
    await expect(sheet).toHaveCount(0)
    await expect(page.getByText('Ноги и спина', { exact: true })).toBeVisible()
    expect(writes).toEqual([{ title: 'Ноги и спина', expectedVersion: original.version }])
    expect(backend.getWorkouts()[0]!.exercises).toEqual(original.exercises)
    const renamed = structuredClone(backend.getWorkouts()[0]!)
    await mockPilot(page, { role: 'client', profileId: athlete, clientLime: true, workouts: [renamed] })
    await page.goto(`${base}/workouts/${workoutId}`)
    await expect(page.getByText('Ноги и спина', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Другие действия с тренировкой', exact: true }).click()
    await expect(page.getByRole('menuitem', { name: 'Переименовать тренировку', exact: true })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await page.screenshot({ path: info.outputPath('athlete-shared-title.png') })
  })
  for (const role of ['trainer', 'client'] as const) test(`named history remains compact for ${role}`, async ({ page }, info) => {
    const profileId = '69200000-0000-4000-8000-000000000001'
    await page.clock.setFixedTime(new Date('2026-10-30T09:00:00Z'))
    const source = { ...coachGestureWorkout(false, 5), title: 'Спина и ноги — тренировка с длинным названием', trainerReview: 'Хорошая техника, в следующий раз сохраняем вес.', trainerReaction: 'strong' as const, createdBy: profileId, startedAt: '2026-10-29T09:00:00Z', status: 'done' as const, workoutDate: '2026-10-29', completedAt: '2026-10-29T10:00:00Z' }
    await mockPilot(page, { role, profileId, fitLime: true, clientLime: true, workouts: [source] })
    const base = `http://127.0.0.1:${Number(process.env.FIT_TEST_PORT ?? 5173) + 1000}`
    await page.goto(base + (role === 'trainer' ? `/clients/${clientId}/workouts?view=list` : '/me/workouts?tab=history&view=list'))
    if (role === 'trainer') await page.locator('.coachmark-bubble').filter({ hasText: 'История по датам' }).getByRole('button', { name: 'Понятно' }).click()
    const card = page.locator('.workout-chronicle-card').first()
    await expect(card.getByRole('heading', { name: source.title, exact: true })).toBeVisible()
    await expect(card.locator('.workout-chronicle-brief')).toHaveText(source.exercises.slice(0, 3).map(exercise => exercise.name).join(' · ') + ' · ещё 2')
    await expect(card.locator('.workout-chronicle-response')).toContainText(source.trainerReview)
    expect(await card.evaluate(element => Boolean(element.querySelector('.workout-chronicle-response')!.compareDocumentPosition(element.querySelector('.workout-chronicle-exercises')!) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(role === 'trainer')
    if (role === 'trainer') await expect(card.locator('.workout-chronicle-facts')).toHaveCount(0)
    else await expect(card.locator('.workout-chronicle-facts')).toContainText('1 ч 00 мин')
    const geometry = await card.evaluate(element => {
      const title = element.querySelector('h2')!, date = element.querySelector('time')!
      return { titleSize: parseFloat(getComputedStyle(title).fontSize), dateSize: parseFloat(getComputedStyle(date).fontSize), titleTop: title.getBoundingClientRect().top, dateTop: date.getBoundingClientRect().top }
    })
    expect(geometry.dateSize).toBeLessThan(geometry.titleSize)
    expect(geometry.dateTop).toBeGreaterThan(geometry.titleTop)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await card.screenshot({ path: info.outputPath(`${role}-named-card.png`) })
  })

  test('trainer preserves editable names through copy and source template', async ({ page }, info) => {
    const profileId = '69200000-0000-4000-8000-000000000001'
    const source = { ...coachGestureWorkout(false, 2), title: 'я'.repeat(120), trainerReview: 'Сохранить технику, не торопиться с увеличением веса.', createdBy: profileId, status: 'done' as const, workoutDate: '2026-10-29', completedAt: '2026-10-29T10:00:00Z' }
    const backend = await mockPilot(page, { profileId, fitLime: true, workouts: [source] })
    const original = JSON.stringify(backend.getWorkouts()[0])
    const creations: Array<{ title?: string }> = []
    page.on('request', request => { if (new URL(request.url()).pathname === '/v1/workouts' && request.method() === 'POST') creations.push(request.postDataJSON() as { title?: string }) })
    const templateId = '69200000-0000-4000-8000-000000000010'
    const stored = { id: templateId, trainerId: profileId, name: 'Шаблон: Спина и ноги', notes: '', version: 1, createdAt: '2026-10-30T09:00:00Z', updatedAt: '2026-10-30T09:00:00Z', exercises: source.exercises.map(exercise => ({ ...exercise, sets: exercise.sets.map(set => ({ position: set.position, weightKg: set.weightKg, reps: set.reps })) })) }
    await page.route(`**/v1/workout-templates/${templateId}`, route => route.fulfill({ json: { template: stored } }))
    const templateWrites: Array<{ name: string }> = []
    await page.route('**/v1/workout-templates', async route => {
      if (route.request().method() !== 'POST') return route.fallback()
      const body = route.request().postDataJSON() as { draft: typeof stored }
      templateWrites.push(body.draft)
      await route.fulfill({ json: { template: { ...stored, ...body.draft } } })
    })
    const base = `http://127.0.0.1:${Number(process.env.FIT_TEST_PORT ?? 5173) + 1000}`
    await page.goto(`${base}/schedule/templates/from-workout`)
    const sourceCard = page.locator('.template-source-workout').first()
    await expect(sourceCard.locator('strong')).toHaveText(source.title)
    await expect(sourceCard.locator('.workout-source-review')).toContainText(source.trainerReview)
    await expect(sourceCard.locator('.template-source-exercises')).toHaveText(source.exercises.map(exercise => exercise.name).join(' · '))
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await sourceCard.screenshot({ path: info.outputPath('template-source-context.png') })
    await page.goto(`${base}/workouts/new?copy=${source.id}`)
    await expect(page.getByLabel('Название тренировки', { exact: true })).toHaveValue(source.title)
    await page.getByLabel('Название тренировки', { exact: true }).fill('Самостоятельная копия')
    await page.getByRole('button', { name: 'Сохранить план', exact: true }).click()
    await expect.poll(() => creations.length).toBe(1)
    expect(creations[0]!.title).toBe('Самостоятельная копия')
    await page.goto(`${base}/workouts/${source.id}`)
    await page.getByRole('button', { name: 'Другие действия с тренировкой', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Сохранить как шаблон', exact: true }).click()
    const name = page.getByLabel('Название шаблона', { exact: true })
    await expect(name).toHaveValue(source.title)
    await expect(name).toHaveAttribute('maxlength', '120')
    await name.fill('Шаблон на завтра')
    await page.getByRole('button', { name: 'Сохранить шаблон', exact: true }).click()
    await expect.poll(() => templateWrites.length).toBe(1)
    expect(templateWrites[0]!.name).toBe('Шаблон на завтра')
    expect(templateWrites[0]).not.toHaveProperty('trainerReview')
    await page.goto(`${base}/workouts/new?template=${templateId}&client=${clientId}`)
    await expect(page.getByLabel('Название тренировки', { exact: true })).toHaveValue(stored.name)
    await page.getByLabel('Название тренировки', { exact: true }).fill('Тренировка из шаблона')
    expect(JSON.stringify(backend.getWorkouts().find(item => item.id === source.id))).toBe(original)
    expect(stored.name).toBe('Шаблон: Спина и ноги')
  })

  test('athlete keeps an editable source name in favorite and a new workout outside the reference pilot', async ({ page }) => {
    const profileId = '69200000-0000-4000-8000-000000000002'
    const source = { ...coachGestureWorkout(false, 2), title: 'Спина и ноги', createdBy: profileId, status: 'done' as const, workoutDate: '2026-10-29', completedAt: '2026-10-29T10:00:00Z' }
    await mockPilot(page, { role: 'client', profileId, clientLime: false, workouts: [source] })
    const favoriteId = '69200000-0000-4000-8000-000000000011'
    let favorite: { id: string; title: string; exercises: unknown[]; version: number; createdAt: string } | null = null
    await page.route('**/v1/favorite-workouts', async route => {
      if (route.request().method() === 'POST') {
        const command = route.request().postDataJSON() as { title: string; exercises: unknown[] }
        favorite = { ...command, id: favoriteId, version: 1, createdAt: '2026-10-30T09:00:00Z' }
        return route.fulfill({ json: favorite })
      }
      return route.fulfill({ json: { favorites: favorite ? [favorite] : [] } })
    })
    const base = `http://127.0.0.1:${Number(process.env.FIT_TEST_PORT ?? 5173) + 1000}`
    await page.goto(`${base}/workouts/${source.id}`)
    await page.getByRole('button', { name: 'Другие действия с тренировкой', exact: true }).click()
    await page.getByRole('menuitem', { name: 'В избранное', exact: true }).click()
    const sheet = page.getByRole('dialog', { name: 'Сохранить в избранное', exact: true })
    await expect(sheet.getByLabel('Название', { exact: true })).toHaveValue(source.title)
    await sheet.getByLabel('Название', { exact: true }).fill('Мой вариант')
    await sheet.getByRole('button', { name: 'Сохранить', exact: true }).click()
    await expect(sheet).toHaveCount(0)
    await page.goto(`${base}/workouts/new?favorite=${favoriteId}`)
    await expect(page.getByLabel('Название тренировки', { exact: true })).toHaveValue('Мой вариант')
    await page.getByLabel('Название тренировки', { exact: true }).fill('Новая тренировка')
    await page.getByRole('button', { name: 'Сохранить план', exact: true }).click()
    await expect(page).toHaveURL(/\/workouts\/[0-9a-f-]+$/)
    await expect(page.getByText('Новая тренировка', { exact: true })).toBeVisible()
    expect(favorite).toMatchObject({ title: 'Мой вариант' })
    expect(source.title).toBe('Спина и ноги')
  })

}
