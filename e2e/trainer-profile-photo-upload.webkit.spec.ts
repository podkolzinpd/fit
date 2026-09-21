import { expect, test } from '@playwright/test'

test('trainer can open the iPhone photo picker from the profile editor', async ({ page }) => {
  await page.goto('/auth')
  await page.getByLabel('Email').fill('trainer@fit.local')
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page).toHaveURL(/\/(today|clients)$/)

  await page.goto('/profile')
  const profile = page.getByRole('region', { name: 'Анкета тренера' })
  await expect(profile).toBeVisible()
  await page.getByRole('button', { name: 'Понятно', exact: true })
    .click({ timeout: 3_000 })
    .catch(() => undefined)
  const edit = profile.getByRole('button', { name: /Редактировать|Заполнить анкету/ })
  await edit.click()
  const editor = profile.getByRole('form', { name: 'Редактирование анкеты тренера' })

  const chooserPromise = page.waitForEvent('filechooser')
  await editor.getByText('Добавить фото', { exact: true }).click()
  const chooser = await chooserPromise

  expect(chooser.isMultiple()).toBe(false)
})
