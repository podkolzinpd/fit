import { z } from 'zod'
import { expect, test, type Page } from '@playwright/test'
import { beginClientGesture, coachGestureWorkout, restTimerWorkout, holdClientLiveCard, mockClientStreamingVoice, mockPilot, mockPublicTrainer, publicTrainerDraft, publicTrainerId, newWorkoutId, workoutId, conversationId, messageId, clientId } from './fit-lime-fixtures'

test.skip(process.env.FIT_CLIENT_WORKOUT_ACCEPTANCE !== '1', 'Dedicated native client-workout harness')

const pilotId = 'c11e0000-6010-4000-8000-000000000001'

// Restore the real assistant surface through its supported draft contract.
for (const theme of ['light', 'dark']) test(`client reference assistant draft retains edits and failed-save recovery ${theme}`, async ({ page }, info) => {
  await page.clock.setFixedTime(new Date('2026-09-24T12:00:00Z'))
  const actionId = 'c11e0000-6010-4000-8000-000000000090'
  const storageKey = `fit:assistant-workout-draft:v1:${pilotId}:${conversationId}:${clientId}`
  await page.addInitScript(({ id, theme, storageKey }) => {
    localStorage.setItem(`fit.clientLime.theme.${id}`, theme)
    localStorage.setItem(storageKey, JSON.stringify({ transcript: '', rawFragments: ['Присед 3 по 10', 'Присед 2 по 8'], workoutDate: '2026-09-24', startTime: '15:00', requestId: 'c11e0000-6010-4000-8000-000000000091', result: { items: [
      { sourceText: 'Присед 3 по 10', exerciseRef: 'barbell-squat', confidence: 1, sets: Array.from({ length: 3 }, () => ({ reps: 10, weightKg: 50 })) },
      { sourceText: 'Присед 2 по 8', exerciseRef: 'barbell-squat', confidence: 1, sets: Array.from({ length: 2 }, () => ({ reps: 8, weightKg: 40 })) },
    ], unmatched: [] } }))
  }, { id: pilotId, theme, storageKey })
  await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true })
  await page.route('**/v1/assistant/conversations', route => route.fulfill({ json: { conversations: [{ id: conversationId, title: 'Сегодня', createdAt: '2026-09-24T10:00:00Z' }] } }))
  await page.route(`**/v1/assistant/conversations/${conversationId}/messages`, route => route.fulfill({ json: { messages: [{ id: messageId, conversationId, turnId: null, author: 'assistant', content: 'Проверьте тренировку', createdAt: '2026-09-24T10:01:00Z', action: { id: actionId, tool: 'record_workout', status: 'proposed', title: 'Тренировка', description: 'Проверьте тренировку', payload: { step: 'confirm', clientId, clientName: 'Тестовый спортсмен' } } }] } }))
  const commands: Array<{ input: { workout: { requestId: string; workoutDate: string; startTime: string; exercises: Array<{ blockId: string; sets: Array<{ weightKg?: number }> }> } } }> = []
  await page.route(`**/v1/assistant/actions/${actionId}/apply`, route => {
    commands.push(route.request().postDataJSON() as typeof commands[number])
    return route.fulfill(commands.length === 1 ? { status: 503, json: { error: 'unavailable' } } : { json: { result: { status: 'applied', version: 2 } } })
  })
  await page.goto('/assistant')
  const draft = page.locator('.assistant-workout-draft')
  await expect(draft).toBeVisible()
  await expect(page.locator('.client-screen-reference')).toBeVisible()
  await expect(draft.locator('.assistant-workout-result-row')).toHaveCount(2)
  for (const width of [390, 430]) {
    await page.setViewportSize({ width, height: 844 })
    await expect(draft).toHaveCSS('border-radius', '32px')
    expect(await draft.getByRole('button', { name: /Удалить/ }).first().evaluate(element => element.getBoundingClientRect().width)).toBeGreaterThanOrEqual(44)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: info.outputPath(`assistant-${theme}-${width}.png`) })
  }
  await draft.getByLabel('Вес', { exact: true }).first().fill('55')
  await draft.getByLabel('Дата', { exact: true }).fill('2026-09-25')
  await draft.getByLabel('Время', { exact: true }).fill('16:30')
  await draft.getByRole('button', { name: /Удалить/ }).last().click()
  await expect(draft.locator('.assistant-workout-result-row')).toHaveCount(1)
  await draft.getByRole('button', { name: 'Сохранить тренировку', exact: true }).click()
  await expect(draft.getByRole('alert')).toContainText('Не удалось сохранить тренировку')
  await expect(draft.getByLabel('Вес', { exact: true })).toHaveValue('55')
  await draft.getByRole('button', { name: 'Сохранить тренировку', exact: true }).click()
  await expect(draft).toHaveCount(0)
  expect(commands).toHaveLength(2)
  // Block UUIDs are transient composer IDs; the command requestId and all
  // user-entered data must survive retry unchanged. Validate both UUIDs too.
  for (const command of commands) expect(z.uuid().safeParse(command.input.workout.exercises[0]!.blockId).success).toBe(true)
  const normalized = commands.map(command => ({ ...command, input: { workout: { ...command.input.workout, exercises: command.input.workout.exercises.map(exercise => ({ ...exercise, blockId: 'transient-block' })) } } }))
  expect(normalized[1]).toEqual(normalized[0])
  expect(commands[1]!.input.workout).toMatchObject({ workoutDate: '2026-09-25', startTime: '16:30' })
  expect(commands[1]!.input.workout.exercises[0]!.sets[0]!.weightKg).toBe(55)
  expect(await page.evaluate(key => localStorage.getItem(key), storageKey)).toBeNull()
})

// Home geometry differs with the palette and narrow viewport. Existing Live
// behavior remains covered below; do not multiply its transitions here.
for (const theme of ['light', 'dark']) test(`client reference home preserves entry actions ${theme}`, async ({ page }, info) => {
  await page.addInitScript(({ id, theme }) => localStorage.setItem(`fit.clientLime.theme.${id}`, theme), { id: pilotId, theme })
  const source = coachGestureWorkout(false, 1)
  await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [source] })
  await page.goto('/me')
  await expect(page.locator('.client-screen-reference')).toBeVisible()
  const quick = page.getByRole('region', { name: 'Тренировка сейчас' })
  const continueButton = quick.getByRole('button', { name: 'Продолжить тренировку', exact: true })
  await expect(continueButton).toBeVisible()
  for (const width of [390, 430]) {
    await page.setViewportSize({ width, height: 844 })
    await expect(quick).toHaveCSS('border-radius', '32px')
    expect(await continueButton.evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(48)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: info.outputPath(`home-${theme}-${width}.png`) })
  }
  await page.getByRole('button', { name: 'Ввести текстом', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Разобрать тренировку', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Выбрать упражнения вручную', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Скрыть', exact: true }).click()
  await continueButton.click()
  await expect(page).toHaveURL(new RegExp(`/workouts/${workoutId}/live$`))
  await expect(page.locator('.live-workout-page')).toBeVisible()
})

for (const theme of ['light', 'dark']) test(`client inactivity actions share Lime geometry ${theme}`, async ({ page }, info) => {
  await page.addInitScript(({ id, theme, workoutId }) => {
    localStorage.setItem(`fit.clientLime.theme.${id}`, theme)
    localStorage.setItem(`fit:workout-inactivity:${id}:${workoutId}`, JSON.stringify({ version: 1, userId: id, workoutId, dueAt: Date.now() - 1000 }))
  }, { id: pilotId, theme, workoutId })
  const source = coachGestureWorkout(false, 1)
  source.startedAt = new Date(Date.now() - 8 * 3600000).toISOString()
  await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [source] })
  await page.route('**/v1/push-notifications/status', route => route.fulfill({ json: { status: { subscribed: false, preferences: { workout_reminder: true, workout_scheduled: true, chat_message: true } } } }))
  await page.goto(`/workouts/${workoutId}/live`)
  const reminder = page.getByRole('alert', { name: 'Тренировка ещё идёт', exact: true })
  for (const density of ['original', 'compact']) {
    await page.evaluate(({ id, density }) => localStorage.setItem(`fit.clientLiveDensity.${id}`, density), { id: pilotId, density })
    await page.reload()
    await expect(reminder).toBeVisible()
    const buttons = reminder.getByRole('button')
    const geometry = await buttons.evaluateAll(elements => elements.map(element => {
      const style = getComputedStyle(element), box = element.getBoundingClientRect()
      return { height: box.height, radius: style.borderRadius, font: style.fontFamily, size: style.fontSize, weight: style.fontWeight, y: box.y }
    }))
    expect(geometry).toHaveLength(2)
    expect(geometry[0]).toEqual(geometry[1])
    expect(geometry[0]!.height).toBe(density === 'original' ? 60 : 48)
    for (const button of await buttons.all()) {
      expect(await button.evaluate(element => {
        const box = element.getBoundingClientRect()
        return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2))
      })).toBe(true)
    }
    const add = page.locator('button.live-add-exercise')
    await expect(add).toHaveCSS('min-height', density === 'original' ? '60px' : '48px')
    await reminder.screenshot({ path: info.outputPath(`reminder-${density}.png`) })
  }
  await reminder.getByRole('button', { name: 'Продолжить', exact: true }).click()
  await expect(reminder).toHaveCount(0)
  await expect(page.locator('.live-workout-page')).toBeVisible()
})


// List titles and calendar markers share tokens but retain separate navigation.
for (const theme of ['light', 'dark']) test(`client reference workout lists retain calendar and history ${theme}`, async ({ page }, info) => {
  await page.clock.setFixedTime(new Date('2026-09-24T12:00:00Z'))
  await page.addInitScript(({ id, theme }) => localStorage.setItem(`fit.clientLime.theme.${id}`, theme), { id: pilotId, theme })
  const planned = { ...coachGestureWorkout(false, 1), status: 'planned', title: 'Грудь и плечи', workoutDate: '2026-09-24' } as ReturnType<typeof coachGestureWorkout>
  const completed = { ...planned, id: newWorkoutId, status: 'done', title: 'Спина и руки', completedAt: '2026-09-24T11:00:00Z' } as ReturnType<typeof coachGestureWorkout>
  await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [planned, completed] })
  await page.goto('/me/workouts')
  await expect(page.getByRole('heading', { name: planned.title!, exact: true })).toBeVisible()
  for (const width of [390, 430]) {
    await page.setViewportSize({ width, height: 844 })
    await expect(page.locator('.client-workout-card')).toHaveCSS('border-radius', '32px')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: info.outputPath(`workouts-${theme}-${width}.png`) })
  }
  await page.getByRole('button', { name: 'Календарь', exact: true }).click()
  await expect(page.locator('.client-history-calendar')).toBeVisible()
  await page.getByRole('button', { name: '24 сентября 2026 г., 1 тренировка', exact: true }).click()
  const marker = page.locator('.client-history-calendar-day.selected .lime-calendar-day-marker')
  await expect(marker).toHaveCSS('width', '36px')
  await expect(marker).toHaveCSS('height', '36px')
  await page.getByRole('tab', { name: 'История', exact: true }).click()
  await page.getByRole('button', { name: 'Список', exact: true }).click()
  await expect(page.getByRole('heading', { name: completed.title!, exact: true })).toBeVisible()
  await expect(page.locator('.workout-chronicle-copy')).toHaveAttribute('href', `/workouts/new?copy=${newWorkoutId}`)
  await page.getByRole('tab', { name: 'Готовые тренировки', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Избранное', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Тренировки Fit', exact: true })).toBeVisible()
})

for (const theme of ['light', 'dark']) test(`client reference people rows retain chat and trainer filters ${theme}`, async ({ page }, info) => {
  await page.addInitScript(({ id, theme }) => localStorage.setItem(`fit.clientLime.theme.${id}`, theme), { id: pilotId, theme })
  await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true })
  await mockPublicTrainer(page)
  await page.route('**/v1/trainers/catalog*', route => route.fulfill({ json: { items: [{ publicId: publicTrainerId, profile: { ...publicTrainerDraft, photos: [] }, isBrandTrainer: false }], totalCount: 1, nextOffset: null } }))
  await page.goto('/chat')
  const thread = page.locator('.chat-thread').first()
  await expect(thread.locator('.chat-avatar')).toHaveCSS('width', '40px')
  await expect(thread.locator('.chat-thread-meta b')).toBeVisible()
  await page.screenshot({ path: info.outputPath(`messages-${theme}.png`) })
  await thread.click()
  await expect(page).toHaveURL(new RegExp(`/chat/${conversationId}$`))
  await expect(page.locator('.chat-conversation-page')).toBeVisible()
  await page.goto('/me/trainers')
  await expect(page.getByRole('heading', { name: 'Тестовый тренер', exact: true })).toBeVisible()
  for (const width of [390, 430]) {
    await page.setViewportSize({ width, height: 844 })
    await expect(page.locator('.trainer-catalog-card')).toHaveCSS('border-radius', '32px')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: info.outputPath(`trainers-${theme}-${width}.png`) })
  }
  await page.getByLabel('Имя тренера', { exact: true }).fill('Тестовый')
  await page.getByRole('button', { name: 'Найти', exact: true }).click()
  await page.getByRole('button', { name: 'Фильтры', exact: true }).click()
  const sheet = page.getByRole('dialog', { name: 'Фильтры тренеров' })
  await expect(sheet).toHaveCSS('border-top-left-radius', '40px')
  await sheet.getByLabel('Город', { exact: true }).fill('Москва')
  await sheet.getByRole('button', { name: 'Показать тренеров', exact: true }).click()
  await expect(sheet).toHaveCount(0)
  await expect(page.getByLabel('Имя тренера', { exact: true })).toHaveValue('Тестовый')
})

for (const theme of ['light', 'dark']) test(`client reference profile settings retain independent preferences ${theme}`, async ({ page }, info) => {
  await page.addInitScript(({ id, theme }) => localStorage.setItem(`fit.clientLime.theme.${id}`, theme), { id: pilotId, theme })
  await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, clientGender: 'male' })
  await page.goto('/me/profile')
  await expect(page.locator('.client-profile-avatar')).toHaveCSS('width', '56px')
  await page.screenshot({ path: info.outputPath(`profile-${theme}.png`) })
  await page.getByRole('link', { name: 'Настройки профиля', exact: true }).click()
  await expect(page).toHaveURL(/\/me\/settings$/)
  const animation = page.getByRole('switch', { name: 'Анимация в Live', exact: true })
  await expect(animation).toBeChecked()
  await page.getByRole('radio', { name: 'Компактный', exact: true }).click()
  await expect(animation).toBeChecked()
  await animation.click()
  await expect(animation).not.toBeChecked()
  await page.getByRole('radio', { name: 'Список', exact: true }).click()
  await page.reload()
  await expect(page.getByRole('radio', { name: 'Компактный', exact: true })).toHaveAttribute('aria-checked', 'true')
  await expect(animation).not.toBeChecked()
  await expect(page.getByRole('radio', { name: 'Список', exact: true })).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByLabel('Тема оформления')).toHaveValue(theme)
  for (const width of [390, 430]) {
    await page.setViewportSize({ width, height: 844 })
    await animation.scrollIntoViewIfNeeded()
    expect((await animation.boundingBox())!.width).toBeGreaterThanOrEqual(44)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: info.outputPath(`settings-${theme}-${width}.png`) })
  }
})

for (const theme of ['light', 'dark']) test(`client reference progress keeps overview pro and measurement editing ${theme}`, async ({ page }, info) => {
  await page.clock.setFixedTime(new Date('2026-09-24T12:00:00Z'))
  await page.addInitScript(({ id, theme }) => localStorage.setItem(`fit.clientLime.theme.${id}`, theme), { id: pilotId, theme })
  await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, withGoal: true, withMeasurements: true })
  await page.goto('/me/progress')
  await expect(page.getByRole('heading', { name: 'Мой прогресс', exact: true })).toBeVisible()
  await expect(page.locator('.client-current-week')).toHaveCSS('border-radius', '32px')
  for (const width of [390, 430]) {
    await page.setViewportSize({ width, height: 844 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: info.outputPath(`progress-${theme}-${width}.png`) })
  }
  await page.getByRole('tab', { name: 'ПРО', exact: true }).click()
  await expect(page.locator('.progress-pro-list')).toBeVisible()
  await page.getByRole('tab', { name: 'Обзор', exact: true }).click()
  await page.getByRole('button', { name: /^История замеров/ }).click()
  const history = page.locator('.client-progress-history')
  await expect(history).toBeVisible()
  await history.getByRole('button', { name: 'Изменить', exact: true }).click()
  await expect(history.getByRole('heading', { name: 'Изменить замер', exact: true })).toBeVisible()
  await history.getByLabel('Вес, кг', { exact: true }).fill('71.5')
  await expect(history.getByLabel('Вес, кг', { exact: true })).toHaveValue('71.5')
  await history.getByRole('button', { name: 'Отмена', exact: true }).click()
  await expect(history.getByRole('heading', { name: 'Изменить замер', exact: true })).toHaveCount(0)
})

// Z-order is density-independent; both themes exercise different halo surfaces.
for (const theme of ['light', 'dark']) test(`client v79 glow keeps reminder and header above the clock ${theme}`, async ({ page }, info) => {
  await page.addInitScript(({ id, theme, workoutId }) => {
    localStorage.setItem(`fit.clientLime.theme.${id}`, theme)
    localStorage.setItem(`fit.clientLiveDensity.${id}`, 'original')
    localStorage.setItem(`fit:workout-inactivity:${id}:${workoutId}`, JSON.stringify({ version: 1, userId: id, workoutId, dueAt: Date.now() - 1000 }))
  }, { id: pilotId, theme, workoutId })
  const source = coachGestureWorkout(false, 1)
  source.startedAt = new Date(Date.now() - 60000).toISOString()
  await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [source] })
  await page.route('**/v1/push-notifications/status', route => route.fulfill({ json: { status: { subscribed: false, preferences: { workout_reminder: true, workout_scheduled: true, chat_message: true } } } }))
  await page.goto(`/workouts/${workoutId}/live`)
  const reminder = page.getByRole('alert', { name: 'Тренировка ещё идёт', exact: true })
  await expect(reminder).toBeVisible()
  await page.screenshot({ path: info.outputPath('clock-reminder-layers.png') })
  const layers = await reminder.evaluate(element => ({
    reminder: Number(getComputedStyle(element).zIndex),
    timer: Number(getComputedStyle(document.querySelector('.live-pinned')!).zIndex),
    header: Number(getComputedStyle(document.querySelector('.live-workout-page > .page-header')!).zIndex),
  }))
  expect(layers.reminder).toBeGreaterThan(layers.timer)
  expect(layers.header).toBeGreaterThan(layers.reminder)
  await reminder.getByRole('button', { name: 'Продолжить', exact: true }).click()
  await expect(reminder).toHaveCount(0)
  await expect(page).toHaveURL(new RegExp(`/workouts/${workoutId}/live$`))
})

// Header geometry differs by density; verify actual targets, not scroll offsets.
for (const density of ['original', 'compact']) test(`client v79 clock handoff keeps compact actions reachable ${density}`, async ({ page }, info) => {
  await page.addInitScript(({ id, density }) => {
    localStorage.setItem(`fit.clientLiveDensity.${id}`, density)
    localStorage.setItem(`fit.clientLime.theme.${id}`, 'light')
    localStorage.setItem(`fit.coachmarks-seen.${id}`, JSON.stringify(['client-live-reference-timer-2026-10', 'client-live-card-drag-2026-10']))
  }, { id: pilotId, density })
  const source = coachGestureWorkout(false, 6)
  source.startedAt = new Date(Date.now() - 60000).toISOString()
  await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [source] })
  await page.goto(`/workouts/${workoutId}/live`)
  const large = page.locator('.client-live-v79 .coach-v79-large-clock')
  await expect(large).toBeVisible()
  const colors = await large.evaluate(element => ({ color: getComputedStyle(element).color, background: getComputedStyle(document.querySelector('.phone-frame')!).backgroundColor }))
  expect(liveContrast(colors.color, colors.background)).toBeGreaterThanOrEqual(4.5)
  await page.locator('.content').evaluate(element => { element.scrollTop = element.scrollHeight; element.dispatchEvent(new Event('scroll')) })
  const actions = page.locator('.client-live-v79 .coach-v79-small-action')
  await expect(actions).not.toHaveAttribute('inert')
  await expect(page.locator('.coach-v79-actions')).toBeHidden()
  const targets = actions.locator('button')
  await expect(targets).toHaveCount(2)
  for (const target of await targets.all()) {
    const hit = await target.evaluate(element => {
      const rect = element.getBoundingClientRect()
      return { width: rect.width, height: rect.height, reachable: element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)) }
    })
    expect(hit.width).toBeGreaterThanOrEqual(44); expect(hit.height).toBeGreaterThanOrEqual(44); expect(hit.reachable).toBe(true)
  }
  const rest = actions.locator('.live-rest-trigger')
  await rest.click()
  await expect(page.getByRole('dialog', { name: 'Таймер отдыха', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Закрыть таймер', exact: true }).click()
  await expect(rest).toBeFocused()
  await page.screenshot({ path: info.outputPath('client-v79-header-actions.png') })
})

// Density/viewport affect actual field geometry, not confirmation semantics.
for (const density of ['original', 'compact']) test(`client Live strength rows keep dense labelled inputs ${density}`, async ({ page }, info) => {
  await page.addInitScript(({ id, density }) => {
    localStorage.setItem(`fit.clientLiveDensity.${id}`, density)
    localStorage.setItem(`fit.rpeDisplay.${id}`, 'false')
    localStorage.setItem(`fit.liveExerciseAnimation.${id}`, 'false')
  }, { id: pilotId, density })
  await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [coachGestureWorkout(false, 1)] })
  await page.goto(`/workouts/${workoutId}/live`)
  await expect(page.locator('.client-workout-reference')).toBeVisible()
  const row = page.locator('.live-set.current').first()
  await expect(row.getByRole('textbox', { name: 'Фактический вес', exact: true })).toBeVisible()
  await expect(row.getByRole('textbox', { name: 'Фактические повторы', exact: true })).toBeVisible()
  await expect(row.locator('.live-metric-label').first()).toBeHidden()
  await expect(row.locator('.live-metric-label').last()).toBeHidden()
  await expect(row.locator('.coach-live-field-unit')).toHaveText(['кг', 'повт.'])
  for (const width of [390, 430]) {
    await page.setViewportSize({ width, height: 844 })
    const geometry = await row.evaluate(element => {
      const fields = element.querySelector('.live-set-fields')!.getBoundingClientRect()
      const controls = [...element.querySelectorAll('.live-set-input, .live-set-confirm')].map(control => control.getBoundingClientRect())
      return { height: fields.height, controls: controls.map(box => ({ y: box.y, height: box.height })), overflow: document.documentElement.scrollWidth > innerWidth }
    })
    expect(geometry.height).toBe(density === 'original' ? 54 : 48)
    expect(geometry.controls.every(box => box.height === geometry.height && Math.abs(box.y - geometry.controls[0]!.y) < 1)).toBe(true)
    expect(geometry.overflow).toBe(false)
    await row.screenshot({ path: info.outputPath(`dense-strength-${width}.png`) })
  }
})

// Force both race windows: a slow confirmation and a queued focus frame.
// Strength/time exercise different native inputs; two engines cover touch focus.
for (const metric of ['weight', 'seconds'] as const) for (const phase of ['response', 'frame'] as const) test(`client manual focus wins confirmation ${metric} ${phase}`, async ({ page }, info) => {
  const source = restTimerWorkout()
  source.startedAt = new Date(Date.now() - 120000).toISOString()
  const exercise = source.exercises[0]!, target = exercise.sets[0]!, sibling = exercise.sets[1]!
  if (metric === 'seconds') {
    Object.assign(exercise, { ref: 'rowing-machine', name: 'Гребной тренажёр', inputKind: 'distance' })
    exercise.sets.forEach(set => Object.assign(set, { weightKg: undefined, durationSec: 90, distanceKm: 1.02 }))
  }
  const backend = await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [source] })
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.route(`**/v1/workout-sets/${target.id}/confirm`, async route => { await gate; await route.fallback() })
  await page.goto(`/workouts/${workoutId}/live`)
  const row = page.locator(`form[data-live-set-id="${target.id}"]`)
  const next = page.locator(`form[data-live-set-id="${sibling.id}"]`)
  const label = metric === 'weight' ? 'Фактический вес' : 'Фактическое время: секунды'
  const field = row.getByRole('textbox', { name: label, exact: true })
  await field.fill('35')
  await row.getByRole('button', { name: 'Готово, отдых', exact: true }).click()
  await expect(row.getByRole('button', { name: 'Готово, отдых', exact: true })).toBeDisabled()
  await page.evaluate(() => {
    const frames: FrameRequestCallback[] = []
    const native = window.requestAnimationFrame.bind(window)
    // Hold only the next-set handoff, not visibility/actionability frames.
    // The selector is the existing next-input contract, independent of names
    // changed by minification. The frame case asserts the callback was held.
    window.requestAnimationFrame = callback => {
      if (!String(callback).includes('input.live-set-input:not(:disabled)')) return native(callback)
      frames.push(callback); return -frames.length
    }
    Object.assign(window, { heldFocusFrameCount: () => frames.length, flushFocusFrames: () => {
      window.requestAnimationFrame = native
      for (const frame of frames.splice(0)) frame(performance.now())
    } })
  })
  if (phase === 'frame') {
    release(); await expect(row).toHaveClass(/confirmed/)
    await expect.poll(() => page.evaluate(() => (window as unknown as { heldFocusFrameCount: () => number }).heldFocusFrameCount())).toBe(1)
  }
  await field.tap()
  await expect(field).toBeFocused()
  if (phase === 'frame') {
    await page.evaluate(() => (window as unknown as { flushFocusFrames: () => void }).flushFocusFrames())
    await expect(field).toBeFocused()
  }
  // Safari may retain focus through the check tap; explicitly replace the
  // value rather than assuming a second tap on the same input selects it.
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.insertText(metric === 'weight' ? '37.5' : '45')
  if (phase === 'response') { release(); await expect(row).toHaveClass(/confirmed/) }
  const stamp = backend.getWorkouts()[0]!.exercises[0]!.sets[0]!.confirmedAt
  const deadline = await page.evaluate(id => sessionStorage.getItem(`fit:live-rest-until:${id}`), workoutId)
  await page.evaluate(() => (window as unknown as { flushFocusFrames: () => void }).flushFocusFrames())
  await expect(field).toBeFocused()
  await expect(field).toHaveValue(metric === 'weight' ? '37.5' : '45')
  await expect(next.getByRole('textbox', { name: label, exact: true })).not.toBeFocused()
  await field.blur()
  await expect.poll(() => {
    const fact = backend.getWorkouts()[0]!.exercises[0]!.sets[0]!.fact
    return metric === 'weight' ? fact.weightKg : fact.durationSec
  }).toBe(metric === 'weight' ? 37.5 : 105)
  expect(backend.getWorkouts()[0]!.exercises[0]!.sets[1]!.fact).toEqual(sibling.fact)
  expect(backend.getWorkouts()[0]!.exercises[0]!.sets[0]!.confirmedAt).toBe(stamp)
  expect(await page.evaluate(id => sessionStorage.getItem(`fit:live-rest-until:${id}`), workoutId)).toBe(deadline)
  await page.screenshot({ path: info.outputPath(`manual-focus-${metric}-${phase}.png`) })
})

// One interaction contract per real structural consumer, not per visual axis.
for (const grouped of [false, true]) test(`client Live time preference text confirm retry reload and wheel grouped-${grouped}`, async ({ page }, info) => {
  await page.addInitScript(id => { localStorage.setItem(`fit.liveExerciseAnimation.${id}`, 'false'); localStorage.setItem(`fit.rpeDisplay.${id}`, 'true') }, pilotId)
  const source = coachGestureWorkout(grouped, grouped ? 2 : 1), exercise = source.exercises[0]!
  source.startedAt = new Date(Date.now() - 120000).toISOString()
  Object.assign(exercise, { ref: 'rowing-machine', name: 'Гребной тренажёр', inputKind: 'distance' })
  exercise.sets.forEach(set => Object.assign(set, { weightKg: undefined, durationSec: 90, distanceKm: 1.02, reps: 24, rpe: 8 }))
  const backend = await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [source], failFirstSetConfirm: true })
  await page.goto(`/workouts/${workoutId}/live`)
  await expect(page.locator('.client-workout-reference')).toBeVisible()
  const row = page.locator(`form[data-live-set-id="${exercise.sets[0]!.id}"]`)
  const seconds = row.getByRole('textbox', { name: 'Фактическое время: секунды', exact: true })
  await expect(row.locator('.live-metric-field')).toHaveCount(4)
  await expect(row.locator('.workout-duration-trigger')).toHaveCount(0)
  const node = await seconds.elementHandle()
  await seconds.fill('65')
  await row.getByRole('button', { name: 'Готово, отдых', exact: true }).click()
  expect(backend.getWorkouts()[0]!.exercises[0]!.sets[0]!.confirmedAt).toBeNull()
  await expect(seconds).toHaveValue('65')
  const saving = page.waitForRequest(request => {
    if (request.method() !== 'PUT' || !request.url().endsWith(`/workout-sets/${exercise.sets[0]!.id}/draft`)) return false
    return (request.postDataJSON() as { draft: { durationSec?: number } }).draft.durationSec === 105
  })
  await seconds.fill('45')
  await row.getByRole('button', { name: 'Готово, отдых', exact: true }).click()
  const command = (await saving).postDataJSON() as { draft: { metricSources: { duration: string } } }
  expect(command.draft.metricSources.duration).toBe('entered')
  await expect(row.locator('.save-status-error')).toBeVisible()
  await expect(seconds).toHaveValue('45')
  await row.getByRole('button', { name: 'Готово, отдых', exact: true }).click()
  await expect(row.getByRole('img', { name: 'Подход выполнен' })).toBeVisible()
  await expect.poll(() => backend.getWorkouts()[0]!.exercises[0]!.sets[0]!.fact.durationSec).toBe(105)
  expect(await node!.evaluate(element => element.isConnected)).toBe(true)
  const confirmedAt = backend.getWorkouts()[0]!.exercises[0]!.sets[0]!.confirmedAt
  await seconds.fill('50'); await seconds.blur()
  await expect.poll(() => backend.getWorkouts()[0]!.exercises[0]!.sets[0]!.fact.durationSec).toBe(110)
  expect(backend.getWorkouts()[0]!.exercises[0]!.sets[0]!.confirmedAt).toBe(confirmedAt)
  await page.reload()
  await expect(seconds).toHaveValue('50')
  await row.scrollIntoViewIfNeeded()
  await page.screenshot({ path: info.outputPath('text-time.png') })
  await page.goto('/me/settings')
  const preference = page.getByRole('switch', { name: 'Ввод времени колёсиком', exact: true })
  await expect(preference).not.toBeChecked()
  await preference.click()
  await page.goto(`/workouts/${workoutId}/live`)
  const trigger = row.getByRole('button', { name: 'Фактическое время: 1:50', exact: true })
  await trigger.click()
  const sheet = page.getByRole('dialog', { name: 'Фактическое время', exact: true })
  await expect(sheet).toHaveClass(/client-reference-time-sheet/)
  await sheet.getByRole('listbox', { name: 'секунды', exact: true }).getByRole('option', { name: '55 секунды', exact: true }).click()
  await sheet.getByRole('button', { name: 'Применить · 1:55', exact: true }).click()
  await expect.poll(() => backend.getWorkouts()[0]!.exercises[0]!.sets[0]!.fact.durationSec).toBe(115)
  await page.goto('/me/settings'); await preference.click()
  await page.goto(`/workouts/${workoutId}/live`)
  await expect(seconds).toHaveValue('55')
  expect(backend.getWorkouts()[0]!.exercises[0]!.sets[0]!.confirmedAt).toBe(confirmedAt)
})

