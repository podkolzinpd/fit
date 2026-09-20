import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'

test('global rollout gives a new trainer the Schedule identity', async ({ page }) => {
  await page.goto('/auth')
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await page.getByLabel('Тип аккаунта').selectOption('trainer')
  await page.getByLabel('Имя').fill('Schedule flag off')
  await page.getByLabel('Email').fill(`schedule-flag-off-${randomUUID()}@fit.local`)
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await expect(page).toHaveURL(/\/(today|clients)$/)

  await page.goto('/schedule')
  await expect(page.locator('.phone-frame')).toHaveClass(/trainer-schedule-identity/)
  await expect(page.locator('html')).toHaveClass(/ui-identity/)
})

test('trainer Schedule preview keeps real date controls usable and compact', async ({ page }) => {
  await page.goto('/auth')
  await page.getByLabel('Email').fill('trainer@fit.local')
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page).toHaveURL(/\/(today|clients)$/)
  await page.goto('/schedule')

  await expect(page.locator('.phone-frame')).toHaveClass(/trainer-schedule-identity/)
  await expect(page.locator('.schedule-week-day')).toHaveCount(7)
  await expect(page.getByRole('button', { name: 'Неделя', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: '2 недели', exact: true })).toHaveAttribute('aria-pressed', 'false')
  const firstDayBefore = await page.locator('.schedule-week-day-heading > span').first().innerText()
  await page.getByRole('button', { name: 'Следующая неделя' }).click()
  await expect(page.locator('.schedule-week-day-heading > span').first()).not.toHaveText(firstDayBefore)
  await expect(page.getByRole('button', { name: 'Сегодня' })).toBeEnabled()
  await page.getByRole('button', { name: 'Сегодня' }).click()
  await expect(page.getByRole('button', { name: 'Сегодня' })).toBeDisabled()
  const pairHeights = await page.locator('.schedule-week-day').evaluateAll((days) => days.slice(0, 2).map((day) => day.getBoundingClientRect().height))
  expect(pairHeights[0]).toBe(pairHeights[1])
  expect(pairHeights[0]).toBeGreaterThanOrEqual(148)

  await page.getByRole('button', { name: '2 недели', exact: true }).click()
  await expect(page).toHaveURL(/range=2w/)
  await expect(page.getByRole('button', { name: '2 недели', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.schedule-week-day')).toHaveCount(0)
  await expect(page.locator('.schedule-fortnight-day')).toHaveCount(14)
  const firstFortnightDay = await page.locator('.schedule-fortnight-date').first().innerText()
  await page.getByRole('button', { name: 'Следующие 2 недели' }).click()
  await expect(page.locator('.schedule-fortnight-date').first()).not.toHaveText(firstFortnightDay)
  await page.getByRole('button', { name: 'Сегодня' }).click()
  await expect(page).toHaveURL(/range=2w/)
  const firstWeekHeights = await page.locator('.schedule-fortnight-day').evaluateAll((days) => days.slice(0, 7).map((day) => day.getBoundingClientRect().height))
  expect(new Set(firstWeekHeights.map(Math.round)).size).toBe(1)
  expect(firstWeekHeights[0]).toBeGreaterThanOrEqual(148)
  await page.locator('.schedule-fortnight-day').nth(7).click()
  await expect(page).toHaveURL(/date=.*range=2w/)
  await page.getByRole('button', { name: 'К 2 неделям' }).click()
  await expect(page.locator('.schedule-fortnight-day')).toHaveCount(14)
  await expect(page).toHaveURL(/range=2w/)
  await expect(page.locator('.schedule-fortnight-date').first()).toHaveText(firstFortnightDay)
  await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBe(true)
})

test('trainer two-week Schedule keeps ten workouts visible without an inner scroll', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-09-20T12:00:00+03:00') })
  await page.route('**/rest/v1/rpc/list_workouts', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(Array.from({ length: 10 }, (_, index) => ({
      id: `95000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      trainer_id: '22222222-2222-4222-8222-222222222222',
      client_id: '11111111-1111-4111-8111-111111111111',
      client_name: `Спортсмен ${index + 1}`,
      created_by: '22222222-2222-4222-8222-222222222222',
      started_by: null, completed_by: null,
      workout_date: '2026-09-21',
      start_time: `${String(index + 8).padStart(2, '0')}:00:00`,
      end_time: `${String(index + 9).padStart(2, '0')}:00:00`,
      started_at: null, completed_at: null,
      status: 'planned', notes: null, trainer_review: null, trainer_reaction: null,
      trainer_review_author_id: null, trainer_reviewed_at: null,
      client_comment: null, session_rpe: null, wellbeing: null, discomfort: null,
      has_pr: false, version: 1, stage_id: null, stage_title: null,
      total_count: 10, exercises: [],
    }))),
  }))

  await page.goto('/auth')
  await page.getByLabel('Email').fill('trainer@fit.local')
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page).toHaveURL(/\/(today|clients)$/)
  await page.goto('/schedule?range=2w')

  const denseDay = page.getByRole('button', { name: /Понедельник, 21 сентября, 10 тренировок/ })
  await expect(denseDay.locator('.schedule-fortnight-workout')).toHaveCount(10)
  const overflow = await denseDay.evaluate((day) => ({ clientHeight: day.clientHeight, scrollHeight: day.scrollHeight, overflowY: getComputedStyle(day).overflowY }))
  expect(overflow.scrollHeight).toBeLessThanOrEqual(overflow.clientHeight)
  expect(overflow.overflowY).not.toBe('scroll')
  const secondWeekHeights = await page.locator('.schedule-fortnight-day').evaluateAll((days) => days.slice(7, 14).map((day) => day.getBoundingClientRect().height))
  expect(new Set(secondWeekHeights.map(Math.round)).size).toBe(1)
  await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBe(true)
})

test('trainer day Schedule labels a trainer assignment completed by the athlete', async ({ page }) => {
  await page.goto('/auth')
  await page.getByLabel('Email').fill('trainer@fit.local')
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page).toHaveURL(/\/(today|clients)$/)

  await page.route('**/rest/v1/rpc/list_workouts', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify([{
      id: '95000000-0000-4000-8000-000000000001',
      trainer_id: '22222222-2222-4222-8222-222222222222',
      client_id: '11111111-1111-4111-8111-111111111111',
      client_name: 'Анна Смирнова',
      created_by: '22222222-2222-4222-8222-222222222222',
      started_by: '92000000-0000-4000-8000-000000000029',
      completed_by: '92000000-0000-4000-8000-000000000029',
      workout_date: '2026-09-18',
      start_time: '09:00:00',
      end_time: '10:00:00',
      started_at: '2026-09-18T06:00:00Z',
      completed_at: '2026-09-18T07:00:00Z',
      status: 'done', notes: null, trainer_review: null, trainer_reaction: null,
      trainer_review_author_id: null, trainer_reviewed_at: null,
      client_comment: null, session_rpe: null, wellbeing: null, discomfort: null,
      has_pr: false, version: 3, stage_id: null, stage_title: null,
      total_count: 1, exercises: [],
    }]),
  }))

  await page.goto('/schedule?date=2026-09-18')
  const event = page.locator('.day-grid-event').filter({ hasText: 'Анна Смирнова' })
  await expect(event).toHaveClass(/schedule-event-self-led/)
  await expect(event.locator('.day-grid-event-status')).toHaveText('Самостоятельно')
  await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBe(true)
})
