import { nativeCreateConnectedAthlete, nativeSignIn, nativeRegister } from './native-local-fixture'
import { expect, test } from './native-local-fixture'
import { randomUUID } from 'node:crypto'

test('trainer manual creation route redirects to registration-first connection', async ({ page }) => {
  await page.goto('/auth')
  await nativeRegister(page, { key: `client-form-flag-off-${randomUUID()}@fit.local`, firstName: 'Client form flag off', role: 'trainer' })
  await expect(page).toHaveURL(/\/(today|clients)$/)

  await page.goto('/clients/new')
  await expect(page).toHaveURL(/\/connect$/)
  await expect(page.getByRole('heading', { name: 'Добавить спортсмена' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Пригласить', exact: true })).toBeVisible()
  await expect(page.getByLabel('Имя')).toHaveCount(0)
})

test('trainer connected-client edit keeps existing validation under monochrome preview', async ({ page }) => {
  await page.goto('/auth')
  await nativeSignIn(page, 'trainer@fit.local')
  await expect(page).toHaveURL(/\/(today|clients)$/)
  const athlete = await nativeCreateConnectedAthlete(page, { name: 'Анкета спортсмена' })
  await page.goto(`/clients/${athlete.clientId}/edit`)
  await expect(page.locator('.phone-frame')).toHaveClass(/trainer-client-form-identity/)

  await page.getByLabel('Имя', { exact: true }).fill('')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByText('Введите имя')).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`/clients/${athlete.clientId}/edit$`))
})

test('trainer edits a registered client without requiring age, height or weight', async ({ page }) => {
  const clientName = `Клиент без замеров ${randomUUID().slice(0, 8)}`
  const trainerEmail = `optional-client-fields-${randomUUID()}@fit.local`
  await page.goto('/auth')
  await nativeRegister(page, { key: trainerEmail, firstName: 'Optional fields trainer', role: 'trainer' })
  await expect(page).toHaveURL(/\/(today|clients)$/)

  const athlete = await nativeCreateConnectedAthlete(page, { name: clientName })
  await page.goto(`/clients/${athlete.clientId}/edit`)
  await page.getByLabel('Имя', { exact: true }).fill(clientName)
  await page.getByLabel('Пол').selectOption('male')
  await expect(page.getByLabel('Возраст')).toHaveValue('')
  await expect(page.getByLabel('Рост, см')).toHaveValue('')
  await expect(page.getByLabel('Начальный вес, кг')).toHaveCount(0)
  await page.getByRole('button', { name: 'Сохранить' }).click()

  await expect(page.getByRole('heading', { name: clientName })).toBeVisible()
})
