import { expect, test } from '@playwright/test'
import { mockPilot } from './fit-lime-fixtures'

export function workoutLifecycleCases() {
for (const entry of ['start', 'quick-plan', 'full-plan'] as const) test(`Lifecycle P1 inline client creation retains ${entry} context`, { tag: ['@lime-critical'] }, async ({ page }, testInfo) => {
  await page.clock.setFixedTime(new Date('2026-11-01T09:00:00Z'))
  const backend = await mockPilot(page, { profileId: 'c0ac0000-6010-4000-8000-000000000001', fitLime: true, workouts: [] })
  const writes: string[] = []
  page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname.startsWith('/v1/workouts')) writes.push(request.url()) })
  if (entry === 'full-plan') {
    await page.goto('/workouts/new?date=2026-11-03')
    const title = page.getByRole('textbox', { name: 'Название тренировки', exact: true })
    await title.click()
    await expect(title).toBeFocused()
    await title.fill('План нового клиента')
    await expect(title).toHaveValue('План нового клиента')
    await page.getByRole('button', { name: 'Клиент: Выберите клиента', exact: true }).click()
  } else {
    await page.goto('/today?date=2026-11-03')
    await page.getByRole('button', { name: 'Новая тренировка', exact: true }).click()
    await page.getByRole('button', { name: entry === 'start' ? 'Начать сейчас' : 'Запланировать', exact: true }).click()
    if (entry === 'quick-plan') {
      await page.getByRole('textbox', { name: 'Название тренировки', exact: true }).fill('План нового клиента')
      await page.getByRole('button', { name: 'Клиент: Выберите клиента', exact: true }).click()
    }
  }
  const picker = page.getByRole('dialog', { name: 'Выбор клиента', exact: true })
  await picker.getByRole('textbox', { name: 'Поиск клиента' }).fill('Новая спортсменка')
  await expect(picker.getByText('Никого не нашли', { exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath(`lifecycle-p1-${entry}-picker.png`) })
  await picker.getByRole('button', { name: 'Клиент', exact: true }).click()
  await expect(picker.getByRole('textbox', { name: 'Имя нового клиента' })).toHaveValue('Новая спортсменка')
  await picker.getByRole('button', { name: 'К выбору', exact: true }).click()
  await expect(picker.getByRole('textbox', { name: 'Поиск клиента' })).toHaveValue('Новая спортсменка')
  await picker.getByRole('button', { name: 'Клиент', exact: true }).click()
  await picker.getByRole('button', { name: 'Добавить и выбрать', exact: true }).click()
  await expect(picker).toHaveCount(0)
  expect(writes).toHaveLength(0)
  expect(backend.getSaveAttempts()).toBe(0)
  if (entry === 'start') {
    await expect(page.locator('.quick-start-format')).toContainText('Новая спортсменка')
    await expect(page.getByRole('button', { name: 'Начать', exact: true })).toBeVisible()
  } else {
    await expect(page.getByRole('textbox', { name: 'Название тренировки', exact: true })).toHaveValue('План нового клиента')
    await expect(page.getByRole('button', { name: /Клиент: Новая спортсменка/ })).toBeVisible()
  }
  await page.screenshot({ path: testInfo.outputPath(`lifecycle-p1-${entry}.png`) })
})

}
