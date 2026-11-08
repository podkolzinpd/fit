import { expect, test, type Page } from '@playwright/test'
import { clientId, coachGestureWorkout, mockPilot } from './fit-lime-fixtures'

type Payload = { workouts: Array<Record<string, unknown>>; [key: string]: unknown }
const pageId = (index: number) => `10000000-0000-4000-8000-${String(8000 + index).padStart(12, '0')}`

async function prepare(page: Page) {
  await page.clock.install({ time: new Date('2026-11-08T09:00:00Z') })
  await page.route('**/v1/**', route => route.abort())
  // Use the same admitted synthetic coach in CI and local pilot mode.
  const profileId = 'c0ac0000-6010-4000-8000-000000000001'
  const source = coachGestureWorkout(false, 1)
  source.workoutDate = '2026-11-08'
  source.trainerId = profileId
  source.createdBy = profileId
  await mockPilot(page, { profileId, fitLime: true, workouts: [source] })
  const response = page.waitForResponse(response => response.url().includes('/v1/training-data?')
    && new URL(response.url()).searchParams.get('scope') === 'workouts')
  await page.goto('/today?week=2026-11-02&range=2w')
  const payload = await (await response).json() as Payload
  await expect(page.locator('.skeleton-stack')).toHaveCount(0)
  await expect(page.locator('.coach-calendar-navigation')).toBeVisible()
  return payload
}
async function listReads(page: Page, handler: (offset: number) => Promise<Payload>) {
  const offsets: number[] = []
  const ranges: Array<string | null> = []
  await page.route('**/v1/training-data?*', async route => {
    const query = new URL(route.request().url()).searchParams
    if (query.get('scope') !== 'workouts' || query.has('from')) return route.fallback()
    const offset = Number(query.get('offset'))
    offsets.push(offset); ranges.push(query.get('to'))
    await route.fulfill({ json: await handler(offset) })
  })
  return { offsets, ranges }
}
const openList = (page: Page) => page.getByRole('group', { name: 'Вид расписания' }).getByRole('button', { name: 'Список', exact: true }).click()
const rows = (page: Page) => page.locator('.fit-lime-history-row')
function firstPage(payload: Payload): Payload {
  return { ...payload, workouts: Array.from({ length: 100 }, (_, index) => ({ ...payload.workouts[0],
    id: pageId(index), workoutDate: '2025-10-20', status: 'done', trainingFormat: 'with_trainer',
  })), hasMoreWorkouts: true, totalWorkouts: 103 }
}
export function trainerScheduleListCases() {
  // The loading/deadline path differs between WebKit and Chromium. Themes and
  // sizes do not change pagination or filters, so are not multiplied here.
  test('list shows received pages immediately and preserves all dates, filters and navigation', async ({ page }) => {
    const payload = await prepare(page)
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const last = { ...payload, hasMoreWorkouts: false, totalWorkouts: 103, workouts: [
      { ...payload.workouts[0], id: pageId(100), workoutDate: '2024-01-01', status: 'planned', trainingFormat: 'with_trainer' },
      { ...payload.workouts[0], id: pageId(101), workoutDate: '2024-01-01', status: 'planned', trainingFormat: 'self' },
      { ...payload.workouts[0], id: pageId(102), workoutDate: '2024-01-01', status: 'planned', trainingFormat: 'with_trainer', clientId: pageId(200) },
    ] }
    const reads = await listReads(page, async offset => { if (!offset) return firstPage(payload); await gate; return last })
    await openList(page)
    await expect(rows(page)).toHaveCount(100)
    await expect(page.getByText('Все даты · Загружено: 100', { exact: true })).toBeVisible()
    await page.locator('.coach-schedule-filter-options > summary').click()
    await page.getByLabel('Фильтр по клиенту').selectOption(clientId)
    await page.getByLabel('Фильтр по статусу').selectOption('planned')
    await expect(rows(page)).toHaveCount(0)
    await expect(page.getByText('По этим фильтрам тренировок нет.', { exact: true })).toHaveCount(0)
    release()
    await expect(rows(page)).toHaveCount(1)
    await expect(page.getByText('Все даты · Найдено: 1', { exact: true })).toBeVisible()
    await expect(rows(page).first()).toHaveAttribute('href', `/workouts/${pageId(100)}`)
    await page.getByRole('checkbox', { name: 'Показывать самостоятельные тренировки' }).check()
    await expect(rows(page)).toHaveCount(2)
    await page.getByLabel('Фильтр по статусу').selectOption('done')
    await expect(rows(page)).toHaveCount(100)
    await page.locator('.coach-schedule-filter-options > summary').click()
    await page.getByRole('button', { name: 'Неделя', exact: true }).click()
    await openList(page)
    await expect(page.getByText('Все даты · Найдено: 100', { exact: true })).toBeVisible()
    await page.reload()
    await expect(page).toHaveURL(/mode=list/)
    await expect(page.getByText('Все даты · Найдено: 100', { exact: true })).toBeVisible()
    await page.locator('.coach-schedule-filter-options > summary').click()
    await expect(page.getByLabel('Фильтр по клиенту')).toHaveValue(clientId)
    await expect(page.getByLabel('Фильтр по статусу')).toHaveValue('done')
    await expect(page.getByRole('checkbox', { name: 'Показывать самостоятельные тренировки' })).toBeChecked()
    expect(reads.ranges.every(range => range === null)).toBe(true)
    expect(reads.offsets.slice(-2)).toEqual([0, 100])
  })

  test('first list request times out and retry opens the list', async ({ page }) => {
    const payload = await prepare(page)
    let attempts = 0
    await listReads(page, async () => { if (++attempts === 1) return new Promise<Payload>(() => {}); return payload })
    await openList(page)
    await expect(page.getByRole('status', { name: 'Загрузка', exact: true })).toBeVisible()
    await page.clock.fastForward(15_000)
    await expect(page.getByRole('heading', { name: 'Не удалось загрузить данные', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Повторить', exact: true }).click()
    await expect(rows(page)).toHaveCount(1)
    expect(attempts).toBe(2)
  })

  test('later page timeout retains rows and retry requests only the missing page', async ({ page }) => {
    const payload = await prepare(page)
    let laterAttempts = 0
    const reads = await listReads(page, async offset => {
      if (!offset) return firstPage(payload)
      if (++laterAttempts === 1) return new Promise<Payload>(() => {})
      return { ...payload, totalWorkouts: 101 }
    })
    await openList(page)
    await expect(rows(page)).toHaveCount(100)
    await expect.poll(() => reads.offsets).toEqual([0, 100])
    await page.clock.fastForward(15_000)
    await expect(page.getByText('Не удалось загрузить тренировки.', { exact: true })).toBeVisible()
    await expect(rows(page)).toHaveCount(100)
    await page.getByRole('button', { name: 'Повторить', exact: true }).click()
    await expect(rows(page)).toHaveCount(101)
    expect(reads.offsets).toEqual([0, 100, 100])
  })

  test('failed refresh keeps the cached list and retry refreshes it', async ({ page }) => {
    const payload = await prepare(page)
    let attempts = 0
    await listReads(page, () => {
      attempts++
      if (attempts === 2) return new Promise<Payload>(() => {})
      return Promise.resolve(attempts === 1 ? payload : { ...payload, totalWorkouts: 2,
        workouts: [...payload.workouts, { ...payload.workouts[0], id: pageId(300) }] })
    })
    await openList(page)
    await expect(rows(page)).toHaveCount(1)
    await page.getByRole('button', { name: 'Неделя', exact: true }).click()
    await page.clock.fastForward(20_001)
    await openList(page)
    await expect.poll(() => attempts).toBe(2)
    await expect(rows(page)).toHaveCount(1)
    await page.clock.fastForward(15_000)
    await expect(page.locator('.request-error-inline')).toBeVisible()
    await page.getByRole('button', { name: 'Повторить', exact: true }).click()
    await expect(rows(page)).toHaveCount(2)
    expect(attempts).toBe(3)
  })

  test('empty list finishes without another page or a permanent loader', async ({ page }) => {
    const payload = await prepare(page)
    const reads = await listReads(page, () => Promise.resolve({ ...payload, workouts: [], hasMoreWorkouts: false, totalWorkouts: 0 }))
    await openList(page)
    await expect(page.getByText('По этим фильтрам тренировок нет.', { exact: true })).toBeVisible()
    expect(reads.offsets).toEqual([0])
    await expect(page.getByRole('status', { name: 'Загрузка', exact: true })).toHaveCount(0)
  })
}
