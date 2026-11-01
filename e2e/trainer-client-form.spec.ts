import { nativeSignIn, nativeRegister } from './native-local-fixture'
import { expect, test } from './native-local-fixture'
import { randomUUID } from 'node:crypto'

test('global rollout gives a new trainer the Client Form identity', async ({ page }) => {
  await page.goto('/auth')
  await nativeRegister(page, { key: `client-form-flag-off-${randomUUID()}@fit.local`, firstName: 'Client form flag off', role: 'trainer' })
  await expect(page).toHaveURL(/\/(today|clients)$/)

  await page.goto('/clients/new')
  await expect(page.locator('.phone-frame')).toHaveClass(/trainer-client-form-identity/)
  await expect(page.locator('html')).toHaveClass(/ui-identity/)
})

test('trainer Client Create keeps existing validation under monochrome preview', async ({ page }) => {
  await page.goto('/auth')
  await nativeSignIn(page, 'trainer@fit.local')
  await expect(page).toHaveURL(/\/(today|clients)$/)
  await page.goto('/clients/new')
  await expect(page.locator('.phone-frame')).toHaveClass(/trainer-client-form-identity/)

  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByText('Введите имя')).toBeVisible()
  await expect(page).toHaveURL(/\/clients\/new$/)
})

test('trainer creates a client without age, height or initial weight', async ({ page }) => {
  const clientName = `Клиент без замеров ${randomUUID().slice(0, 8)}`
  const trainerEmail = `optional-client-fields-${randomUUID()}@fit.local`
  await page.goto('/auth')
  await nativeRegister(page, { key: trainerEmail, firstName: 'Optional fields trainer', role: 'trainer' })
  await expect(page).toHaveURL(/\/(today|clients)$/)

  await page.goto('/clients/new')
  await page.getByLabel('Имя').fill(clientName)
  await page.getByLabel('Пол').selectOption('male')
  await expect(page.getByLabel('Возраст')).toHaveValue('')
  await expect(page.getByLabel('Рост, см')).toHaveValue('')
  await expect(page.getByLabel('Начальный вес, кг')).toHaveValue('')
  await page.getByRole('button', { name: 'Сохранить' }).click()

  await expect(page.getByRole('heading', { name: clientName })).toBeVisible()
})
