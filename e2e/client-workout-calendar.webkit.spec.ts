import { expect, test } from '@playwright/test'

const historyRow = {
  id: 'c1000000-0000-4000-8000-000000000001',
  client_id: '11111111-1111-4111-8111-111111111111',
  trainer_id: '22222222-2222-4222-8222-222222222222',
  client_name: 'Анна Смирнова',
  created_by: '92000000-0000-4000-8000-000000000029',
  workout_date: '2026-08-10',
  start_time: '18:00:00',
  end_time: '19:00:00',
  started_at: '2026-08-10T15:00:00Z',
  completed_at: '2026-08-10T16:00:00Z',
  status: 'done',
  notes: null,
  trainer_review: null,
  trainer_reaction: null,
  trainer_review_author_id: null,
  trainer_reviewed_at: null,
  client_comment: null,
  session_rpe: null,
  wellbeing: null,
  discomfort: false,
  has_pr: false,
  stage_id: null,
  stage_title: null,
  version: 1,
  total_count: 1,
  exercises: [],
}

test('client workout month calendar stays usable in iPhone WebKit', async ({ page }) => {
  await page.route('**/rest/v1/rpc/list_workouts', async (route) => {
    const body = route.request().postDataJSON() as { p_from?: string | null; p_to?: string | null }
    const visible = (!body.p_from || historyRow.workout_date >= body.p_from)
      && (!body.p_to || historyRow.workout_date <= body.p_to)
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(visible ? [historyRow] : []) })
  })
  await page.clock.install({ time: new Date('2026-08-16T18:00:00+03:00') })
  await page.goto('/auth')
  await page.getByLabel('Email').fill('client@fit.local')
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page).toHaveURL(/\/me$/)

  await page.goto('/me/workouts')
  await page.getByRole('button', { name: 'Календарь' }).click()
  await expect(page.getByRole('grid', { name: 'История тренировок за Август 2026' })).toBeVisible()
  const day = page.getByRole('button', { name: '10 августа 2026 г., 1 тренировка' })
  await expect(day).toBeVisible()
  await day.click()
  await expect(page.locator('.client-history-calendar-selection')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await expect(page.getByRole('button', { name: 'Список' })).toHaveCSS('min-height', '44px')
})
