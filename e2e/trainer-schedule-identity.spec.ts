import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'

test('trainer without monochrome preview keeps current Schedule identity', async ({ page }) => {
  await page.goto('/auth')
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await page.getByLabel('Тип аккаунта').selectOption('trainer')
  await page.getByLabel('Имя').fill('Schedule flag off')
  await page.getByLabel('Email').fill(`schedule-flag-off-${randomUUID()}@fit.local`)
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await expect(page).toHaveURL(/\/(today|clients)$/)

  await page.goto('/schedule')
  await expect(page.locator('.phone-frame')).not.toHaveClass(/trainer-schedule-identity/)
  await expect(page.locator('html')).not.toHaveClass(/identity-monochrome-preview/)
})

test('trainer Schedule preview keeps real date controls usable and compact', async ({ page }) => {
  await page.goto('/auth')
  await page.getByLabel('Email').fill('trainer@fit.local')
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page).toHaveURL(/\/(today|clients)$/)
  await page.goto('/schedule')

  await expect(page.locator('.phone-frame')).toHaveClass(/trainer-schedule-identity/)
  await expect(page.locator('.week-day')).toHaveCount(7)
  const firstDayBefore = await page.locator('.week-day .day-num').first().innerText()
  await page.getByRole('button', { name: 'Следующая неделя' }).click()
  await expect(page.locator('.week-day .day-num').first()).not.toHaveText(firstDayBefore)
  await expect(page.getByRole('button', { name: 'Сегодня' })).toBeEnabled()
  await page.getByRole('button', { name: 'Сегодня' }).click()
  await expect(page.getByRole('button', { name: 'Сегодня' })).toBeDisabled()
  await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBe(true)
})
