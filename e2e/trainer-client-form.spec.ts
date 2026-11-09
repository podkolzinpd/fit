import { nativeCreateConnectedAthlete, nativeSignIn, nativeRegister, nativeEnableLime } from './native-local-fixture'
import { expect, test } from './native-local-fixture'
import { randomUUID } from 'node:crypto'

test('trainer creates a manual card and starts a workout without athlete registration', async ({ page }, info) => {
  await nativeEnableLime(page, 'trainer')
  await page.goto('/auth')
  await nativeRegister(page, { key: `client-form-${randomUUID()}@fit.local`, firstName: 'Manual card trainer', role: 'trainer' })
  await expect(page).toHaveURL(/\/(today|clients)$/)
  await page.goto('/clients')
  await page.getByRole('button', { name: /Добавить(?: спортсмена)?$/ }).click()
  await expect(page.locator('.phone-frame')).toHaveClass(/fit-lime-shell/)
  await page.screenshot({ path: info.outputPath('manual-card-entry-lime.png'), fullPage: true })
  await page.getByRole('link', { name: 'Создать карточку без регистрации' }).click()
  await expect(page).toHaveURL(/\/clients\/new$/)
  await expect(page.getByRole('heading', { name: 'Новый клиент' })).toBeVisible()
  await expect(page.locator('.phone-frame')).toHaveClass(/fit-lime-shell/)
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(page.getByText('Введите имя')).toBeVisible()
  await page.locator('input[name=fullName]').fill('Спортсмен без регистрации')
  await page.getByLabel('Пол').selectOption('male')
  for (const theme of ['light', 'dark']) {
    await page.evaluate(value => { localStorage.setItem('fit.appTheme', value); window.dispatchEvent(new Event('fit-theme-change')) }, theme)
    await page.screenshot({ path: info.outputPath(`manual-card-form-${theme}.png`), fullPage: true })
  }
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Спортсмен без регистрации' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Начать тренировку', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Начать тренировку', exact: true }).click()
  await expect(page.getByRole('group', { name: 'Формат тренировки' })).toBeVisible()
  await page.getByRole('button', { name: 'Начать тренировку', exact: true }).click()
  await expect(page).toHaveURL(/\/workouts\/[^/]+\/live$/)
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
