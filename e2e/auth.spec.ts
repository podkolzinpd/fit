import { expect, test } from '@playwright/test'

test('auth shell matches mobile baseline', async ({ page }) => {
  await page.goto('/auth')
  await expect(page.getByRole('heading', { name: 'Вход для тренера' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Продолжить с Google' })).toBeVisible()
  await expect(page).toHaveScreenshot('auth-mobile.png', { fullPage: true, maxDiffPixelRatio: 0.03 })
})

test('trainer registers without surname or email confirmation', async ({ page }, testInfo) => {
  const email = `mvp-signup-${testInfo.workerIndex}-${Date.now()}@fit.local`
  await page.goto('/auth')
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()

  await expect(page.getByLabel('Имя')).toBeVisible()
  await expect(page.getByLabel('Фамилия')).toHaveCount(0)
  await page.getByLabel('Имя').fill('Тест')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()

  await expect(page.getByRole('heading', { name: 'Мои клиенты' })).toBeVisible()
  await page.goto('/profile')
  await expect(page.getByLabel('Имя')).toHaveValue('Тест')
  await page.getByRole('button', { name: 'Выйти' }).click()
  await expect(page.getByRole('heading', { name: 'Вход для тренера' })).toBeVisible()
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await page.getByLabel('Имя').fill('Тест')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()

  await expect(page.getByRole('alert')).toHaveText(
    'Не удалось создать аккаунт. Попробуйте войти или используйте другой email.',
  )
})
