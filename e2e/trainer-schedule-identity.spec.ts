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
  const firstDayBefore = await page.locator('.schedule-week-day-heading > span').first().innerText()
  await page.getByRole('button', { name: 'Следующая неделя' }).click()
  await expect(page.locator('.schedule-week-day-heading > span').first()).not.toHaveText(firstDayBefore)
  await expect(page.getByRole('button', { name: 'Сегодня' })).toBeEnabled()
  await page.getByRole('button', { name: 'Сегодня' }).click()
  await expect(page.getByRole('button', { name: 'Сегодня' })).toBeDisabled()
  const pairHeights = await page.locator('.schedule-week-day').evaluateAll((days) => days.slice(0, 2).map((day) => day.getBoundingClientRect().height))
  expect(pairHeights[0]).toBe(pairHeights[1])
  expect(pairHeights[0]).toBeGreaterThanOrEqual(148)
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
