import { expect, test } from '@playwright/test'

test('today: быстрый старт ведёт в существующий review без второго сценария', async ({ page }) => {
  await page.goto('/auth')
  await page.getByLabel('Email').fill('trainer@fit.local')
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page).toHaveURL(/\/(today|clients)$/)
  await page.goto('/today')

  await expect(page.getByRole('heading', { name: 'Создайте тренировку за минуту' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Разобрать тренировку' })).toBeDisabled()
  await page.getByLabel('Тренировка').fill('Присед 3×8 — 80 кг\nПланка 3×45 сек')
  await expect(page.getByRole('button', { name: 'Разобрать тренировку' })).toBeEnabled()
  await page.getByRole('button', { name: 'Разобрать тренировку' }).click()
  await expect(page.getByRole('heading', { name: 'Тренировка готова' })).toBeVisible()
  await page.getByLabel('Кому записать тренировку').selectOption({ label: 'Анна Смирнова' })
  await expect(page.getByRole('button', { name: 'Создать план тренировки' })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Записать завершённую тренировку' })).toBeEnabled()
})
