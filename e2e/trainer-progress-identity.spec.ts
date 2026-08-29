import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'

const demoClientId = '11111111-1111-4111-8111-111111111111'

async function signInPreviewTrainer(page: import('@playwright/test').Page) {
  await page.goto('/auth')
  await page.getByLabel('Email').fill('trainer@fit.local')
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page).toHaveURL(/\/(today|clients)$/)
}

test('trainer without monochrome preview keeps current Progress identity', async ({ page }) => {
  await page.goto('/auth')
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await page.getByLabel('Тип аккаунта').selectOption('trainer')
  await page.getByLabel('Имя').fill('Progress flag off')
  await page.getByLabel('Email').fill(`progress-flag-off-${randomUUID()}@fit.local`)
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await expect(page).toHaveURL(/\/(today|clients)$/)

  await page.goto(`/progress/${demoClientId}`)
  await expect(page.locator('.phone-frame')).not.toHaveClass(/trainer-progress-identity/)
  await expect(page.locator('html')).not.toHaveClass(/identity-monochrome-preview/)
})

test('trainer Progress preview keeps real summary and measurement controls usable', async ({ page }) => {
  await signInPreviewTrainer(page)
  await page.goto(`/progress/${demoClientId}`)

  await expect(page.locator('.phone-frame')).toHaveClass(/trainer-progress-identity/)
  await expect(page.getByRole('region', { name: 'Тренировки за неделю' })).toBeVisible()
  await expect(page.getByLabel('ИИ-анализ тренировок')).toBeVisible()
  await page.getByRole('link', { name: 'Открыть замеры и показатели' }).click()
  await expect(page).toHaveURL(new RegExp(`/progress/${demoClientId}\\?view=measurements$`))
  await expect(page.locator('.phone-frame')).toHaveClass(/trainer-progress-identity/)
  await expect(page.getByRole('button', { name: 'Добавить замер' })).toBeVisible()
  await page.getByRole('button', { name: 'Добавить замер' }).click()
  await expect(page.getByRole('heading', { name: 'Новый замер' })).toBeVisible()
  await expect(page.getByLabel('Вес, кг')).toBeVisible()
  await page.getByRole('button', { name: 'Отмена' }).click()
  await page.getByRole('button', { name: /История/ }).click()
  await expect(page.getByRole('heading', { name: /История замеров/ })).toBeVisible()
  await page.getByRole('button', { name: 'Настроить показатели' }).click()
  await expect(page.getByRole('heading', { name: 'Показатели замера' })).toBeVisible()
  await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBe(true)
})