test('client Live metrics and superset preserve final input and notes', async ({ page }, info) => {
  await page.addInitScript(id => {
    localStorage.setItem(`fit.clientLime.theme.${id}`, 'dark')
    localStorage.setItem(`fit.liveExerciseAnimation.${id}`, 'false')
  }, pilotId)
  const source = coachGestureWorkout(true, 4)
  source.startedAt = new Date(Date.now() - 120000).toISOString()
  Object.assign(source.exercises[0]!, { ref: 'rowing-machine', name: 'Гребной тренажёр', inputKind: 'distance' })
  source.exercises[0]!.sets = source.exercises[0]!.sets.map(set => ({ ...set, weightKg: undefined, reps: 24, durationSec: 300, distanceKm: 1.02 }))
  source.exercises[1]!.trainerComment = 'Сохраняйте технику'
  const backend = await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [source] })
  await page.route('**/v1/workout-exercises/*/comment', async route => {
    const exercise = backend.getWorkouts()[0]!.exercises.find(item => route.request().url().includes(item.id))!
    exercise.clientNote = (route.request().postDataJSON() as { comment: string }).comment
    const current = backend.getWorkouts()[0]!
    current.version += 1
    await route.fulfill({ json: { workout: { version: current.version } } })
  })
  await page.goto(`/workouts/${workoutId}/live`)
  await expect(page.locator('.client-workout-reference')).toBeVisible()
  await expect(page.getByLabel('Гребков в минуту').first()).toBeVisible()
  const group = page.locator('.client-live-circuit').first()
  await group.scrollIntoViewIfNeeded()
  await group.screenshot({ path: info.outputPath('live-superset-metrics-after.png') })
  await expect(group.locator('.circuit-round-label')).toHaveCount(0)
  const row = group.locator('form[data-live-set-id]').first()
  const fields = row.locator('.live-metric-field')
  await expect(fields).toHaveCount(3)
  const bounds = await fields.evaluateAll(elements => elements.map(element => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width } }))
  expect(bounds[0]!.y).toBe(bounds[1]!.y)
  expect(bounds[2]!.y).toBeGreaterThan(bounds[0]!.y)
  expect(bounds[2]!.width).toBeGreaterThan(bounds[0]!.width * 1.9)
  const stroke = row.getByLabel('Гребков в минуту')
  await stroke.fill('28')
  const handle = await stroke.elementHandle()
  await row.getByRole('button', { name: 'Готово, отдых', exact: true }).click()
  await expect.poll(() => backend.getWorkouts()[0]!.exercises[0]!.sets[0]!.fact.reps).toBe(28)
  await expect(row.getByRole('img', { name: 'Подход выполнен' })).toBeVisible()
  expect(await handle!.evaluate(element => element.isConnected)).toBe(true)
  const confirmedAt = backend.getWorkouts()[0]!.exercises[0]!.sets[0]!.confirmedAt
  await stroke.fill('29'); await stroke.blur()
  await expect.poll(() => backend.getWorkouts()[0]!.exercises[0]!.sets[0]!.fact.reps).toBe(29)
  expect(backend.getWorkouts()[0]!.exercises[0]!.sets[0]!.confirmedAt).toBe(confirmedAt)
  const noteToggle = group.getByRole('button', { name: 'Моя заметка: Гребной тренажёр', exact: true })
  await expect(noteToggle).not.toHaveAttribute('data-has-note')
  await expect(noteToggle).toHaveAttribute('aria-description', 'Добавить заметку')
  await noteToggle.click()
  const note = group.getByRole('textbox', { name: 'Заметка: Гребной тренажёр', exact: true })
  await note.fill('Держать темп'); await note.blur()
  await expect.poll(() => backend.getWorkouts()[0]!.exercises[0]!.clientNote).toBe('Держать темп')
  await expect(noteToggle).toHaveAttribute('data-has-note', 'true')
  await expect(noteToggle).toHaveAttribute('aria-description', 'Есть заметка')
  expect(backend.getWorkouts()[0]!.exercises[1]!.trainerComment).toBe('Сохраняйте технику')
  await page.reload()
  await expect(page.getByLabel('Гребков в минуту').first()).toHaveValue('29')
})

const liveMetricCases = [
  { ref: 'barbell-squat', kind: 'strength', count: 3 },
  { ref: 'push-up', kind: 'reps', count: 3 },
  { ref: 'vital-barbell-hold-ex010', kind: 'duration', count: 3 },
  { ref: 'farmer-carry', kind: 'distance', count: 4 },
  { ref: 'running', kind: 'distance', count: 3 },
  { ref: 'vital-stair-climber', kind: 'duration', count: 3 },
  { ref: 'custom-metrics', kind: 'strength', count: 3 },
] as const

// Each measurement contract once in a single card and once inside a group.
// Theme/size/density are covered by the independent non-mutating visual matrix.
for (const grouped of [false, true]) for (const metric of liveMetricCases) test(`client Live metric contract ${metric.ref} grouped-${grouped}`, async ({ page }) => {
  await page.addInitScript(id => { localStorage.setItem(`fit.rpeDisplay.${id}`, 'true'); localStorage.setItem(`fit.liveExerciseAnimation.${id}`, 'false') }, pilotId)
  const source = coachGestureWorkout(grouped, grouped ? 2 : 1), exercise = source.exercises[0]!
  source.startedAt = new Date(Date.now() - 120000).toISOString()
  Object.assign(exercise, { source: metric.ref === 'custom-metrics' ? 'custom' : 'system', ref: metric.ref, inputKind: metric.kind })
  exercise.sets.forEach(set => Object.assign(set, { weightKg: 20, reps: 12, durationSec: 120, distanceKm: metric.kind === 'distance' ? 0.4 : undefined, rpe: 8 }))
  const backend = await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [source] })
  await page.goto(`/workouts/${workoutId}/live`)
  const row = page.locator(`form[data-live-set-id="${exercise.sets[0]!.id}"]`)
  await expect(row.locator('.live-metric-field')).toHaveCount(metric.count)
  const rpe = row.getByLabel('Фактический RPE')
  await rpe.selectOption('9')
  await row.getByRole('button', { name: 'Готово, отдых', exact: true }).click()
  await expect(row.getByRole('img', { name: 'Подход выполнен' })).toBeVisible()
  await expect.poll(() => backend.getWorkouts()[0]!.exercises[0]!.sets[0]!.fact.rpe).toBe(9)
  await page.reload()
  await expect(row.getByLabel('Фактический RPE')).toHaveValue('9')
})

test('client Live inactive supersets keep manual expansion and ragged rounds', async ({ page }) => {
  await page.addInitScript(id => localStorage.setItem(`fit.liveExerciseAnimation.${id}`, 'false'), pilotId)
  const source = coachGestureWorkout(true, 4)
  source.startedAt = new Date(Date.now() - 120000).toISOString()
  // A second independent group, with historical unequal set counts.
  source.exercises[3]!.blockId = source.exercises[2]!.blockId
  source.exercises[2]!.blockType = source.exercises[3]!.blockType = 'group'
  source.exercises[3]!.sets.pop()
  const backend = await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [source] })
  await page.goto(`/workouts/${workoutId}/live`)
  const group = page.locator('.client-live-circuit').nth(1)
  const toggle = group.locator('.client-circuit-toggle')
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(group.locator('.client-circuit-body')).toBeHidden()
  const activeGroup = page.locator('.client-live-circuit').first()
  await expect(activeGroup.locator('.live-set.current')).toHaveCount(1)
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await expect(group.locator('.live-set.current')).toHaveCount(0)
  await expect(page.locator('.live-set.current')).toHaveCount(1)
  await expect(group.locator('.live-set-number').first()).toHaveText('')
  const field = group.getByLabel('Фактический вес', { exact: true }).first()
  await field.fill('32.5')
  const node = await field.elementHandle()
  await expect(field).toHaveValue('32.5')
  await expect(field).toBeFocused()
  await expect.poll(() => backend.getWorkouts()[0]!.exercises[2]!.sets[0]!.fact.weightKg).toBe(32.5)
  await expect(field).toBeFocused()
  await toggle.click()
  await expect(group.locator('.client-circuit-body')).toBeHidden()
  await toggle.click()
  expect(await node!.evaluate(element => element.isConnected)).toBe(true)
  await expect(field).toHaveValue('32.5')
  const round = group.locator('.circuit-round').last()
  const roundToggle = round.getByRole('button', { name: /Круг 2/ })
  const background = await roundToggle.evaluate(element => getComputedStyle(element).backgroundColor)
  await roundToggle.hover()
  expect(await roundToggle.evaluate(element => getComputedStyle(element).backgroundColor)).toBe(background)
  await round.getByRole('button', { name: /Круг 2/ }).click()
  await expect(round.locator('form[data-live-set-id]')).toHaveCount(1)
  await expect(group.getByRole('button', { name: 'Добавить круг', exact: true })).toBeVisible()
  // Any-order confirmation remains available in the future group.
  const futureSet = group.locator('form[data-live-set-id]').first()
  await futureSet.getByRole('button', { name: 'Готово, отдых', exact: true }).click()
  await expect(futureSet.getByRole('img', { name: 'Подход выполнен' })).toBeVisible()
  expect(backend.getWorkouts()[0]!.exercises[2]!.sets[0]!.confirmedAt).toBeTruthy()
})

// Visual axes cover responsive wrapping, theme, existing density and media.
// Mutations are deliberately not repeated across this matrix.
for (const theme of ['light', 'dark']) for (const density of ['original', 'compact']) for (const animation of [false, true]) test(`client Live metric grid visual ${theme} ${density} media-${animation}`, async ({ page }, info) => {
  await page.addInitScript(({ id, theme, density, animation }) => {
    localStorage.setItem(`fit.clientLime.theme.${id}`, theme)
    localStorage.setItem(`fit.clientLiveDensity.${id}`, density)
    localStorage.setItem(`fit.liveExerciseAnimation.${id}`, String(animation))
    localStorage.setItem(`fit.rpeDisplay.${id}`, 'true')
  }, { id: pilotId, theme, density, animation })
  const source = coachGestureWorkout(true, 2)
  source.startedAt = new Date(Date.now() - 120000).toISOString()
  Object.assign(source.exercises[0]!, { ref: 'rowing-machine', name: 'Гребной тренажёр', inputKind: 'distance' })
  Object.assign(source.exercises[1]!, { ref: 'barbell-squat', name: 'Приседания со штангой с длинным названием упражнения' })
  source.exercises[0]!.sets.forEach(set => Object.assign(set, { weightKg: undefined, durationSec: 300, distanceKm: 1.02, reps: 24, rpe: 8 }))
  await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [source] })
  await page.goto(`/workouts/${workoutId}/live`)
  const group = page.locator('.client-live-circuit').first()
  const row = group.locator('form[data-live-set-id]').first()
  await expect(row.locator('.live-metric-field')).toHaveCount(4)
  for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: 844 })
    await group.screenshot({ path: info.outputPath(`grid-${width}.png`) })
    const geometry = await row.evaluate(form => {
      const cells = [...form.querySelectorAll('.live-metric-field')].map(element => element.getBoundingClientRect())
      const check = form.querySelector('.live-set-check')!.getBoundingClientRect()
      const pace = form.querySelector('.live-metrics-pace')!.getBoundingClientRect()
      return { cells: cells.map(r => ({ x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width })), check: { x: check.x, bottom: check.bottom, height: check.height }, paceY: pace.y }
    })
    expect(geometry.cells[0]!.y).toBe(geometry.cells[1]!.y)
    expect(geometry.cells[2]!.y).toBe(geometry.cells[3]!.y)
    expect(geometry.cells[2]!.y).toBeGreaterThan(geometry.cells[0]!.bottom)
    expect(geometry.check.bottom).toBe(geometry.cells[3]!.bottom)
    expect(geometry.check.x).toBeGreaterThanOrEqual(geometry.cells[3]!.right)
    expect(geometry.paceY).toBeGreaterThanOrEqual(geometry.check.bottom)
    expect(geometry.check.height).toBe(density === 'original' ? 54 : 48)
    const timeInputs = await row.locator('.workout-duration-parts input').evaluateAll(inputs => inputs.map(input => {
      const box = input.getBoundingClientRect(), style = getComputedStyle(input)
      return { width: box.width, height: box.height, fontSize: parseFloat(style.fontSize) }
    }))
    expect(timeInputs).toHaveLength(2)
    for (const field of timeInputs) {
      expect(field.width).toBeGreaterThanOrEqual(44)
      expect(field.height).toBe(geometry.check.height)
      expect(field.fontSize).toBeGreaterThanOrEqual(16)
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await expect(group.locator('.live-header-animation, .exercise-thumbnail').first()).toHaveCount(animation ? 1 : 0)
    const heights = await group.locator('.client-circuit-note-toggle, .overflow-trigger').evaluateAll(elements => elements.map(element => element.getBoundingClientRect().height))
    for (const height of heights) expect(height).toBeGreaterThanOrEqual(44)
    await group.screenshot({ path: info.outputPath(`grid-${width}.png`) })
  }
})

for (const theme of ['light', 'dark']) for (const density of ['original', 'compact']) for (const animation of [false, true]) test(`client completed cards stay compact ${theme} ${density} animation-${animation}`, async ({ page }, info) => {
  await page.addInitScript(({ id, theme, density, animation }) => {
    localStorage.setItem(`fit.clientLime.theme.${id}`, theme)
    localStorage.setItem(`fit.clientLiveDensity.${id}`, density)
    localStorage.setItem(`fit.liveExerciseAnimation.${id}`, String(animation))
  }, { id: pilotId, theme, density, animation })
  const source = coachGestureWorkout()
  source.startedAt = new Date(Date.now() - 120000).toISOString()
  source.exercises[0]!.ref = 'barbell-squat'
  source.exercises[1]!.name = 'Жим гантелей на наклонной скамье с длинным названием упражнения'
  for (const exercise of source.exercises) for (const set of exercise.sets) {
    set.confirmedAt = new Date(Date.now() - 60000).toISOString(); set.fact = { weightKg: 30, reps: 10 }
  }
  await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [source] })
  await page.goto(`/workouts/${workoutId}/live`)
  for (const width of [390, 430]) {
    await page.setViewportSize({ width, height: 844 })
    await expect(page.locator('.workout-exercise-compact')).toHaveCount(3)
    const geometry = await page.locator('.live-completed-gesture-head').first().evaluate(card => {
      const button = card.querySelector('.workout-exercise-compact')!, copy = card.querySelector('.workout-exercise-compact-copy')!
      const thumb = card.querySelector('.exercise-thumbnail'), menu = card.querySelector('.overflow-trigger')!
      const b = button.getBoundingClientRect(), c = copy.getBoundingClientRect(), m = menu.getBoundingClientRect(), t = thumb?.getBoundingClientRect()
      return { height: card.getBoundingClientRect().height, copyWidth: c.width, copyX: c.x, buttonX: b.x, copyRight: c.right, menuX: m.x, thumbRight: t?.right }
    })
    expect(geometry.height).toBeLessThan(140)
    expect(geometry.copyWidth).toBeGreaterThan(100)
    expect(geometry.copyRight).toBeLessThanOrEqual(geometry.menuX)
    if (animation) expect(geometry.thumbRight).toBeLessThan(geometry.copyX)
    else expect(geometry.copyX).toBe(geometry.buttonX)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: info.outputPath(`completed-${width}.png`) })
  }
})

for (const theme of ['light', 'dark']) for (const density of ['original', 'compact']) test(`client folds completed exercise without stopping overdue rest ${theme} ${density}`, async ({ page }, info) => {
  await page.clock.install({ time: new Date('2026-10-21T09:00:00Z') })
  await page.addInitScript(({ id, theme, density }) => { localStorage.setItem(`fit.clientLiveDensity.${id}`, density); localStorage.setItem(`fit.clientLime.theme.${id}`, theme) }, { id: pilotId, theme, density })
  const source = coachGestureWorkout()
  source.startedAt = '2026-10-21T08:58:00Z'
  const exercise = source.exercises[0]!
  exercise.restBetweenExercisesSec = 2
  exercise.restBetweenSetsSec = 2
  exercise.sets[0]!.confirmedAt = '2026-10-21T08:59:00Z'
  exercise.sets[0]!.fact = { weightKg: 20, reps: 10 }
  const backend = await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [source] })
  await page.goto(`/workouts/${workoutId}/live`)
  await page.locator('form[data-live-set-id]').nth(1).getByRole('button', { name: 'Готово, отдых', exact: true }).click()
  const compact = page.locator('.workout-exercise-compact').first()
  await expect(compact).toBeVisible()
  await page.clock.fastForward(4000)
  await expect(compact).toBeVisible()
  await expect(page.locator('.live-rest-trigger').and(page.getByRole('button'))).toHaveAttribute('aria-label', /Отдых превышен/)
  await compact.click()
  const row = page.locator(`form[data-live-set-id="${exercise.sets[0]!.id}"]`)
  await row.getByLabel('Фактический вес', { exact: true }).fill('35')
  await row.getByLabel('Фактический вес', { exact: true }).blur()
  await expect.poll(() => backend.getWorkouts()[0]!.exercises[0]!.sets[0]!.fact.weightKg).toBe(35)
  await expect(row.getByRole('img', { name: 'Подход выполнен' })).toBeVisible()
  await expect(page.locator('.live-rest-trigger').and(page.getByRole('button'))).toHaveAttribute('aria-label', /Отдых превышен/)
  expect(backend.getWorkouts()[0]!.exercises[0]!.sets[0]!.confirmedAt).toBe('2026-10-21T08:59:00Z')
  for (const width of [390, 430]) {
    await page.setViewportSize({ width, height: 844 })
    const card = page.locator('.live-exercise').filter({ has: row })
    const input = await row.getByLabel('Фактический вес', { exact: true }).elementHandle()
    if (width === 390) await card.getByRole('button', { name: `Свернуть: ${exercise.name}`, exact: true }).click()
    else {
      await card.locator('.overflow-trigger').click()
      await page.getByRole('menuitem', { name: 'Свернуть', exact: true }).click()
    }
    await expect(row).not.toBeInViewport()
    expect(await input!.evaluate(element => element.isConnected)).toBe(true)
    await expect(row.locator('xpath=ancestor::div[contains(@class,"client-live-card-body")]')).toHaveAttribute('inert', '')
    await expect(compact).toBeVisible()
    await expect(page.locator('.live-rest-trigger').and(page.getByRole('button'))).toHaveAttribute('aria-label', /Отдых превышен/)
    await page.screenshot({ path: info.outputPath(`folded-again-${width}.png`) })
    await compact.click()
    expect(await input!.evaluate(element => element.isConnected)).toBe(true)
    await expect(row.getByLabel('Фактический вес', { exact: true })).toHaveValue('35')
    await expect(row.getByRole('img', { name: 'Подход выполнен' })).toBeVisible()
    expect(backend.getWorkouts()[0]!.exercises[0]!.sets[0]!.confirmedAt).toBe('2026-10-21T08:59:00Z')
  }
})

for (const theme of ['light', 'dark']) test(`client completed collapse waits for pending and failed edits ${theme}`, async ({ page }) => {
  await page.addInitScript(({ id, theme }) => { localStorage.setItem(`fit.clientLime.theme.${id}`, theme); localStorage.setItem(`fit.coachmarks-seen.${id}`, JSON.stringify(['client-live-reference-timer-2026-10'])) }, { id: pilotId, theme })
  const source = coachGestureWorkout(), exercise = source.exercises[0]!
  source.startedAt = new Date(Date.now() - 120000).toISOString()
  exercise.sets.forEach(set => { set.confirmedAt = '2026-10-21T08:59:00Z'; set.fact = { weightKg: 30, reps: 10 } })
  const backend = await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [source] })
  let release!: () => void, mode: 'pending' | 'error' | 'success' = 'pending', attempts = 0
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.route('**/v1/workout-sets/*/draft', async route => {
    attempts += 1
    if (mode === 'pending') await gate
    if (mode === 'error') return route.fulfill({ status: 503, json: { error: 'unavailable' } })
    return route.fallback()
  })
  await page.goto(`/workouts/${workoutId}/live`)
  await page.locator('.workout-exercise-compact').first().click()
  const row = page.locator(`form[data-live-set-id="${exercise.sets[0]!.id}"]`)
  const field = row.getByLabel('Фактический вес', { exact: true })
  const card = page.locator('.live-exercise').filter({ has: row })
  await field.fill('35'); await field.blur()
  await expect.poll(() => attempts).toBeGreaterThan(0)
  await card.locator('.overflow-trigger').click()
  await expect(page.getByRole('menuitem', { name: 'Свернуть', exact: true })).toBeDisabled()
  await expect(card.getByRole('button', { name: `Свернуть: ${exercise.name}`, exact: true })).toBeDisabled()
  mode = 'success'; release()
  await expect.poll(() => backend.getWorkouts()[0]!.exercises[0]!.sets[0]!.fact.weightKg).toBe(35)
  await expect(page.getByRole('menuitem', { name: 'Свернуть', exact: true })).toBeEnabled()
  await page.keyboard.press('Escape')
  mode = 'error'
  await field.fill('37.5'); await field.blur()
  await expect(row.locator('.save-status-error')).toBeVisible()
  await card.locator('.overflow-trigger').click()
  await expect(page.getByRole('menuitem', { name: 'Свернуть', exact: true })).toBeDisabled()
  await expect(card.getByRole('button', { name: `Свернуть: ${exercise.name}`, exact: true })).toBeDisabled()
  await page.keyboard.press('Escape')
  mode = 'success'
  await field.focus(); await field.blur()
  await expect.poll(() => backend.getWorkouts()[0]!.exercises[0]!.sets[0]!.fact.weightKg).toBe(37.5)
  await card.locator('.overflow-trigger').click()
  await expect(page.getByRole('menuitem', { name: 'Свернуть', exact: true })).toBeEnabled()
  await page.getByRole('menuitem', { name: 'Свернуть', exact: true }).click()
  await expect(row).not.toBeInViewport()
  await expect(row.locator('xpath=ancestor::div[contains(@class,"client-live-card-body")]')).toHaveAttribute('inert', '')
  expect(backend.getWorkouts()[0]!.exercises[0]!.sets[0]!.confirmedAt).toBe('2026-10-21T08:59:00Z')
})

// Density changes the header/keyboard geometry, not the business scenario.
for (const density of ['original', 'compact']) test(`client explicit card folds retain input and active exercise ${density}`, async ({ page }, info) => {
  await modelKeyboard(page)
  await page.clock.setFixedTime(new Date('2026-10-27T09:00:00Z'))
  await page.addInitScript(({ id, density, workoutId }) => {
    localStorage.setItem(`fit.clientLiveDensity.${id}`, density)
    sessionStorage.setItem(`fit:live-rest-until:${workoutId}`, String(Date.parse('2026-10-27T09:01:30Z')))
  }, { id: pilotId, density, workoutId })
  const source = coachGestureWorkout(), exercise = source.exercises[0]!, future = source.exercises[1]!
  exercise.name = 'Разведение гантелей на заднюю дельту стоя с опорой'
  source.startedAt = '2026-10-27T08:59:00Z'
  const backend = await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [source] })
  await page.goto(`/workouts/${workoutId}/live`)
  const card = page.locator(`[data-workout-block="${exercise.blockId}"]`), row = card.locator('form[data-live-set-id]').first()
  const field = row.getByLabel('Фактический вес', { exact: true }), input = await field.elementHandle()
  await field.click(); await showModeledKeyboard(page)
  await expect.poll(() => field.evaluate(e => e instanceof HTMLInputElement ? e.selectionEnd! - e.selectionStart! : null)).toBe(2)
  await page.keyboard.insertText('31.5'); await field.blur()
  await expect.poll(() => backend.getWorkouts()[0]!.exercises[0]!.sets[0]!.fact.weightKg).toBe(31.5)
  const deadline = await page.evaluate(id => sessionStorage.getItem(`fit:live-rest-until:${id}`), workoutId)
  const progress = await page.locator('.live-session-progress-copy').innerText()
  await card.getByRole('button', { name: `Свернуть: ${exercise.name}`, exact: true }).click()
  await expect(row).not.toBeInViewport(); expect(await input!.evaluate(e => e.isConnected)).toBe(true)
  await expect(card.getByRole('button', { name: `Развернуть: ${exercise.name}`, exact: true })).toBeFocused()
  await page.evaluate(() => { (window as typeof window & { fitTestKeyboardHeight?: number }).fitTestKeyboardHeight = undefined; visualViewport?.dispatchEvent(new Event('resize')) })
  await card.getByRole('button', { name: `Развернуть: ${exercise.name}`, exact: true }).click()
  await expect(field).toHaveValue('31.5'); expect(await input!.evaluate(e => e.isConnected)).toBe(true)
  await expect(field).toHaveCSS('height', density === 'original' ? '54px' : '48px')
  for (const width of [390, 430]) {
    await page.setViewportSize({ width, height: 844 })
    const futureCard = page.locator(`[data-workout-block="${future.blockId}"]`)
    await futureCard.getByRole('button', { name: `Развернуть: ${future.name}`, exact: true }).click()
    await expect(futureCard.getByLabel('Фактический вес', { exact: true }).first()).toBeVisible()
    await futureCard.getByRole('button', { name: `Свернуть: ${future.name}`, exact: true }).click()
    await expect(futureCard.getByRole('button', { name: `Начать упражнение «${future.name}»`, exact: true })).toBeVisible()
    await expect(page.locator('.live-session-progress-copy')).toHaveText(progress, { useInnerText: true })
    expect(await page.evaluate(id => sessionStorage.getItem(`fit:live-rest-until:${id}`), workoutId)).toBe(deadline)
    expect(backend.getWorkouts()[0]!.exercises.flatMap(e => e.sets).every(s => !s.confirmedAt)).toBe(true)
    expect(await page.locator('.phone-frame').evaluate(e => e.scrollWidth <= e.clientWidth)).toBe(true)
  }
  await card.scrollIntoViewIfNeeded()
  await page.screenshot({ path: info.outputPath(`explicit-fold-${density}.png`) })
})

test('client keyboard Next skips a folded retained card and preserves rest', async ({ page }) => {
  await modelKeyboard(page)
  const restUntil = String(Date.now() + 47000)
  await page.addInitScript(({ id, workoutId, restUntil }) => {
    localStorage.setItem(`fit.coachmarks-seen.${id}`, JSON.stringify(['client-live-reference-timer-2026-10', 'client-live-card-drag-2026-10', 'client-live-multiple-exercises-2026-10']))
    sessionStorage.setItem(`fit:live-rest-until:${workoutId}`, restUntil)
  }, { id: pilotId, workoutId, restUntil })
  await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [coachGestureWorkout(false, 3)] })
  await page.goto(`/workouts/${workoutId}/live`)
  const cards = page.locator('.client-live-card'), middle = cards.nth(1), last = cards.nth(2)
  await middle.getByRole('button', { name: /^Развернуть:/ }).click()
  await last.getByRole('button', { name: /^Развернуть:/ }).click()
  await middle.getByRole('button', { name: /^Свернуть:/ }).click()
  await expect(middle.locator('.client-live-card-body')).toHaveAttribute('inert', '')
  expect(await middle.locator('input.live-set-input').first().evaluate(e => e.getClientRects().length)).toBeGreaterThan(0)
  const from = cards.first().locator('input.live-set-input:not([type=hidden])').last()
  const target = last.locator('input.live-set-input:not([type=hidden])').first()
  await from.focus()
  await showModeledKeyboard(page)
  await from.press('Enter')
  await expect(target).toBeFocused()
  expect(await target.evaluate((e: HTMLInputElement) => [e.selectionStart, e.selectionEnd])).toEqual([0, (await target.inputValue()).length])
  await expect(page.locator('html')).toHaveClass(/app-keyboard-open/)
  expect(await page.evaluate(id => sessionStorage.getItem(`fit:live-rest-until:${id}`), workoutId)).toBe(restUntil)
})

async function modelKeyboard(page: Page) {
  await page.addInitScript(() => {
    const state = window as typeof window & { fitTestKeyboardHeight?: number }
    if (visualViewport) Object.defineProperty(visualViewport, 'height', { configurable: true, get: () => state.fitTestKeyboardHeight ?? innerHeight })
  })
}

async function showModeledKeyboard(page: Page) {
  await page.evaluate(() => {
    ;(window as typeof window & { fitTestKeyboardHeight?: number }).fitTestKeyboardHeight = 420
    visualViewport?.dispatchEvent(new Event('resize'))
  })
  await expect(page.locator('html')).toHaveClass(/app-keyboard-open/)
}

async function tapVisible(page: Page, target: ReturnType<Page['locator']>) {
  await target.scrollIntoViewIfNeeded()
  const box = await target.boundingBox()
  if (!box) throw new Error('Action is not visible')
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
}

test('client Live text seconds keep focus above keyboard during density change', async ({ page }) => {
  await modelKeyboard(page)
  const source = restTimerWorkout(0, true, 'manual')
  source.startedAt = new Date(Date.now() - 120000).toISOString()
  const backend = await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [source] })
  await page.goto(`/workouts/${workoutId}/live`)
  const field = page.getByRole('textbox', { name: 'Фактическое время: секунды', exact: true }).first()
  await field.fill('25')
  const element = await field.elementHandle()
  await showModeledKeyboard(page)
  for (const density of ['compact', 'original']) {
    await page.evaluate(({ id, density }) => {
      const key = `fit.clientLiveDensity.${id}`
      localStorage.setItem(key, density)
      dispatchEvent(new StorageEvent('storage', { key, newValue: density }))
    }, { id: pilotId, density })
    await expect(field).toBeFocused()
    await expect(field).toHaveValue('25')
    expect(await element!.evaluate(e => e.isConnected && e === document.activeElement)).toBe(true)
    await expect.poll(() => field.evaluate(e => e.getBoundingClientRect().bottom)).toBeLessThanOrEqual(420)
    await expect.poll(() => field.evaluate(e => e.getBoundingClientRect().top - document.querySelector('.live-pinned')!.getBoundingClientRect().bottom)).toBeGreaterThanOrEqual(0)
  }
  await expect.poll(() => backend.getWorkouts()[0]!.exercises[0]!.sets[0]!.fact.durationSec).toBe(25)
})

for (const rpe of [false, true]) test(`client Live metric keyboard preserves final field rpe-${rpe}`, async ({ page }) => {
  await modelKeyboard(page)
  await page.addInitScript(({ id, rpe }) => {
    localStorage.setItem(`fit.rpeDisplay.${id}`, String(rpe))
    localStorage.setItem(`fit.liveExerciseAnimation.${id}`, 'false')
  }, { id: pilotId, rpe })
  const source = coachGestureWorkout(true, 2)
  source.startedAt = new Date(Date.now() - 120000).toISOString()
  Object.assign(source.exercises[0]!, { ref: 'rowing-machine', name: 'Гребной тренажёр', inputKind: 'distance' })
  source.exercises[0]!.sets.forEach(set => Object.assign(set, { weightKg: undefined, durationSec: 300, distanceKm: 1.02, reps: 24, rpe: 8 }))
  const backend = await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [source] })
  await page.goto(`/workouts/${workoutId}/live`)
  const row = page.locator('form[data-live-set-id]').first()
  await expect(row.locator('.live-metric-field')).toHaveCount(rpe ? 4 : 3)
  const field = row.getByLabel('Гребков в минуту')
  await field.fill('27')
  const element = await field.elementHandle()
  await showModeledKeyboard(page)
  for (const density of ['compact', 'original']) {
    await page.evaluate(({ id, density }) => {
      const key = `fit.clientLiveDensity.${id}`
      localStorage.setItem(key, density)
      window.dispatchEvent(new StorageEvent('storage', { key, newValue: density }))
    }, { id: pilotId, density })
    await expect(field).toBeFocused()
    await expect(field).toHaveValue('27')
    expect(await element!.evaluate(e => e.isConnected && e === document.activeElement)).toBe(true)
    await expect.poll(() => field.evaluate(e => e.getBoundingClientRect().bottom)).toBeLessThanOrEqual(420)
    await expect.poll(() => field.evaluate(e => e.getBoundingClientRect().top - document.querySelector('.live-pinned')!.getBoundingClientRect().bottom)).toBeGreaterThanOrEqual(0)
    await expect(field).toHaveCSS('height', density === 'original' ? '54px' : '48px')
  }
  await expect.poll(() => backend.getWorkouts()[0]!.exercises[0]!.sets[0]!.fact.reps).toBe(27)
  await tapVisible(page, row.getByRole('button', { name: 'Готово, отдых', exact: true }))
  await expect(row.getByRole('img', { name: 'Подход выполнен' })).toBeVisible()
  expect(backend.getWorkouts()[0]!.exercises[0]!.sets[0]!.fact.reps).toBe(27)
})

