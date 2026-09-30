import { expect, test } from '@playwright/test'

test('trainer invites a new athlete by protected link without entering a code', async ({ page }, testInfo) => {
  test.setTimeout(120_000)
  const suffix = `${testInfo.workerIndex}-${Date.now()}`
  const trainerName = `Тренер ${suffix}`
  const athleteName = `Спортсмен ${suffix}`

  await page.goto('/auth')
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await page.getByLabel('Имя').fill(trainerName)
  await page.getByLabel('Email').fill(`link-trainer-${suffix}@fit.local`)
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await expect(page).toHaveURL(/\/(today|clients)$/)

  await page.goto('/clients')
  await page.getByRole('button', { name: 'Пригласить спортсмена' }).click()
  await page.getByLabel('Имя спортсмена').fill(athleteName)
  await page.getByRole('button', { name: 'Создать приглашение' }).click()
  await expect(page.getByRole('dialog', { name: 'Ссылка готова' })).toBeVisible()
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.getByRole('button', { name: 'Скопировать ссылку' }).click()
  const invitationUrl = await page.evaluate(() => navigator.clipboard.readText())
  expect(invitationUrl).toMatch(/\/invite#token=[A-F0-9]{12}\.[0-9a-f]{64}&source=supabase$/)

  await page.getByRole('button', { name: 'Закрыть' }).click()
  await page.goto('/profile/settings')
  await page.getByRole('button', { name: 'Выйти' }).click()
  await page.goto(invitationUrl)

  await expect(page.getByRole('heading', { name: `${trainerName} приглашает вас стать спортсменом` })).toBeVisible()
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await expect(page.getByLabel('Тип аккаунта')).toHaveValue('client')
  await page.getByLabel('Имя').fill(athleteName)
  await page.getByLabel('Email').fill(`link-athlete-${suffix}@fit.local`)
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()

  await expect(page).toHaveURL(/\/invite$/)
  await page.getByRole('button', { name: 'Подключиться к тренеру' }).click()
  await expect(page.getByRole('heading', { name: 'Тренер подключён' })).toBeVisible()
  await page.getByRole('button', { name: 'Открыть кабинет' }).click()
  await expect(page).toHaveURL(/\/me$/)
  await page.goto('/me/profile')
  await expect(page.getByText(trainerName, { exact: true })).toBeVisible()
})

test('athlete invites a trainer by the same protected link shown in the QR code', async ({ page }, testInfo) => {
  test.setTimeout(120_000)
  const suffix = `${testInfo.workerIndex}-${Date.now()}`
  const athleteName = `Спортсмен ${suffix}`
  const trainerName = `Тренер ${suffix}`

  await page.goto('/auth')
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await page.getByLabel('Тип аккаунта').selectOption('client')
  await page.getByLabel('Имя').fill(athleteName)
  await page.getByLabel('Email').fill(`link-athlete-${suffix}@fit.local`)
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await expect(page).toHaveURL(/\/me$/)

  await page.goto('/me/edit')
  await page.getByLabel('Пол').selectOption('female')
  await page.getByLabel('Возраст').fill('30')
  await page.getByLabel('Рост, см').fill('170')
  await page.getByRole('button', { name: 'Сохранить профиль' }).click()
  await expect(page).toHaveURL(/\/me$/)

  await page.goto('/me/profile')
  await page.getByRole('button', { name: 'Пригласить тренера' }).click()
  await expect(page.getByRole('dialog', { name: 'Ссылка готова' })).toBeVisible()
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.getByRole('button', { name: 'Скопировать ссылку' }).click()
  const invitationUrl = await page.evaluate(() => navigator.clipboard.readText())
  expect(invitationUrl).toMatch(/\/invite#token=[A-F0-9]{12}\.[0-9a-f]{64}&source=supabase$/)

  await page.getByRole('button', { name: 'Показать QR-код' }).click()
  await expect(page.getByRole('img', { name: 'QR-код приглашения в Fit' })).toHaveAttribute('src', /^data:image\/png;base64,/)
  await expect(page.getByRole('button', { name: 'Сохранить QR-код' })).toBeEnabled()

  await page.goto('/me/settings')
  await page.getByRole('button', { name: 'Выйти' }).click()
  await page.goto(invitationUrl)
  await expect(page.getByRole('heading', { name: `${athleteName} приглашает вас стать тренером` })).toBeVisible()
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await expect(page.getByLabel('Тип аккаунта')).toHaveValue('trainer')
  await page.getByLabel('Имя').fill(trainerName)
  await page.getByLabel('Email').fill(`link-trainer-${suffix}@fit.local`)
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await expect(page).toHaveURL(/\/invite$/)
  await page.getByRole('button', { name: 'Стать тренером' }).click()
  await expect(page.getByRole('heading', { name: 'Спортсмен подключён' })).toBeVisible()
  await page.getByRole('button', { name: 'Открыть карточку' }).click()
  await expect(page).toHaveURL(/\/clients\/[0-9a-f-]+$/)
  await expect(page.getByText(athleteName, { exact: true })).toBeVisible()
})
