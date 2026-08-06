import { expect, test } from '@playwright/test'

test('linked client sees only the published client progress view', async ({ page }) => {
  await page.goto('/auth')
  await page.getByLabel('Email').fill('client@fit.local')
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Войти' }).click()

  await expect(page).toHaveURL(/\/me$/)
  await page.goto('/me/progress')
  await expect(page).toHaveURL(/\/me\/progress$/)
  await expect(page.getByRole('heading', { name: 'Мой прогресс' })).toBeVisible()
  await expect(page.getByText('Твой прогресс', { exact: true })).toBeVisible()
  await expect(page.getByText(/силовые показатели выросли на 25%/)).toBeVisible()
  await expect(page.getByText('Что получилось')).toBeVisible()
  await expect(page.getByText(/причина максимального перерыва/)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Обновить мой прогресс' })).toBeVisible()

  await page.goto('/clients')
  await expect(page).toHaveURL(/\/me$/)
})

test('trainer reviews the client copy separately from internal attention items', async ({ page }) => {
  await page.goto('/auth')
  await page.getByLabel('Email').fill('trainer@fit.local')
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page).toHaveURL(/\/today$/)
  await page.goto('/progress/11111111-1111-4111-8111-111111111111')

  await expect(page.getByText('AI-анализ тренировок')).toBeVisible()
  await expect(page.getByText('Доступно клиенту')).toBeVisible()
  await expect(page.getByText(/Проверить: причина максимального перерыва/)).toBeVisible()
  await page.getByRole('button', { name: 'Проверить версию для клиента' }).click()
  await expect(page.getByLabel('Главный результат')).toHaveValue(/силовые показатели выросли на 25%/)
  await expect(page.getByRole('button', { name: 'Сохранить клиентскую версию' })).toBeVisible()
})