for (const entry of ['live', 'new', 'today']) for (const action of ['create', 'add']) test(`client keyboard picker first tap ${entry} ${action}`, async ({ page }) => {
  await modelKeyboard(page)
  const source = coachGestureWorkout()
  source.startedAt = new Date(Date.now() - 120000).toISOString()
  const backend = await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [source] })
  await page.goto(entry === 'live' ? `/workouts/${workoutId}/live` : entry === 'new' ? '/workouts/new' : '/me?entry=workout')
  await page.getByRole('button', { name: entry === 'live' ? 'Ещё упражнение' : entry === 'new' ? 'Выбрать упражнения' : 'Выбрать упражнения вручную', exact: true }).click()
  const picker = page.locator('.client-reference-catalog')
  const search = picker.getByLabel('Поиск упражнения', { exact: true })
  await search.fill(action === 'create' ? 'zzzaudit-no-exercise' : 'план')
  if (action === 'add') await picker.locator('.picker-select-mark').first().tap()
  await search.focus()
  await showModeledKeyboard(page)
  await tapVisible(page, picker.locator(action === 'create' ? '.coach-catalog-create-floating' : '.coach-catalog-add'))
  if (action === 'create') await expect(picker.getByRole('heading', { name: 'Своё упражнение' })).toBeVisible()
  else if (entry === 'live') await expect.poll(() => backend.getWorkouts()[0]!.exercises.length).toBe(source.exercises.length + 1)
  else await expect(picker).toHaveCount(0)
})

for (const density of ['original', 'compact']) for (const action of ['confirm', 'note', 'menu', 'append']) test(`client keyboard Live first tap ${density} ${action}`, async ({ page }) => {
  await modelKeyboard(page)
  await page.addInitScript(({ id, density }) => {
    localStorage.setItem(`fit.clientLiveDensity.${id}`, density)
    localStorage.setItem(`fit.liveExerciseAnimation.${id}`, 'false')
  }, { id: pilotId, density })
  const source = coachGestureWorkout()
  source.startedAt = new Date(Date.now() - 120000).toISOString()
  const backend = await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [source] })
  // Complete this scenario's append contract without extending the protected
  // global fixture inventory. All writes remain in memory.
  await page.route('**/v1/workout-exercises/*/sets', async route => {
    const workout = backend.getWorkouts()[0]!
    const exercise = workout.exercises.find(item => item.id === new URL(route.request().url()).pathname.split('/').at(-2))!
    exercise.sets.push({ ...exercise.sets.at(-1)!, id: 'c11e0000-6010-4000-8000-000000000999', position: exercise.sets.length, fact: {}, confirmedAt: null })
    workout.version += 1
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ workout: { version: workout.version } }) })
  })
  await page.goto(`/workouts/${workoutId}/live`)
  const row = page.locator('form[data-live-set-id]').first()
  await row.getByLabel('Фактический вес', { exact: true }).fill('25')
  await showModeledKeyboard(page)
  const target = action === 'confirm' ? row.getByRole('button', { name: 'Готово, отдых', exact: true })
    : page.locator(action === 'note' ? '.live-exercise-note summary' : action === 'menu' ? '.live-exercise .overflow-trigger' : '.live-add-set').first()
  await tapVisible(page, target)
  if (action === 'confirm') await expect(row).toHaveClass(/confirmed/)
  if (action === 'note') await expect(page.locator('.live-exercise-note').first()).toHaveAttribute('open', '')
  if (action === 'menu') await expect(page.getByRole('menu')).toBeVisible()
  if (action === 'append') await expect.poll(() => backend.getWorkouts()[0]!.exercises[0]!.sets.length).toBe(3)
})

test('client keyboard date confirmation applies the edited draft on first tap', async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 844 })
  await modelKeyboard(page)
  const source = coachGestureWorkout()
  source.createdBy = pilotId; source.status = 'planned'; source.startedAt = null
  source.workoutDate = '2026-12-20'; source.startTime = '10:00'; source.endTime = '11:00'
  await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [source] })
  await page.goto(`/workouts/${workoutId}/edit`)
  const trigger = page.getByRole('button', { name: 'Выбрать дату и время', exact: true })
  await trigger.click()
  const dialog = page.getByRole('dialog', { name: 'Дата и время', exact: true })
  await dialog.getByRole('button', { name: '1 декабря 2026 г.', exact: true }).click()
  await dialog.getByLabel('Начало', { exact: true }).focus()
  await showModeledKeyboard(page)
  await tapVisible(page, dialog.getByRole('button', { name: 'Применить дату', exact: true }))
  await expect(dialog).not.toBeVisible()
  await expect(trigger).toContainText('1 декабря 2026 г.')
})

test.beforeEach(async ({ page }) => {
  // Only app GETs may reach the local server; every API write is fixture-bound.
  await page.route('**/*', route => {
    const url = new URL(route.request().url())
    return url.origin === new URL(test.info().project.use.baseURL ?? `http://127.0.0.1:${process.env.FIT_TEST_PORT ?? 5173}`).origin
      && route.request().method() === 'GET' && !url.pathname.startsWith('/api/') ? route.continue() : route.abort()
  })
  await page.addInitScript(id => {
    const key = `fit.coachmarks-seen.${id}`
    const seen = JSON.parse(localStorage.getItem(key) ?? '[]') as string[]
    localStorage.setItem(key, JSON.stringify([...seen, 'client-live-reference-timer-2026-10']))
  }, pilotId)
  await page.routeWebSocket('**', socket => socket.close())
})

test('client reference settings preserve animation independently of density and reload', async ({ page }) => {
  await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [coachGestureWorkout()] })
  await page.goto('/me/settings')
  const original = page.getByRole('radio', { name: 'Оригинальный', exact: true })
  const compact = page.getByRole('radio', { name: 'Компактный', exact: true })
  const animation = page.getByRole('switch', { name: 'Анимация в Live', exact: true })
  await expect(original).toHaveAttribute('aria-checked', 'true')
  await expect(animation).toBeChecked()
  await compact.click()
  await expect(animation).toBeChecked()
  await animation.uncheck()
  await original.click()
  await expect(animation).not.toBeChecked()
  await page.reload()
  await expect(original).toHaveAttribute('aria-checked', 'true')
  await expect(animation).not.toBeChecked()
  await compact.click()
  await page.goto(`/workouts/${workoutId}/live`)
  await expect(page.locator('.client-live-density-compact')).toBeVisible()
  await expect(page.locator('.live-set-input').first()).toHaveCSS('min-height', '48px')
  await expect(page.locator('.live-header-animation, .exercise-thumbnail')).toHaveCount(0)
})

test('another client cannot enter the pilot from settings or a direct Live link', async ({ page }) => {
  await mockPilot(page, { role: 'client', profileId: 'c11e0000-6010-4000-8000-000000000002', clientLime: true, workouts: [coachGestureWorkout()] })
  await page.goto('/me/settings')
  await expect(page.getByRole('radiogroup', { name: 'Вид Live-тренировки' })).toHaveCount(0)
  await page.goto(`/workouts/${workoutId}/live`)
  await expect(page.locator('.live-workout-page')).toBeVisible()
  await expect(page.locator('.client-workout-reference, .client-live-density')).toHaveCount(0)
})

test('a trainer in the client allowlist retains trainer presentation', async ({ page }) => {
  await mockPilot(page, { profileId: pilotId, fitLime: true, workouts: [coachGestureWorkout()] })
  await page.goto(`/workouts/${workoutId}/live`)
  await expect(page.locator('.live-workout-page')).toBeVisible()
  await expect(page.locator('.client-workout-reference, .client-live-density')).toHaveCount(0)
})

