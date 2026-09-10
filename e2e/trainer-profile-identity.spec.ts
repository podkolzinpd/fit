import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'

async function signInPreviewTrainer(page: import('@playwright/test').Page) {
  await page.goto('/auth')
  await page.getByLabel('Email').fill('trainer@fit.local')
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page).toHaveURL(/\/(today|clients)$/)
}

test('global rollout gives a new trainer the monochrome profile', async ({ page }) => {
  await page.goto('/auth')
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await page.getByLabel('Тип аккаунта').selectOption('trainer')
  await page.getByLabel('Имя').fill('Trainer profile flag off')
  await page.getByLabel('Email').fill(`trainer-profile-flag-off-${randomUUID()}@fit.local`)
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await expect(page).toHaveURL(/\/(today|clients)$/)

  await page.goto('/profile')
  await expect(page.locator('.phone-frame')).toHaveClass(/trainer-profile-identity/)
  await expect(page.locator('html')).toHaveClass(/ui-identity/)
  await expect(page.getByRole('heading', { name: 'Основные данные' })).toBeVisible()
})

test('trainer profile preview keeps settings, panels and form actions usable', async ({ page }) => {
  await signInPreviewTrainer(page)
  await page.goto('/profile')

  await expect(page.locator('.phone-frame')).toHaveClass(/trainer-profile-identity/)
  await expect(page.getByRole('heading', { name: 'Профиль' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Настройки' })).toBeVisible()

  await expect(page.getByText('Поля плана упражнений', { exact: true })).toBeVisible()
  const rest = page.getByRole('switch', { name: 'Всегда показывать отдых между подходами', exact: true })
  const restBefore = await rest.isChecked()
  await rest.setChecked(!restBefore)
  await expect(rest).toBeChecked({ checked: !restBefore })
  await rest.setChecked(restBefore)

  const rpe = page.getByRole('switch', { name: 'Всегда показывать RPE в подходах', exact: true })
  const rpeBefore = await rpe.isChecked()
  await rpe.setChecked(!rpeBefore)
  await expect(rpe).toBeChecked({ checked: !rpeBefore })
  await rpe.setChecked(rpeBefore)

  const scheme = page.getByRole('radio', { name: 'Схема' })
  await scheme.click()
  await expect(scheme).toHaveAttribute('aria-checked', 'true')

  const name = page.getByLabel('Имя', { exact: true })
  const savedName = await name.inputValue()
  await name.fill(`${savedName} test`)
  await page.getByRole('button', { name: 'Отмена' }).click()
  await expect(name).toHaveValue(savedName)

  await page.getByRole('button', { name: 'Fit на экране «Домой»' }).click()
  await expect(page.getByRole('heading', { name: 'Установите Fit на Android' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Установить на Android' }).or(page.getByText('Откройте эту страницу в Chrome.'))).toBeVisible()
  await page.getByRole('button', { name: 'Закрыть' }).click()

  await page.getByRole('button', { name: 'Предложение или проблема' }).click()
  const feedback = page.getByRole('form', { name: 'Напишите команде Fit' })
  await expect(feedback).toBeVisible()
  await feedback.getByRole('button', { name: 'Проблема' }).click()
  await expect(feedback.getByLabel('Сообщение')).toHaveAttribute('placeholder', 'Что произошло и чего вы ожидали?')
  await feedback.getByLabel('Сообщение').fill('Не')
  await expect(feedback.getByRole('button', { name: 'Отправить' })).toBeDisabled()
  await feedback.getByRole('button', { name: 'Отмена' }).click()
  await expect(feedback).toHaveCount(0)

  await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBe(true)
})
