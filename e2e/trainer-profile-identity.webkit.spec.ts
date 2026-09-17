import { expect, test } from '@playwright/test'

test('trainer profile controls and feedback fit the iOS shell', async ({ page }) => {
  const draft = {
    displayName: 'Анна Иванова', bio: 'Помогаю тренироваться регулярно и безопасно.',
    specialties: ['Силовые'], city: 'Москва', trainingModes: ['online'],
    experienceStartYear: null, education: '', formats: '', price: '',
    acceptingClients: true, avatarDataUrl: null, certificates: [],
  }
  await page.route('**/rest/v1/rpc/get_own_trainer_profile', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      publicId: '99e68cb4-81d6-4b24-9a71-5ecf86934a57', draft, published: draft,
      listedInCatalog: true, publishedAt: '2026-09-17T12:00:00+00:00',
      updatedAt: '2026-09-17T12:00:00+00:00', version: 2, isBrandTrainer: false,
    }),
  }))
  await page.goto('/auth')
  await page.getByLabel('Email').fill('trainer@fit.local')
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page).toHaveURL(/\/(today|clients)$/)

  await page.goto('/profile')
  await expect(page.locator('.phone-frame')).toHaveClass(/trainer-profile-identity/)
  const profile = page.getByRole('region', { name: 'Анкета тренера' })
  await expect(profile).toBeVisible()
  const unpublish = profile.getByRole('button', { name: 'Снять с публикации' })
  await expect(unpublish).toBeVisible()
  await unpublish.click()
  await expect(page.getByRole('alertdialog', { name: /Снять анкету с публикации/ })).toBeVisible()
  await page.getByRole('button', { name: 'Отмена' }).click()
  await expect(unpublish).toBeVisible()
  await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBe(true)
  await page.getByRole('link', { name: 'Настройки профиля' }).click()
  await expect(page).toHaveURL(/\/profile\/settings$/)
  await expect(page.getByRole('switch', { name: 'Показывать RPE' })).toBeVisible()
  await page.getByRole('button', { name: 'Fit на экране «Домой»' }).click()
  await expect(page.getByRole('heading', { name: 'Установите Fit на iPhone' })).toBeVisible()
  await expect(page.getByText('Откройте эту страницу в Safari.')).toBeVisible()
  await expect(page.getByText(/На экран „Домой“/)).toBeVisible()
  await page.getByRole('button', { name: 'Закрыть' }).click()
  await page.getByRole('button', { name: 'Предложение или проблема' }).click()
  await expect(page.getByRole('form', { name: 'Напишите команде Fit' })).toBeVisible()
  await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBe(true)
})