// Each visual axis has a distinct risk: theme contrast, narrow wrapping and row density.
for (const theme of ['dark', 'light']) for (const width of [390, 430]) for (const density of ['original', 'compact']) for (const animation of [true, false]) {
  test(`client reference geometry ${theme} ${width} ${density} animation-${animation}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 844 })
    await page.addInitScript(({ id, theme, density, animation }) => {
      localStorage.setItem(`fit.clientLime.theme.${id}`, theme)
      localStorage.setItem(`fit.clientLiveDensity.${id}`, density)
      localStorage.setItem(`fit.liveExerciseAnimation.${id}`, JSON.stringify(animation))
    }, { id: pilotId, theme, density, animation })
    const source = coachGestureWorkout()
    source.startedAt = new Date(Date.now() - 120000).toISOString()
    source.exercises[0] = { ...source.exercises[0]!, ref: 'barbell-squat', name: 'Присед со штангой на плечах' }
    await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [source] })
    await page.goto('/me/settings')
    await expect(page.getByRole('switch', { name: 'Анимация в Live', exact: true })).toBeChecked({ checked: animation })
    const options = page.getByRole('radiogroup', { name: 'Вид Live-тренировки' })
    await expect(options.getByRole('radio', { name: density === 'original' ? 'Оригинальный' : 'Компактный', exact: true })).toHaveAttribute('aria-checked', 'true')
    await expect(options.getByRole('radio', { name: density === 'original' ? 'Оригинальный' : 'Компактный', exact: true })).toHaveCSS('background-color', 'rgb(182, 239, 77)')
    await page.screenshot({ path: info.outputPath('settings.png') })
    await page.goto(`/workouts/${workoutId}/live`)
    await expect(page.locator(`.client-live-density-${density}`)).toBeVisible()
    await expect(page.locator('.live-set-input').first()).toHaveCSS('min-height', density === 'original' ? '54px' : '48px')
    await expect(page.locator('.phone-frame')).toHaveCSS('background-color', theme === 'light' ? 'rgb(246, 247, 242)' : 'rgb(0, 0, 0)')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await expect(page.locator('.coach-v79-large-clock')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Завершить тренировку', exact: true })).toHaveCount(1)
    await expect(page.locator('.coach-live-metric').first()).toBeVisible()
    await expect(page.locator('.coach-v79-large-clock > .coach-live-digits')).toHaveCSS('font-family', /Doto/)
    await expect(page.locator('.live-exercise-head .exercise-thumbnail')).toHaveCount(animation ? source.exercises.length : 0)
    await expect(page.locator('.live-header-animation')).toHaveCount(animation ? 1 : 0)
    const title = page.locator('.live-exercise-head h2').first()
    expect(await title.evaluate(el => { const r=el.getBoundingClientRect(); return r.width > 80 && r.left >= 0 && r.right <= innerWidth })).toBe(true)
    await page.screenshot({ path: info.outputPath('live.png') })
  })
}

for (const density of ['original', 'compact']) test(`client reference input and confirmed edits ${density}`, async ({ page }) => {
  await page.addInitScript(({ id, density }) => localStorage.setItem(`fit.clientLiveDensity.${id}`, density), { id: pilotId, density })
  const source = restTimerWorkout()
  source.exercises[0]!.restBetweenSetsSec = 90
  await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [source] })
  const drafts: Array<{ weightKg?: number; reps?: number }> = []
  let confirmations = 0
  page.on('request', (request) => {
    if (/\/workout-sets\/[^/]+\/draft$/.test(request.url())) drafts.push((request.postDataJSON() as { draft: typeof drafts[number] }).draft)
    if (/\/workout-sets\/[^/]+\/confirm$/.test(request.url())) confirmations += 1
  })
  await page.goto(`/workouts/${workoutId}/live`)
  const first = page.locator('form[data-live-set-id]').first()
  const second = page.locator('form[data-live-set-id]').nth(1)
  const weight = first.getByLabel('Фактический вес', { exact: true })
  const reps = first.getByLabel('Фактические повторы', { exact: true })
  await weight.click()
  await expect.poll(() => weight.evaluate((field: HTMLInputElement) => [field.selectionStart, field.selectionEnd])).toEqual([0, 2])
  await page.keyboard.type('22,5')
  await page.keyboard.press('Enter')
  await expect(reps).toBeFocused()
  await page.keyboard.type('8')
  await reps.evaluate(el => { el.dataset.stableInput = 'before-density' })
  await page.evaluate(({ id, density }) => {
    localStorage.setItem(`fit.clientLiveDensity.${id}`, density === 'original' ? 'compact' : 'original')
    window.dispatchEvent(new Event('fit-client-live-density-change'))
  }, { id: pilotId, density })
  await expect(reps).toBeFocused()
  await expect(reps).toHaveValue('8')
  await expect(reps).toHaveAttribute('data-stable-input', 'before-density')
  await first.getByRole('button', { name: 'Готово, отдых', exact: true }).click()
  await expect(first.getByRole('img', { name: 'Подход выполнен' })).toBeVisible()
  await expect(second.getByLabel('Фактический вес', { exact: true })).toBeFocused()
  await expect(weight).toBeEnabled()
  await expect(weight).toHaveValue('22,5')
  const deadline = await page.evaluate(() => sessionStorage.getItem('fit:live-rest-until:10000000-0000-4000-8000-000000000003'))
  expect(deadline).not.toBeNull()
  const savedEdit = page.waitForResponse((response) => /\/workout-sets\/[^/]+\/draft$/.test(response.url()) && response.ok()
    && (response.request().postDataJSON() as { draft: { reps?: number } }).draft.reps === 9)
  await weight.click()
  await page.keyboard.type('25')
  await page.keyboard.press('Enter')
  await expect(reps).toBeFocused()
  await page.keyboard.type('9')
  await page.keyboard.press('Enter')
  await expect(second.getByLabel('Фактический вес', { exact: true })).toBeFocused()
  await expect.poll(() => drafts.some((draft) => draft.weightKg === 25 && draft.reps === 9)).toBe(true)
  await savedEdit
  await expect(first).toHaveClass(/confirmed/)
  await expect(first.getByRole('button', { name: 'Редактировать подход' })).toHaveCount(0)
  expect(await page.evaluate(() => sessionStorage.getItem('fit:live-rest-until:10000000-0000-4000-8000-000000000003'))).toBe(deadline)
  expect(confirmations).toBe(1)
  await page.reload()
  await expect(weight).toHaveValue('25')
  await expect(reps).toHaveValue('9')
  await expect(first).toHaveClass(/confirmed/)
  let failedSave = false
  await page.route(`**/workout-sets/${source.exercises[0]!.sets[0]!.id}/draft`, async (route) => {
    if (!failedSave) { failedSave = true; await route.fulfill({ status: 503, json: { error: 'service_unavailable' } }) }
    else await route.fallback()
  })
  await weight.fill('30')
  await weight.blur()
  await expect(page.locator('.live-sync-state[role="alert"]')).toBeVisible()
  await expect(weight).toHaveValue('30')
  await expect(first).toHaveClass(/confirmed/)
  await page.locator('.live-sync-state').getByRole('button', { name: 'Повторить', exact: true }).click()
  await expect(page.locator('.live-sync-state')).toHaveCount(0)
  expect(confirmations).toBe(1)
  expect(await page.evaluate(() => sessionStorage.getItem('fit:live-rest-until:10000000-0000-4000-8000-000000000003'))).toBe(deadline)
  await page.reload()
  await expect(weight).toHaveValue('30')
  await expect(first).toHaveClass(/confirmed/)
})

test('client reference preserves full-card drag cancellation and stored results', async ({ page }) => {
  const source = coachGestureWorkout()
  const first = source.exercises[0]!
  first.sets[0]!.confirmedAt = '2026-10-20T08:00:00Z'
  first.sets[0]!.fact = { weightKg: 25, reps: 9 }
  await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [source] })
  let moves = 0
  page.on('request', request => { if (/\/blocks\/[^/]+\/move$/.test(request.url())) moves += 1 })
  await page.goto(`/workouts/${workoutId}/live`)
  await expect(page.locator('[data-workout-swipe], .workout-drag-handle')).toHaveCount(0)
  const card = await holdClientLiveCard(page, first.blockId)
  await page.keyboard.press('Escape')
  await page.mouse.up()
  await expect(card).not.toHaveClass(/dragging/)
  expect(moves).toBe(0)
  await holdClientLiveCard(page, first.blockId)
  await page.mouse.move(24, 820, { steps: 12 })
  await expect(page.locator('.workout-drag-preview')).toContainText('Позиция 3 из 3')
  await page.mouse.up()
  await expect(page.locator('[data-workout-block]').last()).toHaveAttribute('data-workout-block', first.blockId)
  expect(moves).toBe(1)
  await expect(page.locator(`form[data-live-set-id="${first.sets[0]!.id}"]`)).toHaveClass(/confirmed/)
  await expect(card.getByLabel('Фактический вес', { exact: true }).first()).toHaveValue('25')
})

test('client reference top finish retains missing cardio time warning', async ({ page }) => {
  const source = restTimerWorkout(), exercise = source.exercises[0]!
  exercise.inputKind = 'distance'; exercise.ref = 'running'; exercise.muscleGroup = 'cardio'; exercise.name = 'Бег'
  exercise.sets = [ { ...exercise.sets[0]!, confirmedAt: '2026-10-08T09:01:00Z', fact: { distanceKm: 1 }, distanceKm: 1 } ]
  await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [source] })
  let finishes = 0
  page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/finish')) finishes++ })
  await page.goto(`/workouts/${workoutId}/live`)
  await page.getByRole('button', { name: 'Завершить тренировку', exact: true }).click()
  await expect(page.locator('.finish-confirm')).toContainText('нет фактического времени')
  await page.getByRole('button', { name: 'Внести время', exact: true }).click()
  await expect(page.locator('.finish-confirm')).toHaveCount(0)
  await expect(page.getByRole('textbox', { name: 'Фактическое время: минуты', exact: true })).toBeEnabled()
  await expect(page.getByRole('textbox', { name: 'Фактическое время: минуты', exact: true })).toBeFocused()
  expect(finishes).toBe(0)
  await page.reload()
  await page.getByRole('button', { name: 'Завершить тренировку', exact: true }).click()
  await page.getByRole('button', { name: 'Завершить без оценки', exact: true }).click()
  await expect(page).not.toHaveURL(/\/live$/)
  expect(finishes).toBe(1)
})

function timedRepsWorkout() {
  const source = restTimerWorkout(0, true, 'timer')
  const exercise = source.exercises[0]!
  source.exercises[0] = { ...exercise, ref: 'squat', name: 'Приседания', inputKind: 'reps', sets: exercise.sets.map((set) => ({ ...set, reps: 10 })) }
  return source
}

async function runTwoTimedSets(page: Page, waitForServer: boolean) {
  await expect(page.locator('.live-rest-trigger').and(page.getByRole('button'))).toContainText('Подход 0:03')
  await page.clock.fastForward(3_000)
  if (waitForServer) await expect(page.locator('.live-session-progress-copy')).toContainText('Готово 1 из 2')
  await expect(page.locator('.live-rest-trigger').and(page.getByRole('button'))).toContainText('Отдых 0:02')
  await page.clock.fastForward(2_000)
  await expect(page.locator('.live-rest-trigger').and(page.getByRole('button'))).toContainText('Подход 0:03')
  await page.clock.fastForward(3_000)
  await expect(page.locator('.live-session-progress-copy')).toContainText('Готово 2 из 2')
}

function recordSetDrafts(page: Page) {
  const drafts: Array<{ timerConfirmed?: true }> = []
  page.on('request', (request) => {
    if (/\/v1\/workout-sets\/[^/]+\/draft$/.test(new URL(request.url()).pathname)) drafts.push((request.postDataJSON() as { draft: { timerConfirmed?: true } }).draft)
  })
  return drafts
}


test('client reference Live manual mode keeps timed sets manual', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-08T09:00:00Z') })
  await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [restTimerWorkout(0, true)] })
  await page.goto(`/workouts/${workoutId}/live`)
  await expect(page.locator('.live-rest-trigger').and(page.getByRole('button'))).toHaveText('Отдых')
  await page.clock.fastForward(10_000)
  await expect(page.locator('.live-session-progress-copy')).toContainText('Готово 0 из 2')
  await page.getByRole('button', { name: 'Готово, отдых', exact: true }).first().click()
  await expect(page.locator('.live-session-progress-copy')).toContainText('Готово 1 из 2')
  await page.clock.fastForward(4_000)
  await expect(page.locator('.live-rest-trigger').and(page.getByRole('button'))).toContainText('−0:02')
  await expect(page.locator('.live-session-progress-copy')).toContainText('Готово 1 из 2')
})

test('client reference Live timer mode asks to confirm planned reps before finishing', { tag: ["@lime-critical"] }, async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-08T09:00:00Z') })
  await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [timedRepsWorkout()] })
  const drafts = recordSetDrafts(page)
  await page.goto(`/workouts/${workoutId}/live`)
  await runTwoTimedSets(page, true)
  expect(drafts.filter((draft) => draft.timerConfirmed)).toHaveLength(2)
  await expect(page.getByRole('button', { name: 'Подтвердить подходы: Приседания', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Завершить тренировку', exact: true }).click()
  await expect(page.locator('.timer-review')).toContainText('Таймер засчитал подходов: 2. Всё верно?')
  const finish = page.waitForRequest((request) => new URL(request.url()).pathname === `/v1/workouts/${workoutId}/finish`)
  await page.getByRole('button', { name: 'Всё верно, завершить', exact: true }).click()
  await finish
  expect(drafts.slice(-2).every((draft) => !draft.timerConfirmed)).toBe(true)
})

test('client reference Live mode switch in the timer settings stops the timer flow for this session', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-08T09:00:00Z') })
  await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [restTimerWorkout(0, true, 'timer')] })
  await page.goto(`/workouts/${workoutId}/live`)
  await expect(page.locator('.live-rest-trigger').and(page.getByRole('button'))).toContainText('Подход 0:03')
  await page.locator('.live-rest-trigger').and(page.getByRole('button')).click({ button: 'right' })
  const mode = page.getByRole('dialog').getByRole('group', { name: 'Кто ведёт тренировку' })
  await expect(mode.getByRole('button', { name: 'Ведёт таймер' })).toHaveAttribute('aria-pressed', 'true')
  await mode.getByRole('button', { name: 'Веду сам', exact: true }).click()
  await page.getByRole('button', { name: 'Закрыть таймер' }).click()
  await expect(page.locator('.live-rest-trigger').and(page.getByRole('button'))).toHaveText('Отдых')
  await page.clock.fastForward(5_000)
  await expect(page.locator('.live-session-progress-copy')).toContainText('Готово 0 из 2')
})

for (const density of ['original', 'compact']) test(`client reference pause clock freezes and resumes the existing timer ${density}`, async ({ page }, info) => {
  await page.clock.install({ time: new Date('2026-10-08T09:00:00Z') })
  await page.addInitScript(({ id, density }) => {
    localStorage.setItem(`fit.clientLiveDensity.${id}`, density)
    localStorage.setItem(`fit.clientLime.theme.${id}`, density === 'original' ? 'dark' : 'light')
  }, { id: pilotId, density })
  await page.setViewportSize({ width: density === 'original' ? 390 : 430, height: 844 })
  const source = Object.assign(restTimerWorkout(0, true, 'timer'), { startedAt: '2026-10-08T08:59:00Z', pausedSeconds: 20 })
  await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [source] })
  const pauses: boolean[] = []
  page.on('request', request => { if (new URL(request.url()).pathname.endsWith('/pause')) pauses.push((request.postDataJSON() as { paused: boolean }).paused) })
  await page.goto(`/workouts/${workoutId}/live`)
  await expect(page.locator('.live-rest-trigger').and(page.getByRole('button'))).toContainText('Подход 0:03')
  const clock = page.locator('.client-reference-pause').and(page.getByRole('button'))
  await expect(clock).toHaveCount(1)
  await expect(clock).toHaveAttribute('aria-pressed', 'false')
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 500)
  const cardTop = await page.locator('.live-exercise').first().evaluate(el => el.getBoundingClientRect().top)
  await clock.click()
  // The test clock is frozen; deliver the existing query notification timer.
  await page.clock.runFor(1)
  await expect(clock).toHaveAttribute('aria-pressed', 'true')
  await expect(clock).toHaveText('Продолжить')
  const elapsed = (await clock.getAttribute('aria-label'))!.split(', прошло ')[1]!
  const frozen = await page.locator('.live-rest-trigger').and(page.getByRole('button')).innerText()
  await page.screenshot({ path: info.outputPath('paused-clock.png'), animations: 'disabled' })
  expect(await page.locator('.live-exercise').first().locator('.live-set-check,.live-add-set,.live-exercise-note summary').evaluateAll(nodes => nodes.every(node => { const r = node.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth }))).toBe(true)
  await page.clock.fastForward(10_000)
  await expect(page.locator('.live-rest-trigger').and(page.getByRole('button'))).toHaveText(frozen)
  await expect(clock).toHaveAttribute('aria-label', `Продолжить тренировку, прошло ${elapsed}`)
  await expect(page.locator('.live-session-progress-copy')).toContainText('Готово 0 из 2')
  expect(Math.abs((await page.locator('.live-exercise').first().evaluate(el => el.getBoundingClientRect().top)) - cardTop)).toBeLessThanOrEqual(1)
  await clock.click()
  await page.clock.runFor(1)
  await expect(clock).toHaveAttribute('aria-label', `Поставить тренировку на паузу, прошло ${elapsed}`)
  await expect.poll(() => pauses).toEqual([true, false])
  await page.clock.fastForward(3_000)
  await expect(page.locator('.live-session-progress-copy')).toContainText('Готово 1 из 2')
})

for (const density of ['original', 'compact']) test(`client reference pause restores existing server state and set action resumes ${density}`, async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-08T09:02:00Z') })
  await page.addInitScript(({ id, density }) => localStorage.setItem(`fit.clientLiveDensity.${id}`, density), { id: pilotId, density })
  const source = Object.assign(restTimerWorkout(0, true), { startedAt: '2026-10-08T09:00:00Z', pausedAt: '2026-10-08T09:01:00Z', pausedSeconds: 20 })
  await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [source] })
  const pauses: boolean[] = []
  page.on('request', request => { if (new URL(request.url()).pathname.endsWith('/pause')) pauses.push((request.postDataJSON() as { paused: boolean }).paused) })
  await page.goto(`/workouts/${workoutId}/live`)
  const clock = page.locator('.client-reference-pause').and(page.getByRole('button'))
  await expect(clock).toHaveAttribute('aria-label', 'Продолжить тренировку, прошло 00:40')
  await expect(clock).toHaveText('Продолжить')
  await page.clock.fastForward(10_000)
  await page.reload()
  await expect(clock).toHaveAttribute('aria-label', 'Продолжить тренировку, прошло 00:40')
  expect(pauses).toEqual([])
  await page.getByRole('button', { name: 'Старт подхода' }).first().click()
  await expect(clock).toHaveAttribute('aria-pressed', 'false')
  await expect(clock).toHaveText('Пауза')
  await expect(page.locator('.live-rest-trigger').and(page.getByRole('button'))).toContainText('Подход 0:03')
  await expect.poll(() => pauses).toEqual([false])
})

test('client reference Live manual mode times a set from Start and records the time past zero', async ({ page }) => {
  // Часы стоят и двигаются только fastForward: записанное время точное и в медленном CI.
  await page.clock.install({ time: new Date('2026-10-08T09:00:00Z') })
  await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [restTimerWorkout(0, true)] })
  const drafts: Array<{ durationSec?: number; timerConfirmed?: true }> = []
  page.on('request', (request) => {
    if (/\/v1\/workout-sets\/[^/]+\/draft$/.test(new URL(request.url()).pathname)) drafts.push((request.postDataJSON() as { draft: { durationSec?: number; timerConfirmed?: true } }).draft)
  })
  await page.goto(`/workouts/${workoutId}/live`)
  await expect(page.locator('.live-rest-trigger').and(page.getByRole('button'))).toHaveText('Отдых')
  await page.clock.pauseAt(new Date('2026-10-08T09:01:00Z'))
  await page.getByRole('button', { name: 'Старт подхода' }).first().click()
  await expect(page.locator('.live-rest-trigger').and(page.getByRole('button'))).toContainText('Подход 0:03')
  await page.clock.fastForward(5_000)
  await expect(page.locator('.live-rest-trigger').and(page.getByRole('button'))).toContainText('Подход +0:02')
  await expect(page.locator('.coach-v79-large-clock')).toHaveAttribute('aria-label', 'Подход: +00:02')
  await expect(page.locator('.live-session-progress-copy')).toContainText('Готово 0 из 2')
  await expect(page.getByRole('button', { name: /^Засчитать подход:/ })).toHaveCSS('border-radius', '16px')
  await expect(page.getByRole('button', { name: /^Засчитать подход:/ })).toHaveCSS('min-height', '54px')
  await page.getByRole('button', { name: /^Засчитать подход:/ }).click()
  await expect(page.locator('.live-session-progress-copy')).toContainText('Готово 1 из 2')
  expect(drafts.at(-1)).toMatchObject({ durationSec: 5 })
  expect(drafts.at(-1)?.timerConfirmed).toBeUndefined()
})


for (const mode of ['planned', 'done'] as const) for (const wheel of [false, true]) test(`client editor reference metric kinds preserve ${mode} wheel-${wheel}`, async ({ page }, info) => {
  await page.setViewportSize({ width: mode === 'planned' ? 390 : 430, height: 844 })
  await page.addInitScript(({ id, wheel, mode }) => { localStorage.setItem('fit.workoutTimeWheel', String(wheel)); localStorage.setItem(`fit.rpeDisplay.${id}`, 'true'); localStorage.setItem(`fit.clientLime.theme.${id}`, mode === 'planned' ? 'dark' : 'light') }, { id: pilotId, wheel, mode })
  const source = coachGestureWorkout()
  source.createdBy = pilotId; source.trainingFormat = 'self'; source.status = mode
  source.startedAt = mode === 'done' ? '2026-10-20T09:00:00Z' : null
  source.completedAt = mode === 'done' ? '2026-10-20T10:00:00Z' : null
  source.exercises = source.exercises.map((exercise, index) => ({ ...exercise,
    name: ['Планка', 'Бег с длинным названием тренировки', 'Упражнение на повторы'][index]!,
    ref: ['plank', 'running', 'push-ups'][index]!, inputKind: (['duration', 'distance', 'reps'] as const)[index]!,
    sets: [{ ...exercise.sets[0]!, weightKg: undefined, durationSec: index === 1 ? 600 : index === 2 && mode === 'planned' ? undefined : 90, distanceKm: index === 1 ? 1.5 : undefined, reps: index === 2 ? 12 : undefined, rpe: 7,
      confirmedAt: mode === 'done' ? '2026-10-20T09:10:00Z' : null,
      fact: mode === 'done' ? { durationSec: index === 1 ? 500 : 45, distanceKm: index === 1 ? 2 : undefined, reps: index === 2 ? 10 : undefined, rpe: 6 } : {} }] }))
  await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [source] })
  const writes: Array<{ exercises: Array<{ sets: Array<{ durationSec?: number; distanceKm?: number; reps?: number }> }> }> = []
  await page.route(`**/v1/workouts/${workoutId}`, route => { if (route.request().method() === 'PUT') writes.push(route.request().postDataJSON() as typeof writes[number]); return route.fallback() })
  // Completed edits use the existing separate endpoint; the common fixture covers plan PUT.
  await page.route(`**/v1/workouts/${workoutId}/completed`, route => { if (route.request().method() !== 'PUT') return route.fallback(); writes.push(route.request().postDataJSON() as typeof writes[number]); return route.fulfill({ json: { workout: { id: workoutId } } }) })
  await page.goto(`/workouts/${workoutId}/edit`)
  const plank = page.locator('.planned-exercise').nth(0)
  const run = page.locator('.planned-exercise').nth(1)
  const reps = page.locator('.planned-exercise').nth(2)
  if (wheel) {
    const clock = plank.getByRole('button', { name: mode === 'done' ? 'Время, подход 1: 0:45' : 'Время, подход 1: 1:30', exact: true })
    await expect(clock).toBeVisible()
    await clock.click()
    const picker = page.getByRole('dialog', { name: 'Время, подход 1', exact: true })
    await expect(picker).toBeVisible()
    await page.screenshot({ path: info.outputPath('duration-picker.png') })
    await picker.getByRole('button', { name: 'Закрыть выбор времени', exact: true }).click()
  } else {
    await expect(plank.locator('.workout-duration-trigger')).toHaveCount(0)
    await expect(plank.getByLabel('Время, подход 1: секунды', { exact: true })).toHaveValue(mode === 'done' ? '45' : '30')
  }
  const distance = run.getByLabel('Расстояние, подход 1', { exact: true })
  await expect(distance).toHaveValue(mode === 'done' ? '2' : '1.5')
  await distance.fill('2.75'); await distance.press('Tab')
  await run.getByLabel('Единица расстояния, подход 1', { exact: true }).selectOption('m')
  await expect(distance).toHaveValue('2750')
  await run.getByLabel('Единица расстояния, подход 1', { exact: true }).selectOption('km')
  await expect(distance).toHaveValue('2.75')
  await expect(reps.getByLabel('Повторы, подход 1', { exact: true })).toHaveValue(mode === 'done' ? '10' : '12')
  if (mode === 'planned' && wheel) await expect(reps.getByRole('button', { name: 'Время, подход 1: не указано', exact: true })).toHaveText('—')
  await expectClientEditorFits(page)
  await page.screenshot({ path: info.outputPath('mixed-metrics.png') })
  await reps.scrollIntoViewIfNeeded()
  await page.screenshot({ path: info.outputPath('mixed-metrics-last.png') })
  await page.getByRole('button', { name: mode === 'done' ? 'Сохранить изменения' : 'Сохранить план', exact: true }).click()
  await expect.poll(() => writes.length).toBe(1)
  expect(writes[0]!.exercises[0]!.sets[0]!.durationSec).toBe(mode === 'done' ? 45 : 90)
  expect(writes[0]!.exercises[1]!.sets[0]!.distanceKm).toBe(2.75)
  expect(writes[0]!.exercises[2]!.sets[0]!.reps).toBe(mode === 'done' ? 10 : 12)
})

for (const [theme, width] of [['dark', 390], ['light', 430]] as const) test(`client editor reference copy edits and saves a new plan ${theme}`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 844 })
  await page.addInitScript(({ id, theme }) => { localStorage.setItem(`fit.clientLime.theme.${id}`, theme); localStorage.setItem(`fit.coachmarks-seen.${id}`, JSON.stringify(['client-live-reference-timer-2026-10'])) }, { id: pilotId, theme })
  const source = coachGestureWorkout(false, 1)
  source.createdBy = pilotId; source.status = 'done'; source.workoutDate = '2026-10-20'; source.completedAt = '2026-10-20T09:10:00Z'
  source.exercises[0]!.sets[0]!.confirmedAt = source.completedAt
  source.exercises[0]!.sets[0]!.fact = { weightKg: 25, reps: 9 }
  await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [source] })
  const copies: Array<{ exercises: Array<{ blockId?: string; sets: Array<{ weightKg?: number; reps?: number; fact?: unknown; confirmedAt?: unknown }> }> }> = []
  const originalWrites: string[] = []
  page.on('request', request => {
    const path = new URL(request.url()).pathname
    if (path === '/v1/workouts' && request.method() === 'POST') copies.push(request.postDataJSON() as typeof copies[number])
    if (path === `/v1/workouts/${workoutId}` && ['PUT', 'DELETE'].includes(request.method())) originalWrites.push(request.method())
  })
  await page.goto('/me/workouts')
  await page.getByRole('tab', { name: 'История', exact: true }).click()
  await page.getByRole('link', { name: /^Скопировать тренировку за/ }).click()
  await expect(page).toHaveURL(new RegExp(`/workouts/new\\?copy=${workoutId}`))
  await expect(page.locator('.client-reference-form')).toBeVisible()
  await expect(page.getByText(/Скопировано/).first()).toBeVisible()
  const exercise = page.locator('.planned-exercise').first()
  await exercise.locator('.compact-editor-exercise-toggle').click()
  const weight = exercise.getByLabel('Вес, подход 1', { exact: true })
  await expect(weight).toHaveValue('25')
  await expect(exercise.getByLabel('Повторы, подход 1', { exact: true })).toHaveValue('9')
  await expect(exercise.getByLabel('Вес, подход 2', { exact: true })).toHaveValue('20')
  await weight.fill('27.5')
  await exercise.getByLabel('Повторы, подход 1', { exact: true }).fill('8')
  await expectClientEditorFits(page)
  await weight.scrollIntoViewIfNeeded()
  await page.screenshot({ path: info.outputPath('copy-edit.png') })
  const save = page.getByRole('button', { name: 'Сохранить план', exact: true })
  await save.scrollIntoViewIfNeeded()
  await expectClientEditorFits(page)
  await page.screenshot({ path: info.outputPath('copy-save.png') })
  await save.click()
  await expect.poll(() => copies.length).toBe(1)
  expect(copies[0]!.exercises[0]!.sets[0]).toMatchObject({ weightKg: 27.5, reps: 8 })
  expect(copies[0]!.exercises[0]!.sets[1]).toMatchObject({ weightKg: 20, reps: 10 })
  expect(copies[0]!.exercises[0]!.sets[0]!.fact).toBeUndefined()
  expect(copies[0]!.exercises[0]!.sets[0]!.confirmedAt).toBeUndefined()
  expect(copies[0]!.exercises[0]!.blockId).not.toBe(source.exercises[0]!.blockId)
  expect(originalWrites).toEqual([])
  await expect(page).toHaveURL(new RegExp(`/workouts/${newWorkoutId}`))
})

async function expectClientEditorFits(page: Page) {
  const overflow = await page.locator('.content').evaluate(el => el.scrollWidth - el.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
  const outside = await page.locator('.planned-set, .workout-editor-footer, .today-exercise-title').evaluateAll((nodes: Element[]): string[] => nodes.filter(el => {
    const r = el.getBoundingClientRect()
    return el.getClientRects().length > 0 && (r.left < -1 || r.right > innerWidth + 1)
  }).map(el => el.getAttribute('class') ?? ''))
  expect(outside).toEqual([])
}

for (const theme of ['dark', 'light']) for (const width of [390, 430]) test(`client editor reference geometry ${theme} ${width}`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 844 })
  await page.addInitScript(({ id, theme }) => { localStorage.setItem(`fit.clientLime.theme.${id}`, theme); localStorage.setItem(`fit.coachmarks-seen.${id}`, JSON.stringify(['client-live-reference-timer-2026-10'])) }, { id: pilotId, theme })
  const plan = coachGestureWorkout()
  plan.status = 'planned'; plan.startedAt = null; plan.createdBy = pilotId
  plan.exercises[0] = { ...plan.exercises[0]!, ref: 'barbell-squat', name: 'Присед со штангой на плечах' }
  await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [plan] })
  await page.goto(`/workouts/${workoutId}/edit`)
  await expect(page.locator('.client-reference-form')).toBeVisible()
  const field = page.getByLabel('Вес, подход 1', { exact: true }).first()
  await expect(field).toHaveCSS('height', '48px')
  await expect(field).toHaveCSS('border-radius', '16px')
  await expect(field).toHaveCSS('font-family', /YS Geo/)
  await expectClientEditorFits(page)
  await page.screenshot({ path: info.outputPath('editor-top.png') })
  await page.locator('.content').evaluate(el => { el.scrollTop = el.scrollHeight })
  await expect(page.getByRole('button', { name: 'Действия с планом', exact: true })).toBeVisible()
  await expectClientEditorFits(page)
  await page.screenshot({ path: info.outputPath('editor-bottom.png') })
  await page.goto('/me?entry=workout')
  await page.getByLabel('Тренировка', { exact: true }).fill('Жим лёжа один подход десять повторений 40 кг')
  await page.getByRole('button', { name: 'Разобрать тренировку', exact: true }).click()
  await page.getByText('Править подходы', { exact: true }).click()
  await expect(page.locator('.client-reference-flow .coach-plan-metric').first()).toBeVisible()
  await expect(page.locator('.client-reference-flow .planned-set-input').first()).toHaveCSS('height', '48px')
  await expectClientEditorFits(page)
  await page.screenshot({ path: info.outputPath('review.png') })
  await page.getByRole('button', { name: 'Далее', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Запланировать тренировку', exact: true })).toBeVisible()
  await expectClientEditorFits(page)
  await page.screenshot({ path: info.outputPath('save.png') })
})

test('client reference voice cancel, review edits and failed save retain the draft', async ({ page }) => {
  const backend = await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [], failFirstSave: true })
  await mockClientStreamingVoice(page, 'Приседания один подход десять повторений')
  await page.goto('/me?entry=workout')
  const text = page.getByLabel('Тренировка', { exact: true })
  await text.fill('Жим лёжа один подход десять повторений 40 кг')
  await page.getByRole('button', { name: 'Надиктовать тренировку', exact: true }).click()
  await page.getByRole('button', { name: 'Отменить', exact: true }).click()
  await expect(text).toHaveValue('Жим лёжа один подход десять повторений 40 кг')
  await page.getByRole('button', { name: 'Разобрать тренировку', exact: true }).click()
  await page.getByText('Править подходы', { exact: true }).click()
  const weight = page.getByRole('spinbutton', { name: /: вес, подход 1$/ }).first()
  await weight.fill('22.5')
  await page.getByRole('button', { name: 'Далее', exact: true }).click()
  await page.getByRole('button', { name: 'Запланировать тренировку', exact: true }).click()
  await expect.poll(() => backend.getSaveAttempts()).toBe(1)
  await expect(page.getByRole('heading', { name: 'Сохраните тренировку', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '← К проверке', exact: true }).click()
  await page.getByText('Править подходы', { exact: true }).click()
  await expect(weight).toHaveValue('22.5')
  await page.getByRole('button', { name: 'Далее', exact: true }).click()
  await page.getByRole('button', { name: 'Запланировать тренировку', exact: true }).click()
  await expect.poll(() => backend.getSaveAttempts()).toBe(2)
  await expect(page).toHaveURL(new RegExp(`/workouts/${newWorkoutId}`))
})

test('client plan requires the current profile and preserves dictated drafts across profile and save failures', async ({ page }, info) => {
  const backend = await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true,
    workouts: [], failClients: true, failFirstSave: true })
  const transcript = 'Приседания один подход десять повторений'
  await page.addInitScript(({ id, transcript }) => {
    const draft = { screen: 'save', text: transcript, reviewedText: transcript, lastLlmText: transcript,
      choices: {}, clientId: '10000000-0000-4000-8000-000000000099', recordMode: 'planned',
      workoutDate: '2026-10-22', startTime: '', items: [{
        line: transcript, hasValues: true, exercise: { source: 'system', ref: 'squat',
          name: 'Приседание', muscleGroup: 'legs', inputKind: 'strength' },
        sets: [{ position: 0, weightKg: 22.5, reps: 10 }],
      }] }
    for (const draftId of ['access-probe', 'independent']) {
      const key = 'fit.today-draft.' + id + '.plan.client-' + draftId
      if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(draft))
    }
    localStorage.setItem('fit.client-today-drafts.' + id, JSON.stringify(['access-probe', 'independent']))
  }, { id: pilotId, transcript })
  await page.goto('/me?view=save&draft=access-probe')
  const save = page.getByRole('button', { name: 'Запланировать тренировку', exact: true })
  await expect(page.getByRole('heading', { name: 'Не удалось загрузить данные' })).toBeVisible()
  await expect(save).toHaveCount(0)
  expect(backend.getSaveAttempts()).toBe(0)
  for (const theme of ['light', 'dark']) {
    await page.evaluate(({ id, theme }) => {
      localStorage.setItem('fit.clientLime.theme.' + id, theme)
      window.dispatchEvent(new Event('fit-client-lime-theme-change'))
    }, { id: pilotId, theme })
    for (const width of [390, 430]) {
      await page.setViewportSize({ width, height: 844 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: info.outputPath('plan-profile-error-' + theme + '-' + width + '.png'), fullPage: true })
    }
  }
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Не удалось загрузить данные' })).toBeVisible()
  backend.setClientsFailure(false)
  await page.getByRole('button', { name: 'Повторить', exact: true }).first().click()
  await expect(save).toBeEnabled()
  // The form is now mounted. A failed background profile refresh must not
  // fall back to the obsolete card embedded in this restored draft.
  await page.getByRole('button', { name: '← К проверке', exact: true }).click()
  await page.getByRole('button', { name: 'Добавить упражнение', exact: true }).click()
  const picker = page.getByRole('dialog', { name: 'Добавить упражнение', exact: true })
  await picker.getByLabel('Поиск упражнения').fill('Synthetic new movement 643')
  await picker.getByRole('button', { name: 'Создать упражнение', exact: true }).click()
  await picker.getByLabel('Название', { exact: true }).fill('Synthetic new movement 643')
  await picker.locator('.picker-categories').getByRole('button', { name: 'Ноги', exact: true }).click()
  await picker.getByRole('button', { name: 'Сохранить упражнение', exact: true }).click()
  await picker.getByRole('button', { name: /^Добавить.*1/ }).click()
  await expect(picker).toHaveCount(0)
  await page.getByRole('button', { name: 'Далее', exact: true }).click()
  backend.setClientsFailure(true)
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await expect(page.getByText('Не удалось открыть профиль спортсмена.', { exact: false })).toBeVisible()
  await expect(save).toBeDisabled()
  await page.screenshot({ path: info.outputPath('profile-refresh-error.png'), fullPage: true })
  backend.setClientsFailure(false)
  await page.getByRole('button', { name: 'Повторить', exact: true }).first().click()
  await expect(save).toBeEnabled()
  await save.click()
  await expect.poll(() => backend.getSaveAttempts()).toBe(1)
  await expect(page.locator('.error').filter({ hasText: 'временно недоступен' }).first()).toBeVisible()
  const draftKey = 'fit.today-draft.' + pilotId + '.plan.client-access-probe'
  await expect.poll(() => page.evaluate(key => {
    const draft = JSON.parse(localStorage.getItem(key) ?? '{}') as { text?: string }
    return draft.text
  }, draftKey)).toBe(transcript)
  const retained = await page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? '{}') as { lastLlmText?: string; items?: { sets?: { weightKg?: number }[] }[] }, draftKey)
  expect(retained.lastLlmText).toBe(transcript)
  expect(retained.items?.[0]?.sets?.[0]?.weightKg).toBe(22.5)
  await page.reload()
  await expect(save).toBeEnabled()
  await page.getByRole('button', { name: '← К проверке', exact: true }).click()
  await expect(page.getByText('Приседание', { exact: true }).first()).toBeVisible()
  await page.getByRole('button', { name: 'Далее', exact: true }).click()
  await save.click()
  await expect.poll(() => backend.getSaveAttempts()).toBe(2)
  await expect(page).toHaveURL(new RegExp('/workouts/' + newWorkoutId))
  expect(backend.getWorkouts()[0]?.clientId).toBe(clientId)
  expect(await page.evaluate(key => localStorage.getItem(key), draftKey)).toBeNull()
  expect(await page.evaluate(id => localStorage.getItem('fit.today-draft.' + id + '.plan.client-independent'), pilotId)).not.toBeNull()
})

test('another client and a trainer never receive client editor geometry', async ({ page }) => {
  await mockPilot(page, { role: 'client', profileId: 'c11e0000-6010-4000-8000-000000000002', clientLime: true, workouts: [] })
  await page.goto('/workouts/new')
  await expect(page.locator('.workout-form')).toBeVisible()
  await expect(page.locator('.client-reference-form, .client-reference-flow')).toHaveCount(0)
  await mockPilot(page, { profileId: pilotId, fitLime: true, workouts: [] })
  await page.goto('/workouts/new')
  await expect(page.locator('.workout-form')).toBeVisible()
  await expect(page.locator('.client-reference-form, .client-reference-flow')).toHaveCount(0)
})


test('client reference cannot edit an assigned trainer plan', async ({ page }) => {
  const plan = coachGestureWorkout(); plan.status = 'planned'; plan.startedAt = null
  await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [plan] })
  await page.goto(`/workouts/${workoutId}/edit`)
  await expect(page.getByText('Редактирование недоступно', { exact: true })).toBeVisible()
  await expect(page.locator('.workout-form')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Сохранить план', exact: true })).toHaveCount(0)
})


async function openClientReferenceCatalog(page: Page) {
  await page.goto('/workouts/new')
  await page.getByRole('button', { name: /^Выбрать упражнения$/ }).click()
  return page.getByRole('dialog', { name: 'Добавить упражнение', exact: true })
}
// Reduced motion changes close ownership/timing; keyboard and real gestures
// are exercised once per mode, without multiplying by visual theme variants.
for (const reduced of [false, true]) test(`client Live catalogue header drag retains keyboard selection and nested screens reduced-${reduced}`, async ({ page, browserName }, info) => {
  await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' })
  await modelKeyboard(page)
  await page.clock.setFixedTime(new Date('2026-10-27T09:00:00Z'))
  const restUntil = String(Date.parse('2026-10-27T09:01:30Z'))
  await page.addInitScript(({ id, workoutId, restUntil }) => {
    localStorage.setItem(`fit.coachmarks-seen.${id}`, JSON.stringify(['client-live-reference-timer-2026-10', 'client-live-card-drag-2026-10', 'client-live-multiple-exercises-2026-10']))
    sessionStorage.setItem(`fit:live-rest-until:${workoutId}`, restUntil)
  }, { id: pilotId, workoutId, restUntil })
  const source = coachGestureWorkout(); source.startedAt = '2026-10-27T08:59:00Z'
  const backend = await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [source] })
  await page.goto(`/workouts/${workoutId}/live`)
  const trigger = page.locator('.live-add-exercise'), content = page.locator('.content')
  await trigger.scrollIntoViewIfNeeded(); await trigger.focus()
  const scroll = await content.evaluate(e => e.scrollTop)
  await trigger.click()
  const picker = page.locator('.exercise-picker'), title = picker.locator('.client-lime-sheet-header h1')
  await expect(page.locator('.client-live-v79-picker-overlay')).toBeVisible()
  await expect.poll(() => picker.evaluate(e => e.getAnimations().filter(a => a.playState === 'running').length)).toBe(0)
  const search = picker.getByLabel('Поиск упражнения', { exact: true })
  await search.fill('Жим'); await showModeledKeyboard(page)
  await picker.locator('.picker-select-mark').nth(0).click(); await picker.locator('.picker-select-mark').nth(1).click()
  await expect(picker.locator('.picker-item.selected')).toHaveCount(2)
  const top = (await picker.boundingBox())!.y
  const drag = async (distance: number, cancel = false) => {
    const gesture = await beginClientGesture(page, picker, browserName, title)
    await gesture.move(0, distance); await gesture.end(cancel)
  }
  await drag(32)
  await expect(picker).toBeVisible()
  await expect.poll(async () => Math.abs((await picker.boundingBox())!.y - top)).toBeLessThan(1)
  await drag(200, true)
  await expect(picker).toBeVisible()
  await expect.poll(async () => Math.abs((await picker.boundingBox())!.y - top)).toBeLessThan(1)
  await expect(search).toHaveValue('Жим')
  await expect(picker.locator('.picker-item.selected')).toHaveCount(2)
  await picker.getByRole('button', { name: /Фильтровать/ }).click()
  await drag(200)
  await expect(picker.getByRole('region', { name: 'Фильтры упражнений' })).toBeVisible()
  await picker.getByRole('button', { name: 'Показать упражнения', exact: true }).click()
  const technique = picker.locator('.picker-item-technique').first()
  await technique.click()
  if (!await picker.getByRole('heading', { name: 'Техника', exact: true }).count()) await technique.click()
  await expect(picker.getByRole('heading', { name: 'Техника', exact: true })).toBeVisible()
  await drag(200)
  await expect(picker.getByRole('heading', { name: 'Техника', exact: true })).toBeVisible()
  await picker.getByRole('button', { name: 'Назад к выбору', exact: true }).click()
  await picker.getByRole('button', { name: 'Создать упражнение', exact: true }).click()
  const name = picker.getByPlaceholder('Например: Болгарский присед')
  await name.fill('Черновик своего упражнения')
  await drag(200)
  await expect(name).toHaveValue('Черновик своего упражнения')
  await picker.getByRole('button', { name: 'Назад к упражнениям', exact: true }).click()
  await expect(search).toHaveValue('Жим')
  if (!reduced) await page.evaluate(() => {
    const overlay = document.querySelector<HTMLElement>('.client-live-v79-picker-overlay')!
    const observer = new MutationObserver(() => {
      if (!overlay.classList.contains('closing')) return
      const back = document.querySelector<HTMLElement>('.live-workout-page .page-back')!.getBoundingClientRect()
      const hit = document.elementFromPoint(back.x + back.width / 2, back.y + back.height / 2)
      ;(window as typeof window & { fitClosingShield?: { blocked: boolean; dialogInert: boolean; overlayInert: boolean } }).fitClosingShield = {
        blocked: Boolean(hit && overlay.contains(hit)), dialogInert: overlay.querySelector<HTMLElement>('.exercise-picker')!.inert, overlayInert: overlay.inert,
      }
      observer.disconnect()
    })
    observer.observe(overlay, { attributes: true, attributeFilter: ['class'] })
  })
  const gesture = await beginClientGesture(page, picker, browserName, title)
  await gesture.move(0, 200)
  await page.screenshot({ path: info.outputPath('catalogue-drag.png') })
  await gesture.end()
  await expect(picker).toHaveCount(0)
  if (!reduced) expect(await page.evaluate(() => (window as typeof window & { fitClosingShield?: object }).fitClosingShield)).toEqual({ blocked: true, dialogInert: true, overlayInert: false })
  await page.evaluate(() => { (window as typeof window & { fitTestKeyboardHeight?: number }).fitTestKeyboardHeight = innerHeight; visualViewport?.dispatchEvent(new Event('resize')) })
  await expect(page.locator('html')).not.toHaveClass(/app-keyboard-open/)
  await expect(trigger).toBeFocused()
  await expect.poll(async () => Math.abs(await content.evaluate(e => e.scrollTop) - scroll)).toBeLessThan(1)
  expect(backend.getAppendCommands()).toHaveLength(0)
  expect(backend.getWorkouts()[0]!.exercises).toHaveLength(3)
  expect(await page.evaluate(id => sessionStorage.getItem(`fit:live-rest-until:${id}`), workoutId)).toBe(restUntil)
  await trigger.click()
  await expect(picker.locator('.picker-item.selected')).toHaveCount(0)
  await expect(search).toHaveValue('')
  await picker.getByRole('button', { name: 'Закрыть', exact: true }).click()
  await expect(picker).toHaveCount(0)
  const menu = page.locator(`[data-workout-block="${source.exercises[0]!.blockId}"] .overflow-trigger`)
  await menu.click()
  await page.getByRole('menuitem', { name: 'Заменить', exact: true }).click()
  await expect(picker).toBeVisible()
  await expect.poll(() => picker.evaluate(e => e.getAnimations().filter(a => a.playState === 'running').length)).toBe(0)
  const replacementScroll = await content.evaluate(e => e.scrollTop)
  await drag(200)
  await expect(picker).toHaveCount(0)
  await expect(menu).toBeFocused()
  await expect.poll(async () => Math.abs(await content.evaluate(e => e.scrollTop) - replacementScroll)).toBeLessThan(1)
})

for (const theme of ['dark', 'light']) for (const width of [390, 430]) test(`client catalog reference geometry and retained filter search ${theme} ${width}`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 844 })
  await page.addInitScript(({ id, theme }) => { localStorage.setItem(`fit.clientLime.theme.${id}`, theme); localStorage.setItem(`fit.coachmarks-seen.${id}`, JSON.stringify(['client-live-reference-timer-2026-10'])) }, { id: pilotId, theme })
  await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [], withCustomExercise: true })
  const picker = await openClientReferenceCatalog(page)
  await expect(picker).toHaveClass(/client-reference-catalog/)
  const card = picker.locator('.picker-item').first()
  await expect(card).toHaveCSS('border-radius', '32px')
  await expect(card.locator('.picker-item-name')).toHaveCSS('font-family', /YS Geo/)
  expect(await page.evaluate(async () => { const faces = await document.fonts.load('16px "YS Geo"', 'Жим'); return faces.length > 0 && faces.every(face => face.status === 'loaded') })).toBe(true)
  await expect(card.locator('.picker-select-mark')).toHaveCSS('width', '44px')
  const preview = card.locator('.picker-item-technique')
  await preview.click()
  await expect(card).not.toHaveClass(/selected/)
  if (await card.locator('video').count()) await preview.click()
  else if (!await picker.getByRole('button', { name: 'Назад к выбору', exact: true }).count()) await preview.click()
  await expect(picker.getByRole('heading', { name: 'Техника', exact: true })).toBeVisible()
  await page.screenshot({ path: info.outputPath('technique.png') })
  await picker.getByRole('button', { name: 'Назад к выбору', exact: true }).click()
  await picker.getByLabel('Поиск упражнения', { exact: true }).fill('Жим')
  await picker.locator('.picker-select-mark').nth(0).click()
  await picker.locator('.picker-select-mark').nth(1).click()
  await expect(picker.locator('.picker-item.selected')).toHaveCount(2)
  await page.screenshot({ path: info.outputPath('catalog-selected.png') })
  await picker.getByRole('button', { name: /^Фильтровать/ }).click()
  const search = picker.getByLabel('Поиск упражнения', { exact: true })
  await expect(search).toBeVisible()
  await expect(search).toHaveValue('Жим')
  await search.fill('Присед')
  await picker.getByRole('group', { name: 'Группа мышц', exact: true }).getByRole('button', { name: 'Ноги', exact: true }).click()
  const equipment = picker.getByRole('combobox', { name: 'Оборудование', exact: true })
  await equipment.selectOption('Штанга')
  await equipment.scrollIntoViewIfNeeded()
  await expect(equipment).toBeInViewport()
  const apply = picker.getByRole('button', { name: 'Показать упражнения', exact: true })
  await apply.scrollIntoViewIfNeeded()
  await expect(apply).toBeInViewport()
  await page.screenshot({ path: info.outputPath('filters-bottom.png') })
  await apply.click()
  await expect(search).toHaveValue('Присед')
  const add = picker.getByRole('button', { name: /^Добавить.*2/ })
  await expect(add).toBeEnabled()
  const overflow = await picker.evaluate(el => el.scrollWidth - el.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
  await add.click()
  await expect(picker).toHaveCount(0)
  await expect(page.locator('.planned-exercise')).toHaveCount(2)
})

test('client catalog reference Live batch retry keeps idempotent commands and confirmed facts', async ({ page, browserName }) => {
  const original = restTimerWorkout()
  original.exercises[0]!.sets[0]!.confirmedAt = '2026-10-08T09:00:00Z'
  original.exercises[0]!.sets[0]!.fact = { weightKg: 40, reps: 12 }
  const backend = await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [original], failAppendAfterCommitAt: 2 })
  let releaseAppend: () => void = () => { throw new Error('Append gate was not initialized') }
  const appendGate = new Promise<void>(resolve => { releaseAppend = resolve })
  await page.route('**/v1/workouts/*/exercises', async route => {
    if (route.request().method() === 'POST') await appendGate
    return route.fallback()
  })
  await page.goto(`/workouts/${workoutId}/live`)
  await page.getByRole('button', { name: 'Ещё упражнение', exact: true }).click()
  const picker = page.getByRole('dialog', { name: 'Добавить упражнение', exact: true })
  await expect(picker).toHaveClass(/client-reference-catalog/)
  await expect(picker.locator('.coach-catalog-add')).toHaveCount(0)
  await expect(picker.getByRole('button', { name: 'Добавить выбранные упражнения', exact: true })).toBeDisabled()
  for (const name of ['Жим гантелей сидя', 'Планка', 'Присед со штангой']) {
    await picker.getByLabel('Поиск упражнения').fill(name)
    await picker.getByRole('button', { name: `Выбрать: ${name}`, exact: true }).click()
  }
  expect(backend.getAppendCommands()).toHaveLength(0)
  await picker.getByRole('button', { name: 'Добавить выбранные упражнения', exact: true }).click()
  try {
    await expect(picker.getByRole('button', { name: 'Закрыть', exact: true })).toBeDisabled()
    const gesture = await beginClientGesture(page, picker, browserName, picker.locator('.client-lime-sheet-header h1'))
    await gesture.move(0, 200); await gesture.end()
    await expect(picker).toBeVisible()
    await expect(page.locator('.client-live-v79-picker-overlay')).not.toHaveClass(/closing/)
    expect(backend.getAppendCommands()).toHaveLength(0)
  } finally { releaseAppend() }
  await expect(picker.getByRole('alert')).toContainText('повторите добавление остальных')
  await expect(picker.getByRole('button', { name: /^Добавить.*2/ })).toBeEnabled()
  const pending = backend.getAppendCommands()[1]
  await picker.getByRole('button', { name: /^Добавить.*2/ }).click()
  await expect(picker).toHaveCount(0)
  const commands = backend.getAppendCommands()
  expect(commands).toHaveLength(4)
  expect(commands[2]).toEqual(pending)
  expect(backend.getWorkouts()[0]!.exercises).toHaveLength(4)
  expect(backend.getWorkouts()[0]!.exercises[0]!.sets[0]).toMatchObject({ confirmedAt: '2026-10-08T09:00:00Z', fact: { weightKg: 40, reps: 12 } })
})

test('client catalog reference also applies in Today and does not reach another client', async ({ page }) => {
  await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [] })
  await page.goto('/me?entry=workout')
  await page.getByRole('button', { name: 'Выбрать упражнения вручную', exact: true }).click()
  await expect(page.locator('.client-reference-catalog')).toBeVisible()
  await expect(page.locator('.client-live-v79-picker-overlay')).toHaveCount(0)
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click()
  await mockPilot(page, { role: 'client', profileId: 'c11e0000-6010-4000-8000-000000000002', clientLime: true, workouts: [] })
  await openClientReferenceCatalog(page)
  await expect(page.locator('.client-reference-catalog')).toHaveCount(0)
  await expect(page.locator('.client-live-v79-picker-overlay')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Фильтры', exact: true })).toBeVisible()
})


for (const theme of ['dark', 'light']) test(`client catalog reference empty search and own exercise retry ${theme}`, async ({ page }, info) => {
  await page.addInitScript(({ id, theme }) => { localStorage.setItem(`fit.clientLime.theme.${id}`, theme); localStorage.setItem(`fit.coachmarks-seen.${id}`, JSON.stringify(['client-live-reference-timer-2026-10'])) }, { id: pilotId, theme })
  const backend = await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [], failFirstCustomExerciseSave: true })
  const picker = await openClientReferenceCatalog(page)
  await picker.getByLabel('Поиск упражнения').fill('Тестовое новое движение 641')
  await expect(picker.getByText('Ничего не найдено', { exact: true })).toBeVisible()
  await picker.getByRole('button', { name: 'Создать упражнение', exact: true }).click()
  await expect(picker.getByRole('heading', { name: 'Своё упражнение', exact: true })).toBeVisible()
  await picker.getByLabel('Название', { exact: true }).fill('Тестовое новое движение 641')
  await picker.locator('.picker-categories').getByRole('button', { name: 'Ноги', exact: true }).click()
  await picker.getByLabel('Описание', { exact: true }).fill('Проверка длинного описания и прокрутки формы. '.repeat(6))
  const save = picker.getByRole('button', { name: 'Сохранить упражнение', exact: true })
  await save.scrollIntoViewIfNeeded()
  await expect(save).toBeInViewport()
  await save.click()
  await expect.poll(() => backend.getCustomExerciseSaveAttempts()).toBe(1)
  await expect(picker.getByLabel('Название', { exact: true })).toHaveValue('Тестовое новое движение 641')
  await expect(picker.locator('.error')).toBeVisible()
  await page.screenshot({ path: info.outputPath('own-exercise-error.png') })
  await save.click()
  await expect.poll(() => backend.getCustomExerciseSaveAttempts()).toBe(2)
  await expect(picker.getByRole('heading', { name: 'Выберите упражнения', exact: true })).toBeVisible()
  await expect(picker.getByRole('button', { name: /^Добавить.*1/ })).toBeEnabled()
  await picker.getByRole('button', { name: /^Добавить.*1/ }).click()
  await expect(picker).toHaveCount(0)
  await expect(page.locator('.planned-exercise')).toHaveCount(1)
})


for (const theme of ['dark', 'light']) for (const width of [390, 430]) test(`client date reference retains cancel apply clear Enter and year rollover ${theme} ${width}`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 844 })
  await page.clock.setFixedTime(new Date('2026-12-20T09:00:00Z'))
  await page.addInitScript(({ id, theme }) => { localStorage.setItem(`fit.clientLime.theme.${id}`, theme); localStorage.setItem(`fit.coachmarks-seen.${id}`, JSON.stringify(['client-live-reference-timer-2026-10'])) }, { id: pilotId, theme })
  const plan = coachGestureWorkout()
  plan.status = 'planned'; plan.startedAt = null; plan.createdBy = pilotId; plan.workoutDate = '2026-12-20'; plan.startTime = '10:00'; plan.endTime = '11:00'
  await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [plan] })
  const writes: Array<{ workoutDate: string; startTime?: string | null; endTime?: string | null }> = []
  await page.route(`**/v1/workouts/${workoutId}`, route => { if (route.request().method() === 'PUT') writes.push(route.request().postDataJSON() as typeof writes[number]); return route.fallback() })
  await page.goto(`/workouts/${workoutId}/edit`)
  const trigger = page.getByRole('button', { name: 'Выбрать дату и время', exact: true })
  await expect(trigger).toContainText('10:00')
  const before = await trigger.innerText()
  await trigger.click()
  const dialog = page.getByRole('dialog', { name: 'Дата и время', exact: true })
  const selected = dialog.locator('.fit-lime-month-grid button[aria-pressed=true]')
  await expect(selected).toHaveAttribute('aria-current', 'date')
  const marker = selected.locator('.lime-calendar-day-marker')
  await expect(marker).toHaveCSS('width', '36px')
  await expect(marker).toHaveCSS('height', '36px')
  await expect(marker).toHaveCSS('border-radius', '50%')
  expect((await selected.boundingBox())!.width).toBeGreaterThanOrEqual(44)
  await expect(dialog.getByLabel('Начало', { exact: true })).toHaveCSS('min-height', '48px')
  await expect(dialog.getByLabel('Начало', { exact: true })).toHaveCSS('border-radius', '16px')
  await expect(dialog.getByRole('heading', { name: 'Дата и время', exact: true })).toHaveCSS('font-family', /YS Geo/)
  expect(await page.evaluate(async () => { const faces = await document.fonts.load('16px "YS Geo"', 'Дата'); return faces.length > 0 && faces.every(face => face.status === 'loaded') })).toBe(true)
  await page.screenshot({ path: info.outputPath('date-window.png') })
  await dialog.getByRole('button', { name: '21 декабря 2026 г.', exact: true }).click()
  await dialog.getByLabel('Начало', { exact: true }).fill('12:30')
  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
  await expect(trigger).toHaveText(before, { useInnerText: true })
  await expect(trigger).toBeFocused()
  await trigger.click()
  await expect(selected).toHaveAttribute('aria-label', '20 декабря 2026 г.')
  await expect(dialog.getByLabel('Начало', { exact: true })).toHaveValue('10:00')
  await dialog.getByRole('button', { name: 'Следующий месяц', exact: true }).click()
  await dialog.getByRole('button', { name: '1 января 2027 г.', exact: true }).click()
  await dialog.getByLabel('Начало', { exact: true }).fill('23:30')
  await dialog.getByLabel('Окончание', { exact: true }).fill('00:15')
  await dialog.getByLabel('Окончание', { exact: true }).press('Enter')
  await expect(dialog).toBeVisible()
  expect(writes).toHaveLength(0)
  await dialog.getByRole('button', { name: 'Применить дату', exact: true }).click()
  await expect(trigger).toContainText('1 января 2027 г.')
  await expect(trigger).toContainText('23:30')
  await expect(trigger).toContainText('00:15')
  await trigger.click()
  await dialog.getByLabel('Начало', { exact: true }).fill('')
  await dialog.getByLabel('Окончание', { exact: true }).fill('')
  await dialog.getByRole('button', { name: 'Применить дату', exact: true }).click()
  await expect(trigger).toContainText('Без времени')
  await page.getByRole('button', { name: 'Сохранить план', exact: true }).click()
  await expect.poll(() => writes.length).toBe(1)
  expect(writes[0]!.workoutDate).toBe('2027-01-01')
  expect(writes[0]!.startTime ?? null).toBeNull()
  expect(writes[0]!.endTime ?? null).toBeNull()
})

test('client date reference preserves parent validation and midnight duration', async ({ page }) => {
  const plan = coachGestureWorkout()
  plan.status = 'planned'; plan.startedAt = null; plan.createdBy = pilotId; plan.startTime = null; plan.endTime = '11:00'
  await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [plan] })
  const writes: Array<{ startTime?: string; endTime?: string }> = []
  await page.route(`**/v1/workouts/${workoutId}`, route => { if (route.request().method() === 'PUT') writes.push(route.request().postDataJSON() as typeof writes[number]); return route.fallback() })
  await page.goto(`/workouts/${workoutId}/edit`)
  await expect(page.getByRole('button', { name: 'Выбрать дату и время', exact: true })).toContainText('11:00')
  await page.getByRole('button', { name: 'Сохранить план', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Укажите время начала тренировки')
  expect(writes).toHaveLength(0)
  await page.getByRole('button', { name: 'Выбрать дату и время', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Дата и время', exact: true })
  await dialog.getByLabel('Начало', { exact: true }).fill('23:30')
  await dialog.getByLabel('Окончание', { exact: true }).fill('00:15')
  await dialog.getByRole('button', { name: 'Применить дату', exact: true }).click()
  await page.getByRole('button', { name: 'Сохранить план', exact: true }).click()
  await expect.poll(() => writes.length).toBe(1)
  expect(writes[0]).toMatchObject({ startTime: '23:30', endTime: '00:15' })
})

for (const mode of ['planned', 'completed']) test(`client date reference Today save keeps date and start across back ${mode}`, async ({ page }) => {
  const backend = await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [] })
  await page.goto('/me?entry=workout')
  await page.getByLabel('Тренировка', { exact: true }).fill('Жим лёжа один подход десять повторений 40 кг')
  await page.getByRole('button', { name: 'Разобрать тренировку', exact: true }).click()
  await page.getByRole('button', { name: 'Далее', exact: true }).click()
  if (mode === 'completed') await page.getByRole('button', { name: 'Записать выполненную', exact: true }).click()
  const trigger = page.getByRole('button', { name: 'Выбрать дату и время', exact: true })
  await trigger.click()
  const dialog = page.getByRole('dialog', { name: 'Дата и время', exact: true })
  const start = dialog.getByLabel(mode === 'planned' ? 'Время' : 'Время начала', { exact: true })
  await start.fill('12:30')
  await dialog.getByRole('button', { name: 'Применить дату', exact: true }).click()
  const value = await trigger.innerText()
  await page.getByRole('button', { name: '← К проверке', exact: true }).click()
  await page.getByRole('button', { name: 'Далее', exact: true }).click()
  await expect(trigger).toHaveText(value, { useInnerText: true })
  if (mode === 'completed') await page.getByLabel('Длительность тренировки, мин', { exact: true }).fill('45')
  await page.getByRole('button', { name: mode === 'planned' ? 'Запланировать тренировку' : 'Записать тренировку', exact: true }).click()
  await expect.poll(() => backend.getSaveAttempts()).toBe(1)
  expect(backend.getWorkouts()[0]!.startTime).toBe('12:30')
})


// Short visual fixtures cover state, theme and density without repeating the
// editing flow. Widths cover the two approved phone grids.
for (const theme of ['light', 'dark']) for (const density of ['original', 'compact']) test(`client lower tools source geometry ${theme} ${density}`, async ({ page }, info) => {
  await page.addInitScript(({ id, theme, density }) => {
    localStorage.setItem(`fit.clientLime.theme.${id}`, theme); localStorage.setItem(`fit.clientLiveDensity.${id}`, density)
    localStorage.setItem(`fit.coachmarks-seen.${id}`, JSON.stringify(['client-live-reference-timer-2026-10', 'client-live-card-drag-2026-10']))
  }, { id: pilotId, theme, density })
  const source = coachGestureWorkout(); source.startedAt = new Date(Date.now() - 60000).toISOString()
  source.exercises[0]!.trainerComment = 'Сохраняйте темп движения'
  source.exercises[1]!.clientNote = 'Моя сохранённая заметка'
  source.exercises[2]!.clientNote = 'Длинная личная заметка '.repeat(30)
  for (const set of source.exercises[1]!.sets) { set.confirmedAt = new Date().toISOString(); set.fact = { weightKg: 20, reps: 10 } }
  await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [source] })
  await page.goto(`/workouts/${workoutId}/live`)
  for (const exercise of source.exercises.slice(1)) await page.getByRole('button', { name: `Развернуть: ${exercise.name}`, exact: true }).click()
  const cards = page.locator('.client-live-card'), footer = cards.first().locator('.live-exercise-utilities'), note = footer.locator('.live-exercise-note')
  for (const width of [390, 430]) {
    await page.setViewportSize({ width, height: 844 })
    const facts = await page.locator('.live-exercise-utilities').evaluateAll(elements => elements.map(e => {
      const summary = e.querySelector('summary')!, add = e.querySelector('.live-add-set')!, details = e.querySelector('details')!
      const n = summary.getBoundingClientRect(), a = add.getBoundingClientRect(), style = getComputedStyle(summary), button = getComputedStyle(add)
      return { height: n.height, width: n.width, addHeight: a.height, addWidth: a.width, sameY: Math.abs(n.y - a.y) < 1, separated: n.right <= a.x,
        font: style.fontFamily, weight: style.fontWeight, addWeight: button.fontWeight, color: style.color, addColor: button.color, background: getComputedStyle(e.closest('.client-live-card')!).backgroundColor, filled: details.hasAttribute('data-has-note') }
    }))
    expect(facts).toHaveLength(3)
    for (const fact of facts) {
      expect(fact.height).toBe(44); expect(fact.addHeight).toBe(44)
      expect(Math.min(fact.width, fact.addWidth)).toBeGreaterThanOrEqual(44)
      expect(fact.sameY).toBe(true); expect(fact.separated).toBe(true)
      expect(fact.font).toMatch(/YS Geo/); expect(fact.weight).toBe('400'); expect(fact.addWeight).toBe('400')
      expect(liveContrast(fact.color, fact.background)).toBeGreaterThanOrEqual(4.5)
    }
    expect(facts[0]!.color).toBe(facts[0]!.addColor)
    expect(facts[1]!.color).not.toBe(facts[1]!.addColor)
    expect(facts[2]!.filled).toBe(true)
    const emptyColor = facts[0]!.color
    await note.locator('summary').click()
    await expect(note).toHaveAttribute('open', '')
    await expect(note.locator('summary')).toHaveCSS('color', emptyColor)
    await expect(note.locator('textarea')).toHaveValue('')
    await expect(footer.locator('.live-add-set')).toHaveCSS('height', '44px')
    await cards.first().screenshot({ path: info.outputPath(`footer-${width}.png`) })
    await note.locator('summary').click()
    await expect(cards.first().locator('.live-trainer-note summary')).toContainText('От тренера')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
  await expect(page.locator('.live-add-exercise')).toHaveCSS('min-height', density === 'original' ? '60px' : '48px')
})

// Note focus and row insertion depend on field density; themes use the visual fixture above.
for (const density of ['original', 'compact']) test(`client lower tools retain note retry confirmed facts and keyboard ${density}`, async ({ page }, info) => {
  await modelKeyboard(page)
  await page.clock.setFixedTime(new Date('2026-10-27T09:00:00Z'))
  const restUntil = String(Date.parse('2026-10-27T09:00:47Z'))
  await page.addInitScript(({ id, density, workoutId, restUntil }) => {
    localStorage.setItem(`fit.clientLiveDensity.${id}`, density)
    localStorage.setItem(`fit.coachmarks-seen.${id}`, JSON.stringify(['client-live-reference-timer-2026-10', 'client-live-card-drag-2026-10']))
    sessionStorage.setItem(`fit:live-rest-until:${workoutId}`, restUntil)
  }, { id: pilotId, density, workoutId, restUntil })
  const source = coachGestureWorkout(false, 1), original = source.exercises[0]!
  source.startedAt = '2026-10-27T08:59:00Z'; original.trainerComment = 'Комментарий тренера сохраняется отдельно'
  original.sets[0]!.confirmedAt = '2026-10-27T08:59:30Z'; original.sets[0]!.fact = { weightKg: 20, reps: 10 }
  const backend = await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [source] })
  let noteAttempts = 0
  await page.route('**/v1/workout-exercises/*/comment', async route => {
    noteAttempts += 1
    if (noteAttempts === 1) { await route.fulfill({ status: 503, json: { error: 'unavailable' } }); return }
    const workout = backend.getWorkouts()[0]!, target = workout.exercises[0]!
    target.clientNote = (route.request().postDataJSON() as { comment: string }).comment; workout.version += 1
    await route.fulfill({ json: { workout: { version: workout.version } } })
  })
  await page.route('**/v1/workout-exercises/*/sets', async route => {
    const workout = backend.getWorkouts()[0]!, target = workout.exercises[0]!
    expect((route.request().postDataJSON() as { expectedVersion: number }).expectedVersion).toBe(workout.version)
    target.sets.push({ ...target.sets.at(-1)!, id: 'c11e0000-6010-4000-8000-000000000999', position: target.sets.length, fact: {}, confirmedAt: null })
    workout.version += 1; await route.fulfill({ json: { workout: { version: workout.version } } })
  })
  await page.goto(`/workouts/${workoutId}/live`)
  const row = page.locator('form[data-live-set-id]').first(), weight = row.getByLabel('Фактический вес', { exact: true }), input = await weight.elementHandle()
  await weight.fill('24.5'); await weight.blur()
  await expect.poll(() => backend.getWorkouts()[0]!.exercises[0]!.sets[0]!.fact.weightKg).toBe(24.5)
  await expect(row).toHaveClass(/confirmed/)
  const note = page.locator('.live-exercise-note'), summary = note.locator('summary'), textarea = note.locator('textarea')
  await summary.click(); await textarea.fill('Сохранить личную заметку без потери результата'); await textarea.blur()
  await expect(page.getByRole('button', { name: 'Повторить сохранение заметки', exact: true })).toBeVisible()
  await expect(textarea).toHaveValue('Сохранить личную заметку без потери результата')
  await page.getByRole('button', { name: 'Повторить сохранение заметки', exact: true }).click()
  await expect(note).toHaveAttribute('data-has-note', 'true')
  expect(noteAttempts).toBe(2)
  const textNode = await textarea.elementHandle(), add = page.locator('.live-add-set')
  await expect(add).toBeEnabled()
  await textarea.focus(); await showModeledKeyboard(page)
  await tapVisible(page, add)
  await expect.poll(() => backend.getWorkouts()[0]!.exercises[0]!.sets.length).toBe(3)
  await expect(page.locator('form[data-live-set-id]').last().getByLabel('Фактический вес', { exact: true })).toHaveCSS('height', density === 'original' ? '54px' : '48px')
  expect(await input!.evaluate(e => e.isConnected)).toBe(true); expect(await textNode!.evaluate(e => e.isConnected)).toBe(true)
  await expect(weight).toHaveValue('24.5'); await expect(row).toHaveClass(/confirmed/)
  await expect(textarea).toHaveValue('Сохранить личную заметку без потери результата')
  expect(backend.getWorkouts()[0]!.exercises[0]!.trainerComment).toBe('Комментарий тренера сохраняется отдельно')
  expect(await page.evaluate(id => sessionStorage.getItem(`fit:live-rest-until:${id}`), workoutId)).toBe(restUntil)
  await page.screenshot({ path: info.outputPath('footer-keyboard.png') })
})

// The two states exercise the existing replacement confirmation, not visual variants.
for (const started of [false, true]) test(`client replacement rail preserves cancel error and request started-${started}`, async ({ page, browserName }, info) => {
  await page.clock.setFixedTime(new Date('2026-10-27T09:00:00Z'))
  const restUntil = String(Date.parse('2026-10-27T09:01:30Z'))
  await page.addInitScript(({ workoutId, restUntil }) => sessionStorage.setItem(`fit:live-rest-until:${workoutId}`, restUntil), { workoutId, restUntil })
  await page.addInitScript(id => localStorage.setItem(`fit.coachmarks-seen.${id}`, JSON.stringify(['client-live-reference-timer-2026-10', 'client-live-card-drag-2026-10'])), pilotId)
  const source = coachGestureWorkout(), original = source.exercises[0]!
  source.startedAt = '2026-10-27T08:59:00Z'
  if (started) { original.sets[0]!.confirmedAt = new Date().toISOString(); original.sets[0]!.fact = { weightKg: 20, reps: 10 } }
  const backend = await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [source] })
  const requests: Array<{ exercise: { source: typeof original.source; ref: string; name: string; muscleGroup: typeof original.muscleGroup; inputKind: typeof original.inputKind }; expectedVersion: number }> = []
  await page.route(`**/v1/workouts/${workoutId}/exercises/${original.id}`, async route => {
    if (route.request().method() !== 'PUT') return route.fallback()
    const command = route.request().postDataJSON() as typeof requests[number]
    requests.push(command)
    if (requests.length === 1) { await route.fulfill({ status: 503, json: { error: 'unavailable' } }); return }
    // Return the already-covered API split outcome; this test verifies the new entry point.
    const workout = backend.getWorkouts()[0]!, target = workout.exercises.find(e => e.id === original.id)!
    const next = { ...target, ...command.exercise, id: 'a0000000-0000-4000-8000-000000000099', blockId: 'a0000000-0000-4000-8000-000000000099', sets: target.sets.filter(set => !set.confirmedAt).map(set => ({ ...set, fact: {} })) }
    if (started) { target.sets = target.sets.filter(set => set.confirmedAt); workout.exercises.splice(1, 0, next) }
    else Object.assign(target, command.exercise, { sets: target.sets.map(set => ({ ...set, fact: {} })) })
    workout.version += 1
    await route.fulfill({ json: { workout: { version: workout.version } } })
  })
  await page.goto(`/workouts/${workoutId}/live`)
  const outer = page.locator(`[data-workout-swipe="${original.id}"]`), title = outer.locator('.live-exercise-head h2')
  const field = outer.getByLabel('Фактический вес', { exact: true }).last()
  await field.fill('31.5'); await field.blur()
  await expect.poll(() => backend.getWorkouts()[0]!.exercises[0]!.sets.at(-1)!.fact.weightKg).toBe(31.5)
  const preserved = structuredClone(backend.getWorkouts()[0]!.exercises[0]!)
  const expectedVersion = backend.getWorkouts()[0]!.version
  const reveal = async () => { const gesture = await beginClientGesture(page, title, browserName); await gesture.move(-85); await gesture.end(); await expect(outer.getByRole('button', { name: 'Заменить', exact: true })).toBeVisible() }
  await reveal()
  expect(requests).toHaveLength(0)
  await page.screenshot({ path: info.outputPath('replacement-rail.png') })
  await outer.getByRole('button', { name: 'Заменить', exact: true }).click()
  const picker = page.locator('.exercise-picker')
  await expect(picker).toBeVisible()
  await picker.getByRole('button', { name: 'Закрыть', exact: true }).click()
  await expect(picker).toHaveCount(0)
  expect(backend.getWorkouts()[0]!.exercises[0]).toEqual(preserved)
  expect(requests).toHaveLength(0)
  const choose = async () => {
    await reveal(); await outer.getByRole('button', { name: 'Заменить', exact: true }).click()
    await picker.getByLabel('Поиск упражнения', { exact: true }).fill('Жим')
    await picker.locator('.picker-select-mark').first().click()
  }
  expect(await page.evaluate(id => sessionStorage.getItem(`fit:live-rest-until:${id}`), workoutId)).toBe(restUntil)
  if (started) {
    await choose()
    const confirm = page.getByRole('alertdialog')
    await expect(confirm).toContainText('в истории')
    await confirm.getByRole('button', { name: 'Отмена', exact: true }).click()
    expect(requests).toHaveLength(0)
    expect(backend.getWorkouts()[0]!.exercises[0]).toEqual(preserved)
  }
  await choose()
  if (started) await page.getByRole('alertdialog').getByRole('button', { name: 'Заменить', exact: true }).click()
  await expect.poll(() => requests.length).toBe(1)
  await expect(page.locator('.live-workout-page > p.error')).toBeVisible()
  expect(backend.getWorkouts()[0]!.exercises[0]).toEqual(preserved)
  expect(await page.evaluate(id => sessionStorage.getItem(`fit:live-rest-until:${id}`), workoutId)).toBe(restUntil)
  await choose()
  if (started) await page.getByRole('alertdialog').getByRole('button', { name: 'Заменить', exact: true }).click()
  await expect.poll(() => requests.length).toBe(2)
  expect(requests[1]!.exercise).toEqual(requests[0]!.exercise)
  expect(requests[1]!.expectedVersion).toBe(expectedVersion)
  await expect(page.locator('.live-workout-page > p.error')).toHaveCount(0)
  if (started) {
    await expect.poll(() => backend.getWorkouts()[0]!.exercises[0]!.sets.length).toBe(1)
    expect(backend.getWorkouts()[0]!.exercises[0]!.sets[0]).toEqual(preserved.sets[0])
    await expect(page.locator('.workout-exercise-compact').first()).toContainText(preserved.name)
  } else await expect(title).not.toHaveText(preserved.name)
})

// Only the revealed rail is repeated for light/dark and field-density geometry.
for (const theme of ['light', 'dark']) test(`client replacement rail Lime visual ${theme}`, async ({ page, browserName }, info) => {
  await page.addInitScript(({ id, theme }) => { localStorage.setItem(`fit.clientLime.theme.${id}`, theme); localStorage.setItem(`fit.coachmarks-seen.${id}`, JSON.stringify(['client-live-reference-timer-2026-10', 'client-live-card-drag-2026-10'])) }, { id: pilotId, theme })
  await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [coachGestureWorkout()] })
  await page.goto(`/workouts/${workoutId}/live`)
  for (const density of ['original', 'compact']) {
    await page.evaluate(({ id, density }) => localStorage.setItem(`fit.clientLiveDensity.${id}`, density), { id: pilotId, density })
    await page.goto(`/workouts/${workoutId}/live`)
    const outer = page.locator('[data-workout-swipe]').filter({ has: page.locator('.client-live-card') }).first()
    const gesture = await beginClientGesture(page, outer.locator('.live-exercise-head h2'), browserName); await gesture.move(-85); await gesture.end()
    const rail = outer.locator('.workout-swipe-action.replace')
    await expect(rail).toBeVisible()
    const colors = await rail.evaluate(e => ({ fg: getComputedStyle(e).color, bg: getComputedStyle(e).backgroundColor }))
    expect(liveContrast(colors.fg, colors.bg)).toBeGreaterThanOrEqual(4.5)
    for (const width of [390, 430]) {
      await page.setViewportSize({ width, height: 844 })
      expect((await rail.boundingBox())!.width).toBeGreaterThanOrEqual(44)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: info.outputPath(`rail-${density}-${width}.png`) })
    }
  }
})

for (const theme of ['light', 'dark']) for (const density of ['original', 'compact']) test(`client swipe set cancel delete protects facts ${theme} ${density}`, async ({ page, browserName }, info) => {
  await page.addInitScript(({ id, theme, density }) => {
    localStorage.setItem(`fit.clientLime.theme.${id}`, theme)
    localStorage.setItem(`fit.clientLiveDensity.${id}`, density)
  }, { id: pilotId, theme, density })
  const source = restTimerWorkout(), exercise = source.exercises[0]!
  source.startedAt = new Date(Date.now() - 120000).toISOString()
  exercise.sets[0]!.confirmedAt = new Date().toISOString()
  exercise.sets[0]!.fact = { weightKg: 30, reps: 10 }
  const backend = await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [source] })
  let attempts = 0
  await page.route('**/v1/workout-sets/*', route => { if (route.request().method() === 'DELETE') attempts += 1; return route.fallback() })
  await page.goto(`/workouts/${workoutId}/live`)
  const first = page.locator(`form[data-live-set-id="${exercise.sets[0]!.id}"]`)
  const second = page.locator(`form[data-live-set-id="${exercise.sets[1]!.id}"]`)
  const gesture = await beginClientGesture(page, second, browserName, second.getByLabel('Фактический вес', { exact: true }))
  await gesture.move(60); await gesture.end()
  const remove = second.getByRole('button', { name: /Удалить подход 2:/ })
  await expect(remove).toBeVisible()
  await expect(second.getByLabel('Фактический вес', { exact: true })).not.toBeFocused()
  await expect(first.locator('.workout-swipe-action')).toBeHidden()
  await remove.click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Отмена', exact: true }).click()
  expect(attempts).toBe(0)
  const again = await beginClientGesture(page, second, browserName, second.locator('.live-set-number'))
  await again.move(36); await again.end()
  await remove.click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Удалить', exact: true }).click()
  await expect(second).toHaveCount(0)
  expect(attempts).toBe(1)
  expect(backend.getWorkouts()[0]!.exercises[0]!.sets).toHaveLength(1)
  await page.locator('.workout-exercise-compact').click()
  await expect(first.getByLabel('Фактический вес', { exact: true })).toHaveValue('30')
  const protectedGesture = await beginClientGesture(page, first, browserName, first.locator('.live-set-number'))
  await protectedGesture.move(36); await protectedGesture.end()
  await expect(first.locator('.workout-swipe-action')).toHaveCount(0)
  await first.getByLabel('Фактический вес', { exact: true }).fill('32')
  await first.getByLabel('Фактический вес', { exact: true }).blur()
  await expect.poll(() => backend.getWorkouts()[0]!.exercises[0]!.sets[0]!.fact.weightKg).toBe(32)
  await expect(first).toHaveClass(/confirmed/)
  await page.screenshot({ path: info.outputPath('client-set-swipe.png') })
})

for (const withTrainer of [true, false]) for (const animation of [true, false]) test(`client swipe exercise preserves unrelated rest trainer-${withTrainer} animation-${animation}`, async ({ page, browserName }, info) => {
  await page.addInitScript(({ id, animation }) => localStorage.setItem(`fit.liveExerciseAnimation.${id}`, String(animation)), { id: pilotId, animation })
  const source = coachGestureWorkout()
  source.startedAt = new Date(Date.now() - 120000).toISOString()
  if (!withTrainer) { source.trainerId = pilotId; source.createdBy = pilotId; source.trainingFormat = 'self' }
  const exercise = source.exercises[0]!, target = source.exercises[1]!
  const backend = await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [source], ...(withTrainer ? {} : { clientTrainerId: pilotId }) })
  let attempts = 0
  await page.route('**/v1/workouts/*/exercises/*', async route => {
    if (route.request().method() !== 'DELETE') return route.fallback()
    attempts += 1
    const current = backend.getWorkouts()[0]!
    current.exercises = current.exercises.filter(item => item.id !== target.id).map((item, position) => ({ ...item, position }))
    current.version += 1
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ workout: { version: current.version } }) })
  })
  await page.route('**/v1/workout-sets/*/draft', async route => {
    await new Promise(resolve => setTimeout(resolve, 250))
    await route.fallback()
  })
  await page.goto(`/workouts/${workoutId}/live`)
  const first = page.locator(`form[data-live-set-id="${exercise.sets[0]!.id}"]`)
  await first.getByLabel('Фактический вес', { exact: true }).fill('27.5')
  await first.getByRole('button', { name: 'Готово, отдых', exact: true }).click()
  await expect(first).toHaveClass(/confirmed/)
  await expect(page.locator('.live-rest-trigger').and(page.getByRole('button'))).toHaveAttribute('aria-label', /отдыха/)
  // An unsaved field must not blur-disable the already enabled rail between
  // pointerdown and click. Opening confirmation may blur; deleting waits for it.
  const editedWeight = page.locator(`form[data-live-set-id="${exercise.sets[1]!.id}"]`).getByLabel('Фактический вес', { exact: true })
  await editedWeight.fill('31')
  const card = page.locator(`[data-workout-block="${target.blockId}"]`)
  const title = page.getByRole('heading', { name: target.name, exact: true })
  // The heading is a button in the client composition; short taps and full-card
  // holds remain available while a horizontal gesture can reveal deletion.
  const surface = page.locator('[data-workout-swipe]').filter({ has: title }).first()
  await expect.poll(() => backend.getWorkouts()[0]!.exercises[0]!.sets[1]!.fact.weightKg).toBe(31)
  await expect(card).toHaveAttribute('data-card-drag', 'true')
  const gesture = await beginClientGesture(page, surface, browserName, title)
  await gesture.move(100)
  // Start with the save guard idle. Finish typing while the rail is being
  // revealed: the 650ms autosave must not race the gesture setup itself.
  await expect(editedWeight).toBeFocused()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.insertText('32')
  await gesture.end()
  const remove = surface.getByRole('button', { name: 'Удалить', exact: true })
  await expect(remove).toBeVisible()
  expect(backend.getWorkouts()[0]!.exercises[0]!.sets[1]!.fact.weightKg).toBe(31)
  await remove.click()
  await expect(page.getByRole('alertdialog')).toContainText('включая выполненные')
  await page.getByRole('alertdialog').getByRole('button', { name: 'Отмена', exact: true }).click()
  expect(attempts).toBe(0)
  await expect.poll(() => backend.getWorkouts()[0]!.exercises[0]!.sets[1]!.fact.weightKg).toBe(32)
  const again = await beginClientGesture(page, surface, browserName, title)
  await again.move(100); await again.end()
  await remove.click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Удалить', exact: true }).click()
  await expect(title).toHaveCount(0)
  expect(attempts).toBe(1)
  expect(backend.getWorkouts()[0]!.exercises.map(item => item.name)).toEqual([source.exercises[0]!.name, source.exercises[2]!.name])
  expect(backend.getWorkouts()[0]!.exercises[0]!.sets[0]!.fact.weightKg).toBe(27.5)
  expect(backend.getWorkouts()[0]!.exercises[0]!.sets[1]!.fact.weightKg).toBe(32)
  await expect(page.locator('.live-rest-trigger').and(page.getByRole('button'))).toHaveAttribute('aria-label', /отдыха/)
  await expect(first).toHaveClass(/confirmed/)
  await expect(card).toHaveCount(0)
  await page.screenshot({ path: info.outputPath('client-exercise-swipe.png') })
})

for (const conflict of [false, true]) test(`client swipe retry protects concurrent result conflict-${conflict}`, async ({ page, browserName }) => {
  const source = restTimerWorkout(), target = source.exercises[0]!.sets[1]!
  source.startedAt = new Date(Date.now() - 120000).toISOString()
  const backend = await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [source] })
  let attempts = 0
  await page.route('**/v1/workout-sets/*', async route => {
    if (route.request().method() !== 'DELETE') return route.fallback()
    attempts += 1
    if (conflict) {
      const current = backend.getWorkouts()[0]!, set = current.exercises[0]!.sets[1]!
      current.version += 1; set.version += 1; set.confirmedAt = new Date().toISOString(); set.fact = { weightKg: 42.5, reps: 8 }
      return route.fulfill({ status: 409, json: { error: 'workout_conflict' } })
    }
    if (attempts === 1) return route.fulfill({ status: 503, json: { error: 'unavailable' } })
    return route.fallback()
  })
  await page.goto(`/workouts/${workoutId}/live`)
  const row = page.locator(`form[data-live-set-id="${target.id}"]`)
  const gesture = await beginClientGesture(page, row, browserName, row.getByLabel('Фактический вес', { exact: true }))
  await gesture.move(60); await gesture.end()
  await row.getByRole('button', { name: /Удалить подход 2:/ }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Удалить', exact: true }).click()
  const retry = page.getByRole('button', { name: 'Повторить удаление подхода', exact: true })
  if (conflict) {
    await expect(row).toHaveClass(/confirmed/)
    await expect(retry).toBeDisabled()
    await expect(row.getByLabel('Фактический вес', { exact: true })).toHaveValue('42.5')
    expect(attempts).toBe(1)
  } else {
    await expect(retry).toBeEnabled()
    await retry.click()
    await expect(row).toHaveCount(0)
    expect(attempts).toBe(2)
    expect(backend.getWorkouts()[0]!.exercises[0]!.sets).toHaveLength(1)
  }
})

test('client compact card trusted tap swipe and full-card hold remain distinct', async ({ page, browserName }) => {
  const source = coachGestureWorkout(), target = source.exercises[1]!
  source.startedAt = new Date(Date.now() - 120000).toISOString()
  target.sets.forEach(set => { set.confirmedAt = new Date().toISOString(); set.fact = { weightKg: 25, reps: 10 } })
  await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [source] })
  await page.goto(`/workouts/${workoutId}/live`)
  const card = page.locator(`[data-workout-block="${target.blockId}"]`)
  const compact = card.locator('.workout-exercise-compact')
  await compact.tap()
  await expect(card.locator('form[data-live-set-id]')).toHaveCount(2)
  // Reload returns to the saved completed-card representation.
  await page.reload()
  const gesture = await beginClientGesture(page, card, browserName, compact)
  await gesture.move(100); await gesture.end()
  await expect(card.getByRole('button', { name: 'Удалить', exact: true })).toBeVisible()
  await expect(card.locator('form[data-live-set-id]')).toHaveCount(0)
  await card.getByRole('button', { name: 'Удалить', exact: true }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Отмена', exact: true }).click()
  await holdClientLiveCard(page, target.blockId)
  await page.keyboard.press('Escape')
  await page.mouse.up()
  await expect(card).not.toHaveClass(/dragging/)
  await expect(compact).toBeVisible()
})

test('client swipe last added superset round uses existing atomic removal', async ({ page, browserName }) => {
  const source = coachGestureWorkout(true, 2), first = source.exercises[0]!
  source.startedAt = new Date(Date.now() - 120000).toISOString()
  const backend = await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [source] })
  const commands: string[] = []
  await page.route('**/blocks/*/rounds', async route => {
    const current = backend.getWorkouts()[0]!
    expect(route.request().method()).toBe('POST')
    expect(route.request().postDataJSON()).toMatchObject({ expectedVersion: current.version })
    current.exercises.forEach((exercise, index) => { exercise.sets.push({ ...exercise.sets.at(-1)!, id: `c11e0000-6010-4000-8000-0000000008${index}2`, position: 2, fact: {}, confirmedAt: null }); exercise.blockRounds = 3 })
    current.version += 1; commands.push('append')
    await route.fulfill({ json: { block: { id: first.blockId, version: current.version, replayed: false } } })
  })
  await page.route('**/blocks/*/rounds/2', async route => {
    const current = backend.getWorkouts()[0]!
    expect(route.request().method()).toBe('DELETE')
    expect(route.request().postDataJSON()).toMatchObject({ expectedVersion: current.version })
    expect(current.exercises.every(exercise => exercise.sets.at(-1)?.position === 2 && !exercise.sets.at(-1)?.confirmedAt && Object.keys(exercise.sets.at(-1)!.fact).length === 0)).toBe(true)
    current.exercises.forEach(exercise => { exercise.sets = exercise.sets.filter(set => set.position !== 2); exercise.blockRounds = 2 })
    current.version += 1; commands.push('remove')
    await route.fulfill({ json: { block: { id: first.blockId, version: current.version, replayed: false } } })
  })
  await page.goto(`/workouts/${workoutId}/live`)
  const group = page.locator('.exercise-block.live')
  await group.getByRole('button', { name: 'Добавить круг', exact: true }).click()
  await expect(group.locator('.circuit-round')).toHaveCount(3)
  const round = group.locator('.circuit-round').last()
  await round.getByRole('button', { name: /Круг 3/ }).click()
  const row = round.locator('[data-live-set-id]').first()
  const swipe = async () => { const gesture = await beginClientGesture(page, row, browserName, row.getByLabel('Фактический вес', { exact: true })); await gesture.move(60); await gesture.end() }
  await swipe()
  await row.getByRole('button', { name: 'Удалить круг 3: суперсет', exact: true }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Отмена', exact: true }).click()
  expect(commands).toEqual(['append'])
  await swipe()
  await row.getByRole('button', { name: 'Удалить круг 3: суперсет', exact: true }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Убрать', exact: true }).click()
  await expect(group.locator('.circuit-round')).toHaveCount(2)
  expect(commands).toEqual(['append', 'remove'])
  expect(backend.getWorkouts()[0]!.exercises.map(exercise => exercise.sets.length)).toEqual([2, 2])
})


for (const theme of ['light', 'dark']) for (const density of ['original', 'compact']) test(`client header SVG paired actions preserve overdue rest ${theme} ${density}`, async ({ page }, info) => {
  await page.clock.install({ time: new Date('2026-10-21T09:00:00Z') })
  await page.addInitScript(({ id, theme, density }) => { localStorage.setItem(`fit.clientLime.theme.${id}`, theme); localStorage.setItem(`fit.clientLiveDensity.${id}`, density) }, { id: pilotId, theme, density })
  const source = restTimerWorkout(); source.startedAt = '2026-10-21T08:58:00Z'
  await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [source] })
  await page.goto(`/workouts/${workoutId}/live`)
  await expect(page.locator('button.coach-live-clock')).toHaveCount(0)
  const actions = page.locator('.client-reference-timer-actions'), pause = actions.locator('.client-reference-pause:not([data-compact])'), rest = actions.locator('.live-rest-trigger:not([data-compact])')
  for (const width of [390, 430]) {
    await page.setViewportSize({ width, height: 844 })
    const a = (await pause.boundingBox())!, b = (await rest.boundingBox())!
    expect(a.height).toBe(density === 'compact' ? 48 : 60); expect(b.height).toBe(a.height)
    expect(Math.abs(a.width - b.width)).toBeLessThanOrEqual(1)
    expect(b.x - (a.x + a.width)).toBe(2)
    expect(a.y).toBe(b.y)
    await expect(pause).toHaveCSS('border-radius', density === 'compact' ? '16px' : '20px')
    await expect(rest).toHaveCSS('border-radius', density === 'compact' ? '16px' : '20px')
    await page.screenshot({ path: info.outputPath(`header-${width}.png`) })
  }
  await page.locator('form[data-live-set-id]').first().getByRole('button', { name: 'Готово, отдых', exact: true }).click()
  await expect(page.locator('.coach-v79-large-clock')).toHaveAttribute('aria-label', /Отдых:/)
  await page.clock.fastForward(4000)
  await expect(rest).toHaveAttribute('aria-label', /Отдых превышен/)
  await expect(page.locator('.coach-v79-large-clock')).toHaveAttribute('aria-label', /Тренировка:/)
  await expect(page.locator('.coach-live-status')).toContainText('Live')
  await expect(page.locator('.coach-v79-large-clock > .coach-live-digits')).toHaveCSS('font-family', /Doto/)
})

for (const entry of ['live', 'new', 'today']) for (const theme of ['light', 'dark']) for (const width of [390, 430]) test(`client catalog actions SVG state and header ${entry} ${theme} ${width}`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 844 })
  await page.addInitScript(({ id, theme }) => { localStorage.setItem(`fit.clientLime.theme.${id}`, theme); localStorage.setItem(`fit.coachmarks-seen.${id}`, JSON.stringify(['client-live-reference-timer-2026-10'])) }, { id: pilotId, theme })
  const source = coachGestureWorkout(); source.startedAt = new Date(Date.now() - 120000).toISOString()
  const backend = await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [source] })
  await page.goto(entry === 'live' ? `/workouts/${workoutId}/live` : entry === 'new' ? '/workouts/new' : '/me?entry=workout')
  await page.getByRole('button', { name: entry === 'live' ? 'Ещё упражнение' : entry === 'new' ? 'Выбрать упражнения' : 'Выбрать упражнения вручную', exact: true }).click()
  const picker = page.locator('.client-reference-catalog'), headerAdd = picker.getByRole('button', { name: 'Добавить выбранные упражнения', exact: true })
  await expect(headerAdd).toBeDisabled()
  await expect(picker.locator('.coach-catalog-add, .coach-catalog-clear')).toHaveCount(0)
  await expect(picker.locator('.coach-catalog-create-bar')).toHaveCSS('position', 'absolute')
  await expect(picker.getByRole('button', { name: 'Создать упражнение', exact: true })).toBeVisible()
  const zeroListHeight = (await picker.locator('.picker-list').boundingBox())!.height
  await picker.getByLabel('Поиск упражнения', { exact: true }).fill('Жим')
  await picker.locator('.picker-select-mark').nth(0).click()
  await picker.locator('.picker-select-mark').nth(1).click()
  await expect(headerAdd).toBeEnabled()
  await expect(picker.locator('.coach-catalog-add')).toContainText('(2)')
  await picker.getByRole('button', { name: /^Фильтровать/ }).click()
  await expect(picker.getByLabel('Поиск упражнения', { exact: true })).toHaveValue('Жим')
  await picker.getByRole('button', { name: 'Применить фильтры', exact: true }).click()
  await expect(picker.locator('.picker-filter-panel')).toHaveCount(0)
  await expect(picker.locator('.picker-item.selected')).toHaveCount(2)
  await picker.getByRole('button', { name: 'Очистить', exact: true }).click()
  await expect(headerAdd).toBeDisabled()
  await expect(picker.locator('.coach-catalog-add')).toHaveCount(0)
  await picker.getByLabel('Поиск упражнения', { exact: true }).fill('')
  expect((await picker.locator('.picker-list').boundingBox())!.height).toBeGreaterThanOrEqual(zeroListHeight - 1)
  await page.screenshot({ path: info.outputPath('catalog-zero.png') })
  await picker.locator('.picker-select-mark').nth(0).click()
  await picker.locator('.picker-select-mark').nth(1).click()
  await page.screenshot({ path: info.outputPath('catalog-selected.png') })
  await headerAdd.click()
  await expect(picker).toHaveCount(0)
  if (entry === 'live') await expect.poll(() => backend.getWorkouts()[0]!.exercises.length).toBe(source.exercises.length + 2)
  else await expect(page.locator('.planned-exercise')).toHaveCount(2)
})

for (const theme of ['light', 'dark']) for (const width of [390, 430]) test(`client time sheets keep draft seconds cancel and rest ${theme} ${width}`, async ({ page }, info) => {
  await page.addInitScript(() => localStorage.setItem('fit.workoutTimeWheel', 'true'))
  await page.setViewportSize({ width, height: 844 })
  await page.clock.install({ time: new Date('2026-10-21T09:00:00Z') })
  await page.addInitScript(({ id, theme }) => { localStorage.setItem(`fit.clientLime.theme.${id}`, theme); localStorage.setItem(`fit.coachmarks-seen.${id}`, JSON.stringify(['client-live-reference-timer-2026-10'])) }, { id: pilotId, theme })
  const source = restTimerWorkout(0, true, 'manual'); source.startedAt = '2026-10-21T08:58:00Z'
  const backend = await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [source] })
  await page.goto(`/workouts/${workoutId}/live`)
  const trigger = page.getByRole('button', { name: /Фактическое время:/ }).first()
  await trigger.click()
  const duration = page.getByRole('dialog', { name: 'Фактическое время', exact: true })
  await expect(duration).toHaveClass(/client-reference-time-sheet/)
  await expect(duration).toHaveCSS('border-top-left-radius', '40px')
  await expect(duration.locator('.client-lime-sheet-header h1')).toHaveCSS('font-family', /YS Geo/)
  await duration.getByRole('listbox', { name: 'секунды', exact: true }).getByRole('option', { name: '10 секунды', exact: true }).click()
  await duration.getByRole('button', { name: 'Закрыть выбор времени', exact: true }).click()
  await expect(trigger).toHaveAttribute('aria-label', 'Фактическое время: 0:03')
  await trigger.click()
  await expect(duration.getByRole('option', { name: '03 секунды', exact: true })).toHaveAttribute('aria-selected', 'true')
  await duration.getByRole('listbox', { name: 'секунды', exact: true }).getByRole('option', { name: '10 секунды', exact: true }).click()
  await page.screenshot({ path: info.outputPath('duration-sheet.png') })
  await duration.getByRole('button', { name: 'Применить · 0:10', exact: true }).click()
  await page.clock.runFor(800)
  await expect.poll(() => backend.getWorkouts()[0]!.exercises[0]!.sets[0]!.fact.durationSec).toBe(10)
  await trigger.click()
  await duration.getByRole('button', { name: 'Убрать время', exact: true }).click()
  await expect(duration).toHaveCount(0)
  const restTrigger = page.locator('.live-rest-trigger').and(page.getByRole('button'))
  await restTrigger.click()
  const rest = page.getByRole('dialog', { name: 'Таймер отдыха', exact: true })
  await expect(rest).toHaveClass(/client-reference-time-sheet/)
  await expect(rest.locator('.client-lime-sheet-header')).toBeVisible()
  const mode = rest.getByRole('group', { name: 'Кто ведёт тренировку', exact: true })
  await expect(mode).toHaveCSS('border-radius', '20px')
  for (const button of await mode.getByRole('button').all()) {
    await expect(button).toHaveCSS('border-radius', '16px')
    await expect(button).toHaveCSS('min-height', '48px')
    await expect(button).toHaveCSS('font-weight', '500')
  }
  await expect(mode.getByRole('button', { name: 'Веду сам', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await rest.getByRole('listbox', { name: 'минуты', exact: true }).getByRole('option', { name: '00 минуты', exact: true }).click()
  await rest.getByRole('listbox', { name: 'секунды', exact: true }).getByRole('option', { name: '00 секунды', exact: true }).click()
  await expect(rest.getByRole('button', { name: 'Начать отдых · 0:00', exact: true })).toBeDisabled()
  await rest.getByRole('button', { name: '1:00', exact: true }).click()
  await page.screenshot({ path: info.outputPath('rest-sheet.png') })
  await rest.getByRole('button', { name: 'Начать отдых · 1:00', exact: true }).click()
  await expect(restTrigger).toHaveAttribute('aria-label', 'Таймер отдыха: 1:00')
  await restTrigger.click()
  await rest.getByRole('button', { name: 'Остановить отдых', exact: true }).click()
  await expect(restTrigger).toHaveAttribute('aria-label', 'Таймер отдыха')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

for (const role of ['trainer', 'client']) test(`time sheet client adaptation stays gated ${role}`, async ({ page }) => {
  const source = restTimerWorkout(0, true, 'manual'); source.startedAt = new Date(Date.now() - 120000).toISOString()
  await mockPilot(page, { role: role as 'trainer' | 'client', profileId: role === 'client' ? 'c11e0000-6010-4000-8000-000000000002' : 'c0ac0000-6010-4000-8000-000000000001', clientLime: true, fitLime: true, workouts: [source] })
  await page.goto(`/workouts/${workoutId}/live`)
  await page.getByRole('button', { name: /Фактическое время:/ }).first().click()
  await expect(page.locator('.workout-duration-sheet')).toBeVisible()
  await expect(page.locator('.client-reference-time-sheet')).toHaveCount(0)
})

test('client rest mode selection survives close and reload without recording strength facts', async ({ page }) => {
  const source = coachGestureWorkout(); source.startedAt = new Date(Date.now() - 120000).toISOString()
  const backend = await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [source] })
  const initial = JSON.stringify(backend.getWorkouts()[0]!.exercises)
  await page.goto(`/workouts/${workoutId}/live`)
  await page.locator('.live-rest-trigger').and(page.getByRole('button')).click()
  const mode = page.getByRole('group', { name: 'Кто ведёт тренировку', exact: true })
  await mode.getByRole('button', { name: 'Ведёт таймер', exact: true }).click()
  await expect(mode.getByRole('button', { name: 'Ведёт таймер', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await mode.getByRole('button', { name: 'Веду сам', exact: true }).click()
  await expect(mode.getByRole('button', { name: 'Веду сам', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Закрыть таймер', exact: true }).click()
  await page.reload()
  await page.locator('.live-rest-trigger').and(page.getByRole('button')).click()
  await expect(mode.getByRole('button', { name: 'Веду сам', exact: true })).toHaveAttribute('aria-pressed', 'true')
  expect(JSON.stringify(backend.getWorkouts()[0]!.exercises)).toBe(initial)
})

test.describe('assistant duration consumers', () => {
  test.skip(process.env.FIT_ASSISTANT_TIME_ACCEPTANCE !== '1', 'Requires isolated Assistant program fixture, never a live generation')
  for (const entry of ['history', 'pilot']) for (const theme of ['light', 'dark']) test(`client assistant time sheet ${entry} ${theme}`, async ({ page }, info) => {
    await page.addInitScript(({ id, theme }) => {
      localStorage.setItem(`fit.clientLime.theme.${id}`, theme)
      localStorage.setItem('fit.workoutTimeWheel', 'true')
    }, { id: pilotId, theme })
    await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [] })
    const createdAt = new Date().toISOString()
    const payload = entry === 'pilot'
      ? { programPilot: true, step: 'confirm', briefState: { scope: 'single_workout' }, editableCatalog: [{ ref: 'plank', name: 'Планка', inputKind: 'duration' }],
          canonicalWorkouts: [{ requestId: newWorkoutId, clientId, workoutDate: createdAt.slice(0, 10), exercises: [{ name: 'Планка', restBetweenSetsSec: 60, sets: [{ durationSec: 45, rpe: 6 }] }] }] }
      : { step: 'confirm', clientId, clientName: 'Тестовый спортсмен', sessions: [{ day: 'Пн', title: 'Тестовая тренировка', exercises: [{ name: 'Планка', exerciseRef: 'plank', sets: 3, durationSec: 45 }] }] }
    const action = { tool: 'create_program_draft', status: 'proposed', title: 'Тестовая тренировка', description: 'Черновик из тестовой фикстуры', payload }
    const writes: string[] = []
    await page.route('**/v1/assistant/**', route => {
      const path = new URL(route.request().url()).pathname
      if (route.request().method() !== 'GET') { writes.push(path); return route.abort() }
      if (path.endsWith('/messages')) return route.fulfill({ json: { messages: [{ id: messageId, conversationId, turnId: null, author: 'assistant', content: 'Тестовый черновик', action, createdAt }] } })
      if (path.endsWith('/conversations')) return route.fulfill({ json: { conversations: [{ id: conversationId, title: 'Тестовая беседа', createdAt }] } })
      return route.fulfill({ json: { actions: [] } })
    })
    await page.goto('/assistant')
    const session = page.locator('.assistant-program-sessions details').first()
    await session.locator('summary').click()
    if (entry === 'pilot') await session.getByRole('button', { name: 'Изменить', exact: true }).click()
    const label = entry === 'pilot' ? 'Время упражнения' : 'Планка: время'
    const trigger = page.getByRole('button', { name: `${label}: 0:45`, exact: true })
    for (const width of [390, 430]) {
      await page.setViewportSize({ width, height: 844 })
      await trigger.click()
      const dialog = page.getByRole('dialog', { name: label, exact: true })
      await expect(dialog).toHaveClass(/client-reference-time-sheet/)
      await expect(dialog).toHaveCSS('border-top-left-radius', '40px')
      await expect(dialog.locator('.client-lime-sheet-header h1')).toHaveCSS('font-family', /YS Geo/)
      await dialog.getByRole('listbox', { name: 'секунды', exact: true }).getByRole('option', { name: '50 секунды', exact: true }).click()
      await dialog.getByRole('button', { name: 'Закрыть выбор времени', exact: true }).click()
      await expect(trigger).toHaveAttribute('aria-label', `${label}: 0:45`)
      await trigger.click()
      await expect(dialog.getByRole('option', { name: '45 секунды', exact: true })).toHaveAttribute('aria-selected', 'true')
      await page.screenshot({ path: info.outputPath(`assistant-${entry}-${theme}-${width}.png`) })
      await dialog.getByRole('listbox', { name: 'секунды', exact: true }).getByRole('option', { name: '50 секунды', exact: true }).click()
      await dialog.getByRole('button', { name: 'Применить · 0:50', exact: true }).click()
      await expect(page.getByRole('button', { name: `${label}: 0:50`, exact: true })).toBeVisible()
      await page.getByRole('button', { name: `${label}: 0:50`, exact: true }).click()
      await expect(dialog.getByRole('option', { name: '50 секунды', exact: true })).toHaveAttribute('aria-selected', 'true')
      await dialog.getByRole('listbox', { name: 'секунды', exact: true }).getByRole('option', { name: '45 секунды', exact: true }).click()
      await dialog.getByRole('button', { name: 'Применить · 0:45', exact: true }).click()
      await expect(trigger).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    }
    expect(writes).toEqual([])
  })
})

for (const theme of ['light', 'dark']) for (const density of ['original', 'compact']) test(`client inline save feedback stays clear and stable ${theme} ${density}`, async ({ page }, info) => {
  await page.addInitScript(({ id, theme, density }) => { localStorage.setItem(`fit.clientLime.theme.${id}`, theme); localStorage.setItem(`fit.clientLiveDensity.${id}`, density) }, { id: pilotId, theme, density })
  const source = restTimerWorkout(); source.startedAt = new Date(Date.now() - 120000).toISOString()
  const backend = await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [source] })
  let release!: () => void
  const waiting = new Promise<void>(resolve => { release = resolve })
  await page.route('**/v1/workout-sets/*/draft', async route => { await waiting; await route.fallback() })
  await page.goto(`/workouts/${workoutId}/live`)
  const row = page.locator('form[data-live-set-id]').first()
  const before = (await row.boundingBox())!.height
  await row.getByLabel('Фактический вес', { exact: true }).fill('25')
  await row.getByLabel('Фактические повторы', { exact: true }).click()
  await expect(row.locator('.save-status-saving')).toBeVisible()
  expect((await row.boundingBox())!.height).toBe(before)
  release()
  await expect(row.locator('.save-status-saved')).toHaveCount(0)
  await expect(row.locator('.save-status-saving')).toHaveCount(0)
  expect((await row.boundingBox())!.height).toBe(before)
  await expect.poll(() => backend.getWorkouts()[0]!.exercises[0]!.sets[0]!.fact.weightKg).toBe(25)
  for (const width of [390, 430]) {
    await page.setViewportSize({ width, height: 844 })
    const status = row.locator('.save-status')
    if (await status.count()) {
      await expect(status).toHaveCSS('position', 'static')
      const a = (await status.boundingBox())!, b = (await row.locator('.live-set-grid').boundingBox())!
      expect(a.y).toBeGreaterThanOrEqual(b.y + b.height)
    }
    await page.screenshot({ path: info.outputPath(`save-feedback-${width}.png`) })
  }
  await expect(row.getByRole('button', { name: 'Готово, отдых', exact: true })).toBeEnabled()
  expect(backend.getWorkouts()[0]!.exercises[0]!.sets[0]!.confirmedAt).toBeNull()
})

for (const theme of ['light', 'dark']) for (const density of ['original', 'compact']) test(`client confirmation error readable and retry keeps facts ${theme} ${density}`, async ({ page }, info) => {
  await page.addInitScript(({ id, theme, density }) => { localStorage.setItem(`fit.clientLime.theme.${id}`, theme); localStorage.setItem(`fit.clientLiveDensity.${id}`, density) }, { id: pilotId, theme, density })
  const source = restTimerWorkout(); source.startedAt = new Date(Date.now() - 120000).toISOString()
  const backend = await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [source], failFirstSetConfirm: true })
  await page.goto(`/workouts/${workoutId}/live`)
  const row = page.locator('form[data-live-set-id]').first(), confirm = row.getByRole('button', { name: 'Готово, отдых', exact: true })
  await row.getByLabel('Фактический вес', { exact: true }).fill('27.5')
  await confirm.click()
  await expect(row.locator('.save-status-error')).toContainText('Не удалось подтвердить')
  // One layout sample: source timer entry may move the whole card between frames.
  const boxes = await row.evaluate(element => ({ errorTop: element.querySelector('.save-status-error')!.getBoundingClientRect().top, controlsBottom: element.querySelector('.live-set-grid')!.getBoundingClientRect().bottom }))
  expect(boxes.errorTop).toBeGreaterThanOrEqual(boxes.controlsBottom)
  const sync = page.locator('.live-sync-state.error')
  await expect(sync).toHaveCSS('border-radius', '20px')
  await expect(sync.locator('strong')).toHaveCSS('font-weight', '500')
  await page.screenshot({ path: info.outputPath('confirmation-error.png') })
  if (density === 'compact') {
    // A blur autosave after a failed confirmation must not acknowledge away
    // the pending command that the existing bottom retry needs.
    await row.getByLabel('Фактический вес', { exact: true }).focus()
    await row.getByLabel('Фактический вес', { exact: true }).blur()
    await expect.poll(() => backend.getWorkouts()[0]!.exercises[0]!.sets[0]!.fact.weightKg).toBe(27.5)
    await expect(sync.getByRole('button', { name: 'Повторить', exact: true })).toBeEnabled()
    await sync.getByRole('button', { name: 'Повторить', exact: true }).click()
  }
  else await confirm.click()
  await expect(row).toHaveClass(/confirmed/)
  expect(backend.getWorkouts()[0]!.exercises[0]!.sets[0]!.fact.weightKg).toBe(27.5)
})

for (const theme of ['light', 'dark']) for (const density of ['original', 'compact']) test(`client phase feedback correction and rest undo keep semantics ${theme} ${density}`, async ({ page }, info) => {
  await page.clock.install({ time: new Date('2026-10-21T09:00:00Z') })
  await page.addInitScript(({ id, theme, density }) => { localStorage.setItem(`fit.clientLime.theme.${id}`, theme); localStorage.setItem(`fit.clientLiveDensity.${id}`, density) }, { id: pilotId, theme, density })
  const source = restTimerWorkout(0, true, 'timer'); source.startedAt = '2026-10-21T08:58:00Z'; source.exercises[0]!.restBetweenSetsSec = 30
  const backend = await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [source] })
  await page.goto(`/workouts/${workoutId}/live`)
  await page.clock.fastForward(3500)
  const notice = page.locator('.live-phase-notice')
  await expect(notice).toContainText('Подход засчитан')
  await expect(notice).toHaveCSS('border-radius', '20px')
  for (const width of [390, 430]) {
    await page.setViewportSize({ width, height: 844 })
    const a = (await notice.locator('span').boundingBox())!, b = (await notice.getByRole('button').boundingBox())!
    expect(a.x + a.width).toBeLessThanOrEqual(b.x)
    await page.screenshot({ path: info.outputPath(`phase-notice-${width}.png`) })
  }
  const confirmed = backend.getWorkouts()[0]!.exercises[0]!.sets[0]!.confirmedAt
  await notice.getByRole('button', { name: 'Исправить', exact: true }).click()
  await expect(notice).toHaveCount(0)
  expect(backend.getWorkouts()[0]!.exercises[0]!.sets[0]!.confirmedAt).toBe(confirmed)
  // Correction deliberately scrolls to its input. Return to the large action;
  // the compact copy's hit/focus path is covered by the handoff test.
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  await page.locator('.content').evaluate(element => { element.scrollTop = 0; element.dispatchEvent(new Event('scroll')) })
  await expect(page.locator('.coach-v79-actions')).toBeVisible()
  await page.locator('.live-rest-trigger').and(page.getByRole('button')).click()
  await expect(notice).toContainText('Отдых остановлен')
  await notice.getByRole('button', { name: 'Вернуть', exact: true }).click()
  await expect(notice).toHaveCount(0)
  await expect(page.locator('.live-rest-trigger').and(page.getByRole('button'))).toHaveAttribute('aria-label', /Таймер отдыха:/)
  expect(backend.getWorkouts()[0]!.exercises[0]!.sets[1]!.confirmedAt).toBeNull()
})

function liveContrast(foreground: string, background: string) {
  const luminance = (color: string) => {
    const channels = color.match(/[\d.]+/g)!.slice(0, 3).map(value => Number(value) / (color.startsWith('color(srgb') ? 1 : 255))
      .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
    return channels[0]! * .2126 + channels[1]! * .7152 + channels[2]! * .0722
  }
  const a = luminance(foreground), b = luminance(background)
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05)
}

for (const theme of ['light', 'dark']) for (const density of ['original', 'compact']) test(`client Live metric readability ${theme} ${density}`, async ({ page }, info) => {
  await page.addInitScript(() => localStorage.setItem('fit.workoutTimeWheel', 'true'))
  await page.addInitScript(({ id, theme, density }) => {
    localStorage.setItem(`fit.clientLime.theme.${id}`, theme)
    localStorage.setItem(`fit.clientLiveDensity.${id}`, density)
  }, { id: pilotId, theme, density })
  const source = coachGestureWorkout(false, 1), exercise = source.exercises[0]!
  exercise.inputKind = 'distance'; exercise.ref = 'running'; exercise.name = 'Бег'; exercise.muscleGroup = 'cardio'
  exercise.sets = exercise.sets.map(set => ({ ...set, weightKg: undefined, reps: undefined, distanceKm: 1.5, durationSec: 600, fact: {} }))
  await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [source] })
  await page.goto(`/workouts/${workoutId}/live`)
  await expect(page.locator('.client-workout-reference')).toBeVisible()
  const row = page.locator('.live-set.current').first()
  for (const width of [390, 430]) {
    await page.setViewportSize({ width, height: 844 })
    const metrics = await row.locator('.run-distance-unit').evaluate(element => {
      const style = getComputedStyle(element), box = element.getBoundingClientRect()
      return { color: style.color, background: getComputedStyle(element.closest('.run-distance-control')!).backgroundColor, size: parseFloat(style.fontSize), height: box.height, width: box.width }
    })
    expect(liveContrast(metrics.color, metrics.background)).toBeGreaterThanOrEqual(4.5)
    expect(metrics.size).toBeGreaterThanOrEqual(16)
    expect(metrics.height).toBe(density === 'original' ? 54 : 48)
    expect(metrics.width).toBeGreaterThanOrEqual(44)
    const unit = row.locator('.coach-live-field-unit').first()
    expect(await unit.evaluate(element => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(12)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: info.outputPath(`readable-metrics-${width}.png`) })
  }
  await row.locator('.workout-duration-trigger').click()
  const wheel = page.getByRole('listbox', { name: 'минуты', exact: true })
  await wheel.focus()
  const focus = await wheel.evaluate(element => {
    const style = getComputedStyle(element)
    return { color: style.outlineColor, background: getComputedStyle(element.closest('[role="dialog"]')!).backgroundColor, width: parseFloat(style.outlineWidth) }
  })
  expect(focus.width).toBeGreaterThanOrEqual(2)
  expect(liveContrast(focus.color, focus.background)).toBeGreaterThanOrEqual(3)
  await page.screenshot({ path: info.outputPath('readable-wheel.png') })
})

for (const theme of ['light', 'dark']) test(`client Live phase text contrast ${theme}`, async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-22T09:00:00Z') })
  await page.addInitScript(({ id, theme }) => { localStorage.setItem(`fit.clientLime.theme.${id}`, theme); localStorage.setItem(`fit.coachmarks-seen.${id}`, JSON.stringify(['client-live-reference-timer-2026-10'])) }, { id: pilotId, theme })
  await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [restTimerWorkout(5, true, 'timer')] })
  await page.goto(`/workouts/${workoutId}/live`)
  const phase = page.locator('.live-rest-trigger').and(page.getByRole('button'))
  for (const label of ['Подготовка', 'Подход']) {
    await expect(phase).toContainText(label)
    const colors = await phase.evaluate(element => ({ color: getComputedStyle(element).color, background: getComputedStyle(element).backgroundColor }))
    expect(liveContrast(colors.color, colors.background)).toBeGreaterThanOrEqual(4.5)
    if (label === 'Подготовка') await page.clock.fastForward(5000)
  }
})

for (const theme of ['light', 'dark']) for (const density of ['original', 'compact']) test(`client Live three visible set states ${theme} ${density}`, async ({ page }, info) => {
  await page.addInitScript(({ id, theme, density }) => {
    localStorage.setItem(`fit.clientLime.theme.${id}`, theme)
    localStorage.setItem(`fit.clientLiveDensity.${id}`, density)
    localStorage.setItem(`fit.liveExerciseAnimation.${id}`, 'false')
  }, { id: pilotId, theme, density })
  const source = coachGestureWorkout(false, 1), exercise = source.exercises[0]!
  exercise.sets.push({ ...exercise.sets[1]!, id: '10000000-0000-4000-8000-000000000099', position: 2, fact: {} })
  const confirmedAt = new Date(Date.now() - 60000).toISOString()
  exercise.sets[0]!.confirmedAt = confirmedAt
  exercise.sets[0]!.fact = { weightKg: 20, reps: 10 }
  const backend = await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [source] })
  await page.goto(`/workouts/${workoutId}/live`)
  const rows = page.locator('form[data-live-set-id]')
  await expect(rows).toHaveCount(3)
  await expect(rows.first().getByRole('img', { name: 'Подход выполнен' })).toBeVisible()
  await expect(rows.nth(1)).toHaveClass(/current/)
  await expect(rows.nth(2).getByRole('button', { name: 'Готово, отдых', exact: true })).toBeVisible()
  for (const width of [390, 430]) {
    await page.setViewportSize({ width, height: 844 })
    const states = await rows.locator('.live-set-check').evaluateAll(elements => elements.map(element => {
      const style = getComputedStyle(element)
      return { background: style.backgroundColor, color: style.color, mark: style.boxShadow, height: element.getBoundingClientRect().height }
    }))
    expect(states[0]!.color).not.toBe(states[2]!.color)
    expect(states[0]!.background).not.toBe(states[2]!.background)
    expect(states[1]!.background).not.toBe(states[2]!.background)
    expect(states[0]!.mark).not.toBe('none')
    expect(liveContrast(states[0]!.color, states[0]!.background)).toBeGreaterThanOrEqual(3)
    for (const state of states) expect(state.height).toBe(density === 'original' ? 54 : 48)
    await page.screenshot({ path: info.outputPath(`three-states-${width}.png`) })
  }
  await rows.first().getByLabel('Фактический вес', { exact: true }).fill('27.5')
  await rows.first().getByLabel('Фактический вес', { exact: true }).blur()
  await expect.poll(() => backend.getWorkouts()[0]!.exercises[0]!.sets[0]!.fact.weightKg).toBe(27.5)
  expect(backend.getWorkouts()[0]!.exercises[0]!.sets[0]!.confirmedAt).toBe(confirmedAt)
  await expect(rows.first().getByRole('img', { name: 'Подход выполнен' })).toBeVisible()
  await expect(page.locator('.live-rest-trigger').and(page.getByRole('button'))).not.toHaveAttribute('aria-label', /Отдых идёт/)
})

for (const theme of ['light', 'dark']) for (const density of ['original', 'compact']) test(`client Live media-off header and group menu ${theme} ${density}`, async ({ page }, info) => {
  await page.addInitScript(({ id, theme, density }) => {
    localStorage.setItem(`fit.clientLime.theme.${id}`, theme)
    localStorage.setItem(`fit.clientLiveDensity.${id}`, density)
    localStorage.setItem(`fit.liveExerciseAnimation.${id}`, 'false')
    localStorage.setItem(`fit.coachmarks-seen.${id}`, JSON.stringify(['client-live-reference-timer-2026-10', 'client-live-card-drag-2026-10']))
  }, { id: pilotId, theme, density })
  const source = coachGestureWorkout(true)
  source.startedAt = new Date(Date.now() - 120000).toISOString()
  source.exercises[0]!.ref = 'barbell-squat'
  source.exercises[1]!.name = 'Жим гантелей на наклонной скамье с длинным названием упражнения'
  await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [source] })
  await page.goto(`/workouts/${workoutId}/live`)
  await expect(page.locator('.client-workout-reference')).toBeVisible()
  const header = page.locator('.live-exercise-head').first()
  for (const width of [390, 430]) {
    await page.setViewportSize({ width, height: 844 })
    await expect(page.locator('.live-header-animation, .live-exercise-head .exercise-thumbnail')).toHaveCount(0)
    expect((await header.boundingBox())!.height).toBeLessThan(density === 'original' ? 100 : 80)
    const geometry = await page.locator('.live-exercise-head').evaluateAll(headers => headers.map(element => {
      const title = element.querySelector('h2, h3')!.getBoundingClientRect(), menu = element.querySelector('.overflow-trigger')?.getBoundingClientRect()
      return { height: element.getBoundingClientRect().height, titleRight: title.right, menuLeft: menu?.left }
    }))
    for (const item of geometry) {
      expect(item.height).toBeGreaterThanOrEqual(44)
      if (item.menuLeft !== undefined) expect(item.titleRight).toBeLessThanOrEqual(item.menuLeft)
    }
    const menu = page.locator('.circuit-head .overflow-trigger').first()
    await expect(menu).toHaveCSS('border-radius', '0px')
    await expect(menu).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    const box = (await menu.boundingBox())!
    expect(box.width).toBe(44); expect(box.height).toBe(44)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: info.outputPath(`media-off-${width}.png`) })
  }
  const weight = page.getByLabel('Фактический вес', { exact: true }).first()
  await weight.fill('31.5')
  const original = await weight.elementHandle()
  if (!original) throw new Error('Live field missing')
  await page.evaluate(id => { localStorage.setItem(`fit.liveExerciseAnimation.${id}`, 'true'); dispatchEvent(new Event('fit-live-exercise-animation-change')) }, pilotId)
  await expect(header.locator('.live-header-animation, .exercise-thumbnail')).toBeVisible()
  expect(await original.evaluate(element => element.isConnected)).toBe(true)
  expect(await weight.evaluate((element, previous) => element === previous, original)).toBe(true)
  await expect(weight).toHaveValue('31.5')
  await expect(weight).toBeFocused()
  await page.evaluate(id => { localStorage.setItem(`fit.liveExerciseAnimation.${id}`, 'false'); dispatchEvent(new Event('fit-live-exercise-animation-change')) }, pilotId)
  await expect(header.locator('.live-header-animation, .exercise-thumbnail')).toHaveCount(0)
  await expect(weight).toHaveValue('31.5')
  await weight.blur()
  await page.locator('.circuit-head .overflow-trigger').first().click()
  await expect(page.getByRole('menu')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toHaveCount(0)
})

for (const theme of ['light', 'dark']) test(`client Live contextual 503 retains diagnostics and recovers ${theme}`, async ({ page }, info) => {
  await page.addInitScript(({ id, theme }) => {
    localStorage.setItem(`fit.clientLime.theme.${id}`, theme)
    localStorage.setItem(`fit.liveExerciseAnimation.${id}`, 'false')
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: (text: string) => { sessionStorage.setItem('test.live.diagnostic', text); return Promise.resolve() } } })
  }, { id: pilotId, theme })
  const source = restTimerWorkout()
  const set = source.exercises[0]!.sets[0]!
  set.confirmedAt = new Date().toISOString(); set.fact = { weightKg: 27.5, reps: 9 }
  const backend = await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [source] })
  let fail = true, release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  await page.route('**/v1/**', async route => {
    if (route.request().method() !== 'GET' || !new URL(route.request().url()).pathname.includes('/training-data')) return route.fallback()
    await held
    if (fail) return route.fulfill({ status: 503, json: { error: 'service_unavailable' } })
    return route.fallback()
  })
  await page.goto(`/workouts/${workoutId}/live`)
  await expect(page.getByRole('status', { name: 'Загрузка', exact: true })).toBeVisible()
  release()
  await expect(page.getByRole('alert')).toContainText('Сервис временно недоступен. Попробуйте ещё раз.', { timeout: 25000 })
  await expect(page.getByRole('alert')).not.toContainText('Пилот')
  for (const width of [390, 430]) {
    await page.setViewportSize({ width, height: 844 })
    await expect(page.getByRole('button', { name: 'Повторить', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Скопировать диагностику', exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1)
    await page.screenshot({ path: info.outputPath(`error-503-${width}.png`), fullPage: true })
  }
  await page.getByRole('button', { name: 'Скопировать диагностику', exact: true }).click()
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('test.live.diagnostic'))).toContain('HTTP: 503')
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('test.live.diagnostic'))).toContain('Request ID:')
  fail = false
  await page.getByRole('button', { name: 'Повторить', exact: true }).click()
  const row = page.locator(`form[data-live-set-id="${set.id}"]`)
  await expect(row).toHaveClass(/confirmed/)
  await expect(row.getByLabel('Фактический вес', { exact: true })).toHaveValue('27.5')
  expect(backend.getWorkouts()[0]!.exercises[0]!.sets[0]!.confirmedAt).toBe(set.confirmedAt)
  expect(backend.getWorkouts()[0]!.exercises[0]!.sets[0]!.fact).toEqual(set.fact)
  await page.screenshot({ path: info.outputPath('retry-restored.png'), fullPage: true })
})

for (const role of ['trainer', 'client'] as const) test(`Live outside client pilot retains 503 fallback ${role}`, async ({ page }) => {
  await mockPilot(page, { role, profileId: role === 'client' ? 'c11e0000-6010-4000-8000-000000000002' : 'c0ac0000-6010-4000-8000-000000000001', clientLime: true, fitLime: true, workouts: [restTimerWorkout()] })
  await page.route('**/v1/**', route => route.request().method() === 'GET' && new URL(route.request().url()).pathname.includes('/training-data') ? route.fulfill({ status: 503, json: { error: 'service_unavailable' } }) : route.fallback())
  await page.goto(`/workouts/${workoutId}/live`)
  await expect(page.getByRole('alert')).toContainText('Пилот временно недоступен', { timeout: 25000 })
  await expect(page.getByRole('button', { name: 'Повторить', exact: true })).toBeVisible()
})


for (const theme of ['light', 'dark']) for (const density of ['original', 'compact']) test(`client pilot dense cardio grid and title ${theme} ${density}`, async ({ page }, info) => {
  await page.addInitScript(() => localStorage.setItem('fit.workoutTimeWheel', 'true'))
  await page.addInitScript(({ id, theme, density }) => {
    localStorage.setItem(`fit.clientLime.theme.${id}`, theme)
    localStorage.setItem(`fit.clientLiveDensity.${id}`, density)
  }, { id: pilotId, theme, density })
  const source = restTimerWorkout()
  source.startedAt = new Date(Date.now() - 120000).toISOString()
  const exercise = source.exercises[0]!
  exercise.ref = 'walking'; exercise.name = 'Ходьба с достаточно длинным названием упражнения'; exercise.inputKind = 'distance'
  exercise.sets = exercise.sets.map(set => ({ ...set, weightKg: undefined, reps: undefined, durationSec: 300, distanceKm: 1 }))
  await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [source] })
  await page.goto(`/workouts/${workoutId}/live`)
  const rows = page.locator('form[data-live-set-id]')
  await expect(rows).toHaveCount(2)
  await page.evaluate(() => document.fonts.ready)
  for (const width of [390, 430]) {
    await page.setViewportSize({ width, height: 844 })
    const geometry = await page.locator('.live-exercise').evaluate(card => {
      const rect = (selector: string) => card.querySelector(selector)!.getBoundingClientRect()
      const header = rect('.live-exercise-head'), title = rect('.exercise-technique-trigger h2'), trigger = rect('.exercise-technique-trigger')
      const time = rect('.workout-duration-trigger'), check = rect('.live-set-check')
      const grids = card.querySelectorAll('.live-set-grid'), first = grids[0]!.getBoundingClientRect(), second = grids[1]!.getBoundingClientRect()
      const style = getComputedStyle(card.querySelector('.live-exercise-head')!)
      const contentHeight = Math.max(trigger.height, card.querySelector('.exercise-thumbnail')?.getBoundingClientRect().height ?? 0, rect('.exercise-head-actions').height)
      return { headerHeight: header.height, contentHeight, paddingTop: parseFloat(style.paddingTop), paddingBottom: parseFloat(style.paddingBottom), border: parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth), minHeight: style.minHeight, titleInset: title.x - trigger.x, confirmOffset: check.y - time.y, checkHeight: check.height, timeHeight: time.height, rowGap: second.y - first.bottom }
    })
    await info.attach(`layout-${width}`, { body: JSON.stringify(geometry), contentType: 'application/json' })
    expect(geometry.minHeight).toBe('0px')
    expect(geometry.paddingTop).toBe(density === 'original' ? 16 : 12)
    expect(geometry.paddingBottom).toBe(8)
    expect(Math.abs(geometry.headerHeight - geometry.contentHeight - geometry.paddingTop - geometry.paddingBottom - geometry.border)).toBeLessThan(1)
    expect(Math.abs(geometry.titleInset)).toBeLessThan(1)
    expect(Math.abs(geometry.confirmOffset)).toBeLessThan(1)
    expect(geometry.checkHeight).toBe(density === 'original' ? 54 : 48)
    expect(geometry.timeHeight).toBe(geometry.checkHeight)
    expect(geometry.rowGap).toBe(2)
    await expect(rows.first().locator('.live-set-save-feedback')).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: info.outputPath(`dense-cardio-${width}.png`) })
  }
})

for (const theme of ['light', 'dark']) for (const density of ['original', 'compact']) for (const height of [844, 568]) for (const width of [390, 430]) test(`client matrix clock and rest sheet flow ${theme} ${density} ${width}x${height}`, async ({ page }, info) => {
  // Separate phone layouts need separate browser contexts, not navigation
  // history/scroll restoration from another viewport in the same page.
  await page.setViewportSize({ width, height })
  await page.clock.install({ time: new Date('2026-10-21T09:00:00Z') })
  // Screenshots must not spend a real second of the tested 60s deadline.
  await page.clock.setFixedTime(new Date('2026-10-21T09:00:00Z'))
  await page.addInitScript(({ id, theme, density }) => { localStorage.setItem(`fit.clientLime.theme.${id}`, theme); localStorage.setItem(`fit.clientLiveDensity.${id}`, density) }, { id: pilotId, theme, density })
  const source = restTimerWorkout(); source.startedAt = '2026-10-19T09:00:00Z'
  await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [source] })
  await page.goto(`/workouts/${workoutId}/live`)
  const digits = page.locator('.coach-v79-large-clock > .coach-live-digits')
  await expect(page.locator('.coach-v79-large-clock')).toHaveClass(/long-clock/)
  await expect(digits).toHaveCSS('font-family', /Doto/)
  expect(await page.evaluate(async () => {
    const loaded = await document.fonts.load('700 64px Doto', '0123456789−+:')
    return loaded.some(font => font.family.replace(/['"]/g, '') === 'Doto' && font.status === 'loaded')
  })).toBe(true)
  const restTrigger = page.locator('.live-rest-trigger').and(page.getByRole('button'))
  await expect(page.locator('html')).not.toHaveClass(/app-keyboard-open/)
  await expect(page.locator('html')).toHaveCSS('--app-visible-height', `${height}px`)
  expect(await digits.evaluate(node => node.getBoundingClientRect().width <= innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath(`matrix-clock-${width}-${height}.png`) })
  await restTrigger.click()
  const sheet = page.locator('.live-rest-sheet'), apply = sheet.locator('.live-rest-apply')
  await expect(apply).toHaveCSS('position', 'static')
  await expect(apply).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  await expect(apply).toHaveCSS('padding-top', '0px')
  const boxes = await sheet.evaluate(node => {
    const wheels=node.querySelector('.rest-time-picker')!.getBoundingClientRect(), presets=node.querySelector('.rest-presets')!.getBoundingClientRect(), apply=node.querySelector('.live-rest-apply')!.getBoundingClientRect()
    return { wheelBottom:wheels.bottom, presetTop:presets.top, presetBottom:presets.bottom, applyTop:apply.top }
  })
  expect(boxes.presetTop).toBeGreaterThanOrEqual(boxes.wheelBottom)
  expect(boxes.applyTop).toBeGreaterThanOrEqual(boxes.presetBottom)
  await sheet.getByRole('button', { name: '1:00', exact: true }).click()
  await apply.getByRole('button').scrollIntoViewIfNeeded()
  await page.screenshot({ path: info.outputPath(`rest-flow-${width}-${height}.png`) })
  await apply.getByRole('button').click()
  // The source clock expands during rest. Check its final layout and the
  // actual user hit target before opening the settings again.
  await expect(page.locator('.coach-v79-large-clock')).toHaveCSS('height', density === 'original' ? '248px' : '132px')
  await expect(restTrigger).toHaveAttribute('aria-label', 'Таймер отдыха: 1:00')
  await expect.poll(() => restTrigger.evaluate(element => {
    const box = element.getBoundingClientRect()
    return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2))
  })).toBe(true)
  await restTrigger.click()
  const activeFlow = await sheet.evaluate(node => {
    const wheels = node.querySelector('.rest-time-picker')!.getBoundingClientRect(), apply = node.querySelector('.live-rest-apply')!.getBoundingClientRect()
    return { wheelBottom: wheels.bottom, applyTop: apply.top }
  })
  expect(activeFlow.applyTop).toBeGreaterThanOrEqual(activeFlow.wheelBottom)
  await sheet.getByRole('button', { name: '3:00', exact: true }).scrollIntoViewIfNeeded()
  await expect(sheet.getByRole('button', { name: '3:00', exact: true })).toBeVisible()
  await page.screenshot({ path: info.outputPath(`rest-active-flow-${width}-${height}.png`) })
  await sheet.getByRole('button', { name: 'Плюс 15 секунд', exact: true }).click()
  await expect(restTrigger).toHaveAttribute('aria-label', 'Таймер отдыха: 1:15')
  await sheet.getByRole('button', { name: 'Остановить отдых', exact: true }).click()
  await expect(sheet).toBeHidden()
})

for (const theme of ['light', 'dark']) for (const density of ['original', 'compact']) for (const length of ['empty', 'short', 'long']) test(`client workout note disclosure ${theme} ${density} ${length}`, async ({ page }, info) => {
  await page.addInitScript(({ id, theme, density }) => { localStorage.setItem(`fit.clientLime.theme.${id}`, theme); localStorage.setItem(`fit.clientLiveDensity.${id}`, density) }, { id: pilotId, theme, density })
  const source = coachGestureWorkout(); source.startedAt = new Date(Date.now() - 120000).toISOString()
  source.notes = length === 'empty' ? '  ' : length === 'short' ? 'Спокойный темп.' : ('Полный текст из Ассистента, без сокращения содержимого.\n').repeat(30)
  source.exercises[0]!.trainerComment = 'Сохраняй технику'
  const backend = await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [source] })
  const initial = JSON.stringify(backend.getWorkouts()[0])
  await page.goto(`/workouts/${workoutId}/live`)
  // The empty-note branch must prove the real pilot Live mounted before
  // asserting absence; an unmounted/welcome page is not empty-state proof.
  await expect(page.locator('.client-workout-reference')).toBeVisible()
  await expect(page.locator('form[data-live-set-id]').first()).toBeVisible()
  const note = page.locator('.client-live-workout-note')
  if (length === 'empty') { await expect(note).toHaveCount(0); return }
  await expect(note.locator('summary')).toHaveCSS('font-family', /YS Geo/)
  expect(await page.evaluate(async () => {
    const faces = await Promise.all([400, 500].map((weight) => document.fonts.load(weight + ' 16px "YS Geo"', 'Заметка 12')))
    return faces.every((group) => group.length > 0 && group.every((face) => face.status === 'loaded'))
  })).toBe(true)
  await expect(note).not.toHaveAttribute('open', '')
  for (const width of [390, 430]) {
    await page.setViewportSize({ width, height: 844 })
    expect((await note.boundingBox())!.height).toBeLessThanOrEqual(60)
    await note.locator('summary').click()
    await expect(note.locator('p')).toBeVisible()
    expect(await note.locator('p').textContent()).toBe(source.notes)
    await expect(note.locator('p')).toHaveCSS('white-space', 'pre-wrap')
    await expect(note.locator('.live-workout-note-hide')).toBeVisible()
    await note.locator('summary').click()
    await expect(note.locator('p')).toBeHidden()
    await page.screenshot({ path: info.outputPath(`workout-note-${width}.png`) })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
  await expect(page.locator('.live-trainer-note')).toContainText('От тренера')
  await expect(page.locator('.live-exercise-note').first()).toContainText('Моя заметка')
  expect(JSON.stringify(backend.getWorkouts()[0])).toBe(initial)
  await page.reload()
  await expect(note.locator('p')).toBeHidden()
  await note.locator('summary').click()
  expect(await note.locator('p').textContent()).toBe(source.notes)
})

// These axes affect touch hitboxes, selected-row colors and keyboard/focus
// geometry. Both engines exercise real swipe events, not a duplicated API test.
for (const theme of ['light', 'dark']) for (const density of ['original', 'compact']) for (const width of [390, 430]) test(`client confirmed swipe explicit cancel delete and reload ${theme} ${density} ${width}`, async ({ page, browserName }, info) => {
  await page.clock.install({ time: new Date('2026-10-21T09:00:00Z') })
  await page.setViewportSize({ width, height: 844 })
  await page.addInitScript(({ id, theme, density }) => { localStorage.setItem(`fit.clientLime.theme.${id}`, theme); localStorage.setItem(`fit.clientLiveDensity.${id}`, density) }, { id: pilotId, theme, density })
  const source = restTimerWorkout(); source.startedAt = '2026-10-21T08:58:00Z'
  const exercise = source.exercises[0]!, target = exercise.sets[0]!, other = exercise.sets[1]!
  const backend = await mockPilot(page, { role:'client', profileId:pilotId, clientLime:true, workouts:[source] })
  const commands: { expectedSetVersion: number; operationId: string }[] = []
  let releaseDelete!: () => void
  const deleteGate = new Promise<void>(resolve => { releaseDelete = resolve })
  await page.route('**/v1/workout-sets/*', async route => { if(route.request().method()==='DELETE') { commands.push(route.request().postDataJSON() as { operationId: string; expectedSetVersion: number }); await deleteGate } return route.fallback() })
  await page.goto(`/workouts/${workoutId}/live`)
  const first = page.locator(`form[data-live-set-id="${target.id}"]`), second = page.locator(`form[data-live-set-id="${other.id}"]`)
  await first.getByLabel('Фактический вес', { exact:true }).fill('35')
  await first.getByRole('button', { name:'Готово, отдых', exact:true }).click()
  await expect(first).toHaveClass(/confirmed/)
  // CRUD starts after the existing focus handoff; the forced-race cases above
  // independently verify manual interaction before that handoff completes.
  await expect(second.getByLabel('Фактический вес', { exact:true })).toBeFocused()
  const stamp = backend.getWorkouts()[0]!.exercises[0]!.sets[0]!.confirmedAt
  await first.getByLabel('Фактический вес', { exact:true }).fill('37.5')
  await first.getByLabel('Фактический вес', { exact:true }).blur()
  await expect.poll(() => backend.getWorkouts()[0]!.exercises[0]!.sets[0]!.fact.weightKg).toBe(37.5)
  // Editing a confirmed row selects a removal target, never the active work set.
  await expect(second).toHaveClass(/current/)
  expect(backend.getWorkouts()[0]!.exercises[0]!.sets[0]!.confirmedAt).toBe(stamp)
  await second.getByLabel('Фактический вес', { exact:true }).fill('40')
  await second.getByLabel('Фактический вес', { exact:true }).blur()
  await expect.poll(() => backend.getWorkouts()[0]!.exercises[0]!.sets[1]!.fact.weightKg).toBe(40)
  const version = backend.getWorkouts()[0]!.exercises[0]!.sets[0]!.version
  const sibling = JSON.stringify(backend.getWorkouts()[0]!.exercises[0]!.sets[1]!.fact)
  const deadline = await page.evaluate(id => sessionStorage.getItem(`fit:live-rest-until:${id}`), workoutId)
  expect(deadline).not.toBeNull()
  const swipe = async () => { const gesture=await beginClientGesture(page,first,browserName,first.locator('.live-set-number')); await gesture.move(60); await gesture.end(); await first.getByRole('button',{name:/Удалить подход 1:/}).click() }
  await swipe()
  await expect(page.getByRole('alertdialog')).toContainText('Выполненный результат')
  await page.getByRole('alertdialog').getByRole('button',{name:'Отмена',exact:true}).click()
  expect(commands).toHaveLength(0); await expect(first).toHaveClass(/confirmed/)
  await swipe()
  await page.getByRole('alertdialog').getByRole('button',{name:'Удалить',exact:true}).click()
  await expect(first).toHaveAttribute('aria-busy','true')
  await expect(first).toHaveAttribute('inert','')
  releaseDelete()
  await expect(first).toHaveCount(0)
  expect(commands).toHaveLength(1); expect(commands[0]!.expectedSetVersion).toBe(version)
  expect(JSON.stringify(backend.getWorkouts()[0]!.exercises[0]!.sets[0]!.fact)).toBe(sibling)
  await expect(second.getByLabel('Фактический вес',{exact:true})).toHaveValue('40')
  expect(await page.evaluate(id => sessionStorage.getItem(`fit:live-rest-until:${id}`), workoutId)).toBe(deadline)
  await page.clock.fastForward(3000)
  await expect(page.locator('.live-rest-trigger').and(page.getByRole('button'))).toHaveAttribute('aria-label',/Отдых превышен/)
  await expect(page.locator('.coach-v79-large-clock')).toHaveAttribute('aria-label',/Тренировка:/)
  await expect(page.locator('.live-session-progress-copy')).toContainText('Готово 0 из 1')
  await expect(second.locator('.workout-swipe-action')).toHaveCount(0)
  await page.reload()
  await expect(first).toHaveCount(0)
  await expect(second.getByLabel('Фактический вес',{exact:true})).toHaveValue('40')
  await page.screenshot({path:info.outputPath('confirmed-delete.png')})
})

for (const theme of ['light','dark']) for (const failure of ['lost','retry','changed']) test(`client confirmed removal response recovery ${theme} ${failure}`, async ({page,browserName}) => {
  await page.clock.install({ time:new Date('2026-10-21T09:00:00Z') })
  await page.addInitScript(({id,theme})=>localStorage.setItem(`fit.clientLime.theme.${id}`,theme),{id:pilotId,theme})
  const source=restTimerWorkout(); source.startedAt='2026-10-21T08:58:00Z'
  const target=source.exercises[0]!.sets[0]!
  target.confirmedAt='2026-10-21T08:59:00Z';target.fact={weightKg:30,reps:10}
  const backend=await mockPilot(page,{role:'client',profileId:pilotId,clientLime:true,workouts:[source]})
  const commands: {operationId:string;expectedSetVersion:number}[]=[]
  await page.route('**/v1/workout-sets/*',async route=>{
    if(route.request().method()!=='DELETE')return route.fallback()
    commands.push(route.request().postDataJSON() as { operationId: string; expectedSetVersion: number })
    if(commands.length===1){
      const current=backend.getWorkouts()[0]!, exercise=current.exercises[0]!
      if(failure==='lost'){
        exercise.sets=exercise.sets.filter(set=>set.id!==target.id).map((set,position)=>({...set,position}));current.version+=1
        return route.abort('connectionreset')
      }
      if(failure==='retry')return route.fulfill({status:503,json:{error:'unavailable'}})
      const changed=exercise.sets.find(set=>set.id===target.id)!;changed.version+=1;changed.fact={weightKg:42.5,reps:8}
      // root.version deliberately unchanged, just like a real fact save.
    }
    return route.fallback()
  })
  await page.goto(`/workouts/${workoutId}/live`)
  const row=page.locator(`form[data-live-set-id="${target.id}"]`)
  const gesture=await beginClientGesture(page,row,browserName,row.locator('.live-set-number'));await gesture.move(60);await gesture.end()
  await row.getByRole('button',{name:/Удалить подход 1:/}).click()
  await page.getByRole('alertdialog').getByRole('button',{name:'Удалить',exact:true}).click()
  const retry=page.getByRole('button',{name:'Повторить удаление подхода',exact:true})
  if(failure==='changed'){
    await expect(row.getByLabel('Фактический вес',{exact:true})).toHaveValue('42.5')
    await expect(retry).toBeDisabled();expect(commands).toHaveLength(1)
    await expect(row).toHaveClass(/confirmed/)
    // A stale approval must stop, but a fresh explicit approval can recover.
    const freshVersion=backend.getWorkouts()[0]!.exercises[0]!.sets[0]!.version
    const again=await beginClientGesture(page,row,browserName,row.locator('.live-set-number'));await again.move(60);await again.end()
    await row.getByRole('button',{name:/Удалить подход 1:/}).click()
    await expect(page.getByRole('alertdialog')).toContainText('Выполненный результат')
    await page.getByRole('alertdialog').getByRole('button',{name:'Удалить',exact:true}).click()
    await expect(row).toHaveCount(0)
    expect(commands).toHaveLength(2)
    expect(commands[1]!.expectedSetVersion).toBe(freshVersion)
    expect(commands[1]!.operationId).not.toBe(commands[0]!.operationId)
  }else{
    if(failure==='retry'){
      await expect(retry).toBeEnabled();await retry.click()
      await expect.poll(() => commands.length).toBe(2);expect(commands[1]!.operationId).toBe(commands[0]!.operationId)
      expect(commands[1]!.expectedSetVersion).toBe(commands[0]!.expectedSetVersion)
    }
    await expect(row).toHaveCount(0);await expect(retry).toHaveCount(0)
    expect(backend.getWorkouts()[0]!.exercises[0]!.sets).toHaveLength(1)
    await page.reload();await expect(row).toHaveCount(0)
    expect(commands).toHaveLength(failure==='lost'?1:2)
  }
})

// Duration uses a focusable time picker; distance adds an editable unit field.
// Their different widths/focus targets caused the WebKit phantom-save race.
for (const theme of ['light','dark']) for (const density of ['original','compact']) for (const kind of ['duration','distance'] as const) for (const width of [390,430]) test(`client confirmed cardio swipe preserves sibling facts ${theme} ${density} ${kind} ${width}`, async ({page,browserName}) => {
  await page.clock.install({time:new Date('2026-10-21T09:00:00Z')})
  await page.setViewportSize({width,height:844})
  await page.addInitScript(({id,theme,density})=>{localStorage.setItem(`fit.clientLime.theme.${id}`,theme);localStorage.setItem(`fit.clientLiveDensity.${id}`,density)}, {id:pilotId,theme,density})
  const source=restTimerWorkout(0,true);source.startedAt='2026-10-21T08:58:00Z'
  const exercise=source.exercises[0]!
  exercise.inputKind=kind;exercise.ref=kind==='distance'?'walking':'plank';exercise.name=kind==='distance'?'Ходьба':'Планка'
  exercise.sets=exercise.sets.map((set,index)=>({...set,durationMin:0,durationSec:30,...(kind==='distance'?{distanceKm:1}:{}),fact:{durationMin:0,durationSec:index===0?45:20,...(kind==='distance'?{distanceKm:index===0?1.2:0.8}:{})},confirmedAt:index===0?'2026-10-21T08:59:00Z':null}))
  const target=exercise.sets[0]!,other=exercise.sets[1]!,sibling=JSON.stringify(other.fact)
  const writes:string[]=[]
  page.on('request',request=>{if(request.url().includes('workout-sets')&&request.method()!=='GET')writes.push(request.method())})
  const backend=await mockPilot(page,{role:'client',profileId:pilotId,clientLime:true,workouts:[source]})
  await page.goto(`/workouts/${workoutId}/live`)
  const row=page.locator(`form[data-live-set-id="${target.id}"]`)
  await expect(row).toHaveClass(/confirmed/)
  const gesture=await beginClientGesture(page,row,browserName,row.locator('.live-set-number'));await gesture.move(60);await gesture.end()
  await row.getByRole('button',{name:/Удалить подход 1:/}).click()
  await expect(page.getByRole('alertdialog')).toContainText('Выполненный результат')
  await page.getByRole('alertdialog').getByRole('button',{name:'Удалить',exact:true}).click()
  await expect(row).toHaveCount(0)
  expect(writes).toEqual(['DELETE'])
  const remaining=backend.getWorkouts()[0]!.exercises[0]!.sets
  expect(remaining).toHaveLength(1);expect(remaining[0]!.id).toBe(other.id);expect(JSON.stringify(remaining[0]!.fact)).toBe(sibling)
  await expect(page.locator(`form[data-live-set-id="${other.id}"] .workout-swipe-action`)).toHaveCount(0)
  await page.reload();await expect(row).toHaveCount(0)
  expect(JSON.stringify(backend.getWorkouts()[0]!.exercises[0]!.sets[0]!.fact)).toBe(sibling)
})

for(const theme of ['light','dark']) for(const kind of ['duration','distance'] as const) test(`client cardio swipe cancel never records planned facts ${theme} ${kind}`,async({page,browserName})=>{
  await page.clock.install({time:new Date('2026-10-21T09:00:00Z')})
  await page.setViewportSize({width:theme==='light'?390:430,height:844})
  await page.addInitScript(({id,theme})=>{localStorage.setItem(`fit.clientLime.theme.${id}`,theme);localStorage.setItem(`fit.clientLiveDensity.${id}`,'compact')},{id:pilotId,theme})
  const source=restTimerWorkout(0,true);source.startedAt='2026-10-21T08:58:00Z'
  const exercise=source.exercises[0]!
  exercise.inputKind=kind;exercise.ref=kind==='distance'?'walking':'plank';exercise.name=kind==='distance'?'Ходьба':'Планка'
  exercise.sets=exercise.sets.map(set=>({...set,durationSec:30,...(kind==='distance'?{distanceKm:1}:{}),fact:{},confirmedAt:null}))
  const target=exercise.sets[0]!,writes:string[]=[]
  page.on('request',request=>{if(request.url().includes('workout-sets')&&request.method()!=='GET')writes.push(request.method())})
  const backend=await mockPilot(page,{role:'client',profileId:pilotId,clientLime:true,workouts:[source]})
  await page.goto(`/workouts/${workoutId}/live`)
  const row=page.locator(`form[data-live-set-id="${target.id}"]`)
  const swipe=async()=>{const gesture=await beginClientGesture(page,row,browserName,row.locator('.live-set-number'));await gesture.move(60);await gesture.end();await row.getByRole('button',{name:/Удалить подход 1:/}).click()}
  await swipe();await page.getByRole('alertdialog').getByRole('button',{name:'Отмена',exact:true}).click()
  expect(writes).toEqual([]);expect(backend.getWorkouts()[0]!.exercises[0]!.sets.map(set=>set.fact)).toEqual([{},{}])
  await swipe();await page.getByRole('alertdialog').getByRole('button',{name:'Удалить',exact:true}).click()
  await expect(row).toHaveCount(0);expect(writes).toEqual(['DELETE'])
  expect(backend.getWorkouts()[0]!.exercises[0]!.sets[0]!.fact).toEqual({})
  expect(backend.getWorkouts()[0]!.exercises[0]!.sets[0]!.confirmedAt).toBeNull()
})

for (const theme of ['light', 'dark']) test(`client priority controls retain standard geometry and resume behavior ${theme}`, async ({ page }, info) => {
  await page.addInitScript(({ id, theme }) => localStorage.setItem(`fit.clientLime.theme.${id}`, theme), { id: pilotId, theme })
  const active = coachGestureWorkout()
  active.startedAt = new Date(Date.now() - 90000).toISOString()
  const planned = { ...structuredClone(active), id: newWorkoutId, status: 'planned', startedAt: null, createdBy: pilotId,
    stageId: '10000000-0000-4000-8000-000000000041' }
  const backend = await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, withGoal: true, workouts: [active, planned] })
  for (const width of [390, 430]) {
    await page.setViewportSize({ width, height: 844 })
    await page.goto(`/workouts/${workoutId}`)
    const resume = page.getByRole('link', { name: 'Продолжить тренировку', exact: true })
    await expect(resume).toBeVisible()
    await page.evaluate(async () => { await document.fonts.ready })
    const geometry = await resume.evaluate(button => {
      const rect = button.getBoundingClientRect(), page = button.closest('main')!, parent = page.getBoundingClientRect(), styles = getComputedStyle(page)
      return { height: rect.height, width: rect.width, available: parent.width - parseFloat(styles.paddingLeft) - parseFloat(styles.paddingRight) }
    })
    await page.screenshot({ path: info.outputPath(`resume-${width}.png`) })
    expect.soft(geometry.height).toBeGreaterThanOrEqual(48)
    expect.soft(Math.abs(geometry.width - geometry.available)).toBeLessThan(1)
    await resume.click()
    await expect(page).toHaveURL(new RegExp(`/workouts/${workoutId}/live$`))
    expect(backend.getWorkouts()[0]!.startedAt).toBe(active.startedAt)
    expect(backend.getWorkouts()[0]!.status).toBe('in_progress')
    await page.goto(`/workouts/${newWorkoutId}/edit`)
    const stage = page.locator('select[name="stageId"]')
    await expect(stage).toHaveValue(planned.stageId)
    await expect(stage).toHaveCSS('border-radius', '16px')
    await expect(stage).toHaveCSS('appearance', 'none')
    const stageBox = await stage.boundingBox()
    expect.soft(stageBox!.height).toBeGreaterThanOrEqual(48)
    expect.soft(stageBox!.height).toBeLessThanOrEqual(49)
    await stage.scrollIntoViewIfNeeded()
    await page.screenshot({ path: info.outputPath(`stage-${width}.png`) })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
})

for (const theme of ['light', 'dark']) test(`client goal stage clear persists through save failure and reload ${theme}`, async ({ page }, info) => {
  await page.addInitScript(({ id, theme }) => localStorage.setItem(`fit.clientLime.theme.${id}`, theme), { id: pilotId, theme })
  const stageA = '10000000-0000-4000-8000-000000000041', stageB = '10000000-0000-4000-8000-000000000042'
  const source = { ...coachGestureWorkout(), createdBy: pilotId, status: 'planned', startedAt: null, stageId: stageA as string | null }
  const backend = await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, withGoal: true, workouts: [source] })
  await page.route(`**/v1/clients/${clientId}/progress`, route => route.fulfill({ json: { entries: [], customMetrics: [], goal: {
    id: '10000000-0000-4000-8000-000000000040', clientId, title: 'Цель', targetDate: '2026-12-31', status: 'active', version: 1, criteria: [],
    stages: [{ id: stageA, goalId: '10000000-0000-4000-8000-000000000040', title: 'База', startsOn: '2026-09-01', endsOn: '2026-11-01', position: 0, version: 1 },
      { id: stageB, goalId: '10000000-0000-4000-8000-000000000040', title: 'Развитие', startsOn: '2026-11-02', endsOn: '2026-12-31', position: 1, version: 1 }],
  } } }))
  const writes: Array<string | null> = []
  let failSave = true
  await page.route(`**/v1/workouts/${workoutId}`, route => {
    if (route.request().method() !== 'PUT') return route.fallback()
    const draft = route.request().postDataJSON() as { stageId: string | null }
    writes.push(draft.stageId)
    if (failSave) return route.fulfill({ status: 503, json: { error: 'unavailable' } })
    const stored = backend.getWorkouts()[0]! as typeof source
    stored.stageId = draft.stageId; stored.version += 1
    return route.fulfill({ json: { workout: { id: workoutId } } })
  })
  for (const width of [390, 430]) {
    await page.setViewportSize({ width, height: 844 })
    await page.goto(`/workouts/${workoutId}/edit`)
    const stage = page.locator('select[name="stageId"]'), save = page.getByRole('button', { name: 'Сохранить план', exact: true })
    await expect(stage).toHaveValue(width === 390 ? stageA : stageB)
    await stage.selectOption('')
    await expect(stage).toHaveValue('')
    failSave = true; await save.click()
    await expect(page.locator('.request-error-inline')).toContainText('Введённые данные остались в форме')
    await expect(stage).toHaveValue('')
    expect(writes.at(-1)).toBeNull()
    await stage.evaluate(el => el.scrollIntoView({ block: 'center' })); await page.screenshot({ path: info.outputPath(`stage-clear-failure-${width}.png`) })
    failSave = false; await save.click()
    await expect(page).toHaveURL(new RegExp(`/workouts/${workoutId}$`))
    expect((backend.getWorkouts()[0]! as typeof source).stageId).toBeNull()
    await page.goto(`/workouts/${workoutId}/edit`); await page.reload()
    await expect(stage).toHaveValue('')
    await stage.selectOption(stageB); await save.click()
    await expect(page).toHaveURL(new RegExp(`/workouts/${workoutId}$`))
    await page.goto(`/workouts/${workoutId}/edit`); await page.reload()
    await expect(stage).toHaveValue(stageB)
  }
})

for (const theme of ['light', 'dark']) test(`client goal stage intentional empty survives draft restore ${theme}`, async ({ page }) => {
  await page.addInitScript(({ id, theme }) => localStorage.setItem(`fit.clientLime.theme.${id}`, theme), { id: pilotId, theme })
  const source = { ...coachGestureWorkout(), createdBy: pilotId, status: 'planned', startedAt: null, stageId: '10000000-0000-4000-8000-000000000041' }
  await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, withGoal: true, workouts: [source] })
  await page.goto(`/workouts/new?copy=${workoutId}`)
  const stage = page.locator('select[name="stageId"]')
  await expect(stage).toHaveValue(source.stageId)
  await stage.selectOption(''); await expect(stage).toHaveValue('')
  const savedStage = () => page.evaluate(({ id, sourceId }) => {
    const draft: unknown = JSON.parse(localStorage.getItem(`fit.workout-form-draft.${id}.${sourceId}`) ?? '{}')
    return draft && typeof draft === 'object' && 'stageId' in draft ? draft.stageId : undefined
  }, { id: pilotId, sourceId: workoutId })
  await expect.poll(savedStage).toBe('')
  await page.reload(); await expect(stage).toHaveValue('')
  await stage.selectOption(source.stageId); await expect.poll(savedStage).toBe(source.stageId)
  await page.reload(); await expect(stage).toHaveValue(source.stageId)
})

for (const theme of ['light', 'dark']) test(`client goal stage awaits initial goal before writing a fresh draft ${theme}`, async ({ page }) => {
  await page.clock.install({ time: new Date('2026-09-24T09:00:00Z') })
  await page.addInitScript(({ id, theme }) => localStorage.setItem(`fit.clientLime.theme.${id}`, theme), { id: pilotId, theme })
  await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, withGoal: true })
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.route(`**/v1/clients/${clientId}/progress`, async route => { await gate; return route.fallback() })
  await page.goto('/workouts/new')
  const save = page.getByRole('button', { name: 'Сохранить план', exact: true })
  await expect(save).toBeDisabled()
  const savedStage = () => page.evaluate(id => {
    const draft: unknown = JSON.parse(localStorage.getItem(`fit.workout-form-draft.${id}.new--`) ?? '{}')
    return draft && typeof draft === 'object' && 'stageId' in draft ? draft.stageId : undefined
  }, pilotId)
  expect(await savedStage()).toBeUndefined()
  release()
  const stage = page.locator('select[name="stageId"]')
  await expect(stage).toHaveValue('10000000-0000-4000-8000-000000000041')
  await expect(stage).toBeEnabled()
  await expect.poll(savedStage).toBe('10000000-0000-4000-8000-000000000041')
  await stage.selectOption(''); await expect(stage).toHaveValue('')
  await expect.poll(savedStage).toBe('')
  await page.reload(); await expect(stage).toHaveValue('')
})

for (const theme of ['light', 'dark']) test(`client goal delay never clears existing time and plan fields ${theme}`, async ({ page }) => {
  await page.addInitScript(({ id, theme }) => localStorage.setItem(`fit.clientLime.theme.${id}`, theme), { id: pilotId, theme })
  const source = { ...coachGestureWorkout(), createdBy: pilotId, status: 'planned', startedAt: null, stageId: '10000000-0000-4000-8000-000000000041', notes: 'План сохранить', prepSeconds: 15 }
  await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, withGoal: true, workouts: [source] })
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.route(`**/v1/clients/${clientId}/progress`, async route => { await gate; return route.fallback() })
  const writes: Array<{ startTime: string; endTime: string; stageId: string; notes: string; prepSeconds: number; exercises: unknown[] }> = []
  await page.route(`**/v1/workouts/${workoutId}`, route => {
    if (route.request().method() !== 'PUT') return route.fallback()
    writes.push(route.request().postDataJSON() as typeof writes[number])
    return route.fulfill({ status: 503, json: { error: 'unavailable' } })
  })
  await page.goto(`/workouts/${workoutId}/edit`)
  await page.getByRole('button', { name: 'Сохранить план', exact: true }).click()
  await expect.poll(() => writes.length).toBe(1)
  expect(writes[0]).toMatchObject({ startTime: '10:00', endTime: '11:00', notes: 'План сохранить', prepSeconds: 15, stageId: source.stageId })
  expect(writes[0]!.exercises).toHaveLength(source.exercises.length)
  release()
  await expect(page.locator('select[name="stageId"]')).toHaveValue(source.stageId)
})

for (const theme of ['light', 'dark']) for (const outcome of ['failed', 'lost', 'unreadable', 'changed']) test(`client measurement delete recovery ${theme} ${outcome}`, async ({ page }, info) => {
  await page.addInitScript(({ id, theme }) => localStorage.setItem(`fit.clientLime.theme.${id}`, theme), { id: pilotId, theme })
  await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, withMeasurements: true })
  let rows = [{ id: '10000000-0000-4000-8000-000000000050', clientId, createdBy: pilotId, recordedOn: '2026-09-24', weightKg: 70,
    chestCm: null, waistCm: null, hipCm: null, notes: null, customMetrics: [], version: 1 }]
  const traffic: string[] = []; let deletes = 0, failRead = false
  await page.route(`**/v1/clients/${clientId}/progress`, route => {
    traffic.push('GET')
    return failRead ? route.fulfill({ status: 503, json: { error: 'unavailable' } }) : route.fulfill({ json: { entries: rows, customMetrics: [], goal: null } })
  })
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.route('**/v1/progress/10000000-0000-4000-8000-000000000050', async route => {
    if (route.request().method() !== 'DELETE') return route.fallback()
    deletes++; traffic.push('DELETE')
    const request = route.request().postDataJSON() as { expectedVersion: number }
    if (deletes === 1) {
      await gate
      if (outcome === 'lost') { rows = []; return route.abort('connectionreset') }
      if (outcome === 'unreadable') failRead = true
      if (outcome === 'changed') rows = rows.map(row => ({ ...row, weightKg: 75, version: 2 }))
      return route.fulfill({ status: 503, json: { error: 'unavailable' } })
    }
    expect(request.expectedVersion).toBe(outcome === 'changed' ? 2 : 1)
    rows = []; return route.fulfill({ json: { progress: { version: request.expectedVersion + 1 } } })
  })
  await page.goto('/me/progress')
  await page.getByRole('button', { name: /^История замеров/ }).click()
  const history = page.locator('.client-progress-history'), error = history.locator('.client-measurement-delete-error')
  await history.getByRole('button', { name: 'Удалить', exact: true }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Удалить', exact: true }).click()
  await expect.poll(() => deletes).toBe(1)
  await expect(history.getByRole('button', { name: 'Удалить', exact: true })).toBeDisabled()
  release()
  if (outcome === 'lost') {
    await expect(history.locator('article.card')).toHaveCount(0)
    await expect(error).toHaveCount(0); expect(deletes).toBe(1)
    expect(traffic.slice(traffic.lastIndexOf('DELETE') + 1)).toContain('GET')
    return
  }
  await expect(error.getByRole('alert')).toBeVisible()
  const retry = error.getByRole('button', { name: 'Повторить', exact: true })
  for (const width of [390, 430]) {
    await page.setViewportSize({ width, height: 844 }); await error.evaluate(el => el.scrollIntoView({ block: 'center' }))
    expect((await retry.boundingBox())!.height).toBeGreaterThanOrEqual(48)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: info.outputPath(`delete-error-${width}.png`) })
  }
  if (outcome === 'unreadable') {
    const gets = traffic.filter(item => item === 'GET').length
    await retry.click(); await expect.poll(() => traffic.filter(item => item === 'GET').length).toBeGreaterThan(gets)
    await expect(retry).toBeEnabled(); expect(deletes).toBe(1); failRead = false
  }
  if (outcome === 'changed') {
    await retry.click(); await expect(error).toContainText('Замер изменился')
    expect(deletes).toBe(1)
    await retry.click(); await page.getByRole('alertdialog').getByRole('button', { name: 'Отмена', exact: true }).click()
    expect(deletes).toBe(1)
    await retry.click(); await page.getByRole('alertdialog').getByRole('button', { name: 'Удалить', exact: true }).click()
  } else await retry.click()
  await expect(history.locator('article.card')).toHaveCount(0)
  await expect(error).toHaveCount(0); expect(deletes).toBe(2)
  expect(traffic[traffic.lastIndexOf('DELETE') - 1]).toBe('GET')
  await page.reload(); await expect(page.getByRole('button', { name: /^История замеров/ })).toHaveCount(0)
})

for (const theme of ['light', 'dark']) test(`client body map load retry retains all display preferences ${theme}`, async ({ page }, info) => {
  await page.addInitScript(({ id, theme, clientId }) => {
    localStorage.setItem(`fit.clientLime.theme.${id}`, theme)
    localStorage.setItem(`fit.clientLiveDensity.${id}`, 'compact')
    localStorage.setItem(`fit.liveExerciseAnimation.${id}`, 'false')
    localStorage.setItem(`fit.bodyMapDisplay.v2.client.${id}.${clientId}`, 'list')
  }, { id: pilotId, theme, clientId })
  await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, clientGender: 'male' })
  let fail = true
  await page.route('**/v1/clients', route => fail ? route.fulfill({ status: 503, json: { error: 'unavailable' } }) : route.fallback())
  await page.goto('/me/settings')
  const section = page.locator('.settings-section').filter({ has: page.getByRole('heading', { name: 'Оформление', exact: true }) })
  const error = section.getByRole('alert'), retry = error.getByRole('button', { name: 'Повторить', exact: true })
  await expect(error).toContainText('Вид карты тела')
  await expect(page.getByRole('radio', { name: 'Компактный', exact: true })).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByRole('switch', { name: 'Анимация в Live', exact: true })).not.toBeChecked()
  for (const width of [390, 430]) {
    await page.setViewportSize({ width, height: 844 }); await error.evaluate(el => el.scrollIntoView({ block: 'center' }))
    expect((await retry.boundingBox())!.height).toBeGreaterThanOrEqual(48)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: info.outputPath(`body-map-error-${width}.png`) })
  }
  fail = false; await retry.click()
  await expect(section.getByRole('radio', { name: 'Список', exact: true })).toHaveAttribute('aria-checked', 'true')
  await page.reload(); await expect(section.getByRole('radio', { name: 'Список', exact: true })).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByRole('radio', { name: 'Компактный', exact: true })).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByRole('switch', { name: 'Анимация в Live', exact: true })).not.toBeChecked()
  expect(await page.getByLabel('Тема оформления').inputValue()).toBe(theme)
})

for (const theme of ['light', 'dark']) test(`client body map loading and missing gender keep settings usable ${theme}`, async ({ page }) => {
  await page.addInitScript(({ id, theme }) => localStorage.setItem(`fit.clientLime.theme.${id}`, theme), { id: pilotId, theme })
  await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true })
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.route('**/v1/clients', async route => { await gate; return route.fallback() })
  await page.goto('/me/settings')
  const section = page.locator('.settings-section').filter({ has: page.getByRole('heading', { name: 'Оформление', exact: true }) })
  await expect(section.getByRole('status', { name: 'Загрузка', exact: true })).toBeVisible()
  await expect(page.getByLabel('Тема оформления')).toBeEnabled()
  release()
  const modes = section.getByRole('radiogroup', { name: 'Вид фигуры' })
  await expect(modes.getByRole('radio')).toHaveCount(1)
  await expect(modes.getByRole('radio', { name: 'Список', exact: true })).toHaveAttribute('aria-checked', 'true')
})

for (const theme of ['light', 'dark']) test(`client body map missing profile has existing profile recovery ${theme}`, async ({ page }) => {
  await page.addInitScript(({ id, theme }) => localStorage.setItem(`fit.clientLime.theme.${id}`, theme), { id: pilotId, theme })
  await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, hasClients: false })
  await page.goto('/me/settings')
  const section = page.locator('.settings-section').filter({ has: page.getByRole('heading', { name: 'Оформление', exact: true }) })
  await expect(section.getByRole('link', { name: 'Заполнить профиль', exact: true })).toHaveAttribute('href', '/me/edit')
  await expect(page.getByLabel('Тема оформления')).toBeEnabled()
  await expect(section.getByRole('radiogroup')).toHaveCount(0)
})

test('client priority error handling stays outside other client accounts', async ({ page }) => {
  await mockPilot(page, { role: 'client', profileId: 'c11e0000-6010-4000-8000-000000000002', clientLime: true, withMeasurements: true })
  await page.route('**/v1/progress/*', route => route.request().method() === 'DELETE' ? route.fulfill({ status: 503, json: { error: 'unavailable' } }) : route.fallback())
  await page.goto('/me/progress')
  await page.getByRole('button', { name: /^История замеров/ }).click()
  const history = page.locator('.client-progress-history')
  await history.getByRole('button', { name: 'Удалить', exact: true }).click()
  const failed = page.waitForResponse(response => response.request().method() === 'DELETE' && response.status() === 503)
  await page.getByRole('alertdialog').getByRole('button', { name: 'Удалить', exact: true }).click(); await failed
  await expect(history.locator('.client-measurement-delete-error')).toHaveCount(0)
  await page.route('**/v1/clients', route => route.fulfill({ status: 503, json: { error: 'unavailable' } }))
  await page.goto('/me/settings'); await page.reload()
  const section = page.locator('.settings-section').filter({ has: page.getByRole('heading', { name: 'Оформление', exact: true }) })
  await expect(section.getByText('Вид карты тела недоступен', { exact: true })).toHaveCount(0)
  await expect(page.locator('.client-workout-reference')).toHaveCount(0)
})

for (const theme of ['light', 'dark']) test(`client custom photo survives failures and reload ${theme}`, async ({ page }, info) => {
  await page.addInitScript(({ id, theme }) => localStorage.setItem(`fit.clientLime.theme.${id}`, theme), { id: pilotId, theme })
  await mockPilot(page, { role: 'client', profileId: pilotId, clientLime: true, workouts: [] })
  let saved: Record<string, unknown> | undefined
  let imageUrl = '', lostReply = true, signingFailure = true
  const attempts: string[] = []
  await page.route('**/v1/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname
    if (path === '/v1/custom-exercises/with-photo') {
      const body = request.postDataJSON() as { id: string; draft: object; image: { dataUrl: string; width: number; height: number; sizeBytes: number } }
      attempts.push(body.id); imageUrl = body.image.dataUrl
      saved = { ...body.draft, id: body.id, createdBy: pilotId, archivedAt: null, version: 1,
        image: { path: `${pilotId}/${body.id}/${'a'.repeat(64)}.jpg`, mimeType: 'image/jpeg', width: body.image.width, height: body.image.height, sizeBytes: body.image.sizeBytes, sha256: 'a'.repeat(64) } }
      if (lostReply) { lostReply = false; return route.fulfill({ status: 503, json: { error: 'service_unavailable' } }) }
      return route.fulfill({ status: 201, json: { exercise: saved } })
    }
    if (/^\/v1\/custom-exercises\/[^/]+\/photo$/.test(path)) {
      if (signingFailure) { signingFailure = false; return route.fulfill({ status: 503, json: { error: 'service_unavailable' } }) }
      return route.fulfill({ json: { url: imageUrl } })
    }
    if (path === '/v1/training-data' && saved) return route.fulfill({ json: { accessMode: 'read_only', customExercises: [saved], workouts: [], attention: [], attentionPreferences: [], hasMoreWorkouts: false, totalWorkouts: 0 } })
    return route.fallback()
  })
  await page.goto('/workouts/new')
  await page.getByRole('button', { name: 'Выбрать упражнения', exact: true }).click()
  const picker = page.getByRole('dialog', { name: 'Добавить упражнение', exact: true })
  for (const width of [390, 430]) {
    await page.setViewportSize({ width, height: 844 })
    saved = undefined; lostReply = signingFailure = true; attempts.splice(0)
    await picker.getByRole('button', { name: 'Создать упражнение', exact: true }).click()
    const name = `Собственное упражнение с фото ${width}`
    await picker.getByLabel('Название', { exact: true }).fill(name)
    await picker.locator('.picker-categories').getByRole('button', { name: 'Грудь', exact: true }).click()
    const source = await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 8
      const context = canvas.getContext('2d')!; context.fillStyle = '#b8f44a'; context.fillRect(0, 0, 8, 8)
      return canvas.toDataURL('image/png')
    })
    await picker.getByLabel('Выбрать фото', { exact: true }).setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from(source.split(',')[1]!, 'base64') })
    const submit = picker.getByRole('button', { name: 'Сохранить упражнение', exact: true })
    await expect(picker.getByRole('img', { name: 'Фото упражнения', exact: true })).toBeVisible()
    for (let failure = 0; failure < 2; failure++) {
      await submit.click(); await expect(picker.locator('.error')).toBeVisible(); await expect(submit).toBeEnabled()
      await expect(picker.getByLabel('Название', { exact: true })).toHaveValue(name)
      await expect(picker.getByRole('img', { name: 'Фото упражнения', exact: true })).toBeVisible()
    }
    await page.screenshot({ path: info.outputPath(`photo-retained-${width}.png`) })
    await submit.click(); await expect(picker.getByLabel('Название', { exact: true })).toHaveCount(0)
    expect(attempts).toHaveLength(3); expect(new Set(attempts).size).toBe(1)
    await page.reload(); await page.getByRole('button', { name: 'Выбрать упражнения', exact: true }).click()
    await picker.getByRole('textbox', { name: 'Поиск упражнения', exact: true }).fill(name)
    const item = picker.locator('.picker-item').filter({ hasText: name })
    await expect(item).toHaveCount(1)
    const image = item.locator('img').first()
    await expect(image).toBeVisible()
    await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: info.outputPath(`photo-reloaded-${width}.png`) })
  }
})

async function openClientVideo(page: Page, theme: string, width: number) {
  await page.setViewportSize({ width, height: 932 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.addInitScript(({ id, theme }) => localStorage.setItem(`fit.clientLime.theme.${id}`, theme), { id: clientId, theme })
  const source = coachGestureWorkout(false, 1)
  source.startedAt = new Date().toISOString()
  Object.assign(source.exercises[0]!, { ref: 'cat-cow', name: 'Кошка-корова', inputKind: 'duration' })
  await mockPilot(page, { role: 'client', profileId: clientId, clientLime: true, workouts: [source] })
  let available = false
  let signedVideos = 0
  await page.route('**/v1/exercise-media/sign-batch', async route => {
    const { paths } = z.object({ paths: z.array(z.string()) }).parse(route.request().postDataJSON())
    await route.fulfill({ json: { signedUrls: paths.map(path => ({ path, signedUrl: new URL(`/exercises/${path}${path.endsWith('.mp4') ? `?attempt=${++signedVideos}` : ''}`, page.url()).href })) } })
  })
  await page.route('**/exercises/vital-pro/**', async route => {
    if (new URL(route.request().url()).pathname.endsWith('.mp4')) {
      if (!available) await route.fulfill({ status: 503, body: '' })
      else await route.continue({ url: new URL('/exercises/vital/stationary-bike.mp4', route.request().url()).href })
    } else {
      await route.fulfill({ contentType: 'image/gif', body: Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64') })
    }
  })
  await page.goto(`/workouts/${workoutId}/live`)
  await expect(page.locator('.phone-frame')).toHaveClass(/fit-client-lime/)
  return { recover: () => { available = true }, signedVideos: () => signedVideos }
}

test('client technique retries failed video and keeps manual play usable', async ({ page }, info) => {
  const fixture = await openClientVideo(page, 'dark', 390)
  const inline = page.locator('.live-header-animation')
  const inlineRetry = inline.getByRole('button', { name: 'Повторить загрузку видео: Кошка-корова' })
  await expect(inlineRetry).toBeVisible()
  const bounds = (await inlineRetry.boundingBox())!
  expect(bounds.width).toBeGreaterThanOrEqual(44)
  expect(bounds.height).toBeGreaterThanOrEqual(44)
  await inline.screenshot({ path: info.outputPath('client-inline-video-retry.png') })
  await page.getByRole('button', { name: 'Посмотреть технику: Кошка-корова', exact: true }).click()
  const detail = page.getByRole('dialog', { name: 'Техника: Кошка-корова', exact: true })
  await expect(detail.getByText('Видео не загрузилось')).toBeVisible()
  await detail.screenshot({ path: info.outputPath('client-video-error.png') })
  const failedAttempts = fixture.signedVideos()
  fixture.recover()
  await detail.getByRole('button', { name: 'Повторить загрузку видео: Кошка-корова' }).click()
  const video = detail.locator('video')
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => !element.paused)).toBe(true)
  expect(fixture.signedVideos()).toBeGreaterThan(failedAttempts)
  await expect(detail.getByText('Видео не загрузилось')).toHaveCount(0)
  await expect(detail.getByRole('button', { name: 'Запустить анимацию: Кошка-корова' })).toHaveCount(0)
  await video.evaluate((element: HTMLVideoElement) => element.pause())
  const play = detail.getByRole('button', { name: 'Запустить анимацию: Кошка-корова' })
  await expect(play).toBeVisible()
  await play.click()
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(0)
  await expect(play).toHaveCount(0)
  await detail.screenshot({ path: info.outputPath('client-video-playing.png') })
  await detail.getByRole('button', { name: 'Закрыть технику' }).click()
  await expect(detail).toHaveCount(0)
  await expect(inlineRetry).toBeVisible()
  await inlineRetry.click()
  await expect.poll(() => inline.locator('video').evaluate((element: HTMLVideoElement) => !element.paused)).toBe(true)
})

// Themes and widths cover token contrast and wrapping only; recovery runs once above.
for (const sample of [{ width: 390, theme: 'light' }, { width: 430, theme: 'light' }, { width: 430, theme: 'dark' }]) {
  test(`client video error fits Lime ${sample.theme} ${sample.width}`, async ({ page }, info) => {
    await openClientVideo(page, sample.theme, sample.width)
    await page.getByRole('button', { name: 'Посмотреть технику: Кошка-корова', exact: true }).click()
    const detail = page.getByRole('dialog', { name: 'Техника: Кошка-корова', exact: true })
    const retry = detail.getByRole('button', { name: 'Повторить загрузку видео: Кошка-корова' })
    await expect(retry).toBeVisible()
    expect(await retry.evaluate(element => {
      const bounds = element.getBoundingClientRect(), parent = element.closest('.exercise-image')!.getBoundingClientRect()
      return bounds.height >= 44 && bounds.left >= parent.left && bounds.right <= parent.right && bounds.bottom <= parent.bottom
    })).toBe(true)
    await expect(page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).resolves.toBe(true)
    await detail.screenshot({ path: info.outputPath(`client-video-error-${sample.theme}-${sample.width}.png`) })
  })
}
