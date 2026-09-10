import { expect, test } from '@playwright/test'

test('trainer saves, previews and publishes a professional profile', async ({ page }) => {
  await page.goto('/auth')
  await page.getByLabel('Email').fill('trainer@fit.local')
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page).toHaveURL(/\/(today|clients)$/)

  await page.goto('/profile/trainer')
  await page.getByLabel('Имя', { exact: true }).fill('Анна Иванова')
  await page.getByLabel('О себе').fill('Помогаю безопасно начать силовые тренировки и видеть понятный прогресс.')
  await page.getByLabel('Направления').fill('Силовые, снижение веса')
  await page.getByRole('switch', { name: 'Онлайн' }).check()
  await page.getByLabel('Город').fill('Москва')
  await page.getByLabel('Как проходят занятия').fill('Созваниваемся раз в неделю и корректируем план.')
  await page.getByRole('button', { name: 'Предпросмотр' }).click()
  await expect(page.getByText('ПРЕДПРОСМОТР', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Анна Иванова' })).toBeVisible()

  await page.getByRole('button', { name: 'Опубликовать' }).click()
  await expect(page.getByText('Анкета опубликована')).toBeVisible()
  const publicLink = await page.getByRole('link', { name: 'Открыть' }).getAttribute('href')
  expect(publicLink).toMatch(/^\/trainers\/[0-9a-f-]+$/)
  const publicRequest = page.waitForResponse((response) => response.url().includes('/rpc/get_public_trainer_profile'))
  await page.goto(publicLink!)
  const publicResponse = await publicRequest
  expect(publicResponse.status()).toBe(200)
  await expect(page.getByRole('heading', { name: 'Анна Иванова' })).toBeVisible()
  await expect(page.getByText('Спортсмены видят последнюю опубликованную версию.')).toHaveCount(0)
  await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBe(true)
})
