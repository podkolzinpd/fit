import { nativeRegister, nativeRequest } from './native-local-fixture'
import { expect, test, type Page } from './native-local-fixture'

async function dismissVisibleCoachmarks(page: Page) {
  const dismiss = page.locator('.coachmark-bubble').getByRole('button', { name: 'Понятно', exact: true })
  while (await dismiss.count() > 0) await dismiss.first().click()
}

async function signOut(page: Page) {
  const dismiss = page.locator('.coachmark-bubble').getByRole('button', { name: 'Понятно', exact: true }).first()
  // Settings onboarding is optional and may mount after route hydration.
  // Handle it only during sign-out, after invitation dialogs are closed.
  await page.addLocatorHandler(dismiss, async () => { await dismiss.click() })
  try {
    await page.getByRole('button', { name: 'Выйти', exact: true }).click()
  } finally {
    await page.removeLocatorHandler(dismiss)
  }
}

test('trainer invites a new athlete by protected link without entering a code', async ({ page }, testInfo) => {
  test.setTimeout(120_000)
  const suffix = `${testInfo.workerIndex}-${Date.now()}`
  const trainerName = `Тренер ${suffix}`
  const athleteName = `Спортсмен ${suffix}`

  await page.goto('/auth')
  await nativeRegister(page, { key: `link-trainer-${suffix}@fit.local`, firstName: trainerName, role: 'trainer' })
  await expect(page).toHaveURL(/\/(today|clients)$/)

  await page.goto('/clients')
  await page.getByRole('button', { name: /^(Добавить|Добавить спортсмена)$/ }).click()
  await page.getByRole('button', { name: 'Пригласить', exact: true }).click()
  await expect(page.getByLabel('Имя спортсмена')).toHaveCount(0)
  await expect(page.getByRole('dialog', { name: 'Ссылка готова' })).toBeVisible()
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.getByRole('button', { name: 'Скопировать ссылку' }).click()
  const invitationUrl = await page.evaluate(() => navigator.clipboard.readText())
  expect(invitationUrl).toMatch(/\/connect\?code=[A-F0-9]{32}$/)
  const beforeAcceptance = await nativeRequest(page, '/v1/clients')
  expect(beforeAcceptance.ok).toBe(true)
  expect((await beforeAcceptance.json() as { clients: unknown[] }).clients).toHaveLength(0)

  await page.getByRole('button', { name: 'Закрыть' }).click()
  await page.goto('/profile/settings')
  await expect(page.getByRole('button', { name: 'Выйти', exact: true })).toBeVisible()
  await signOut(page)
  await page.goto(invitationUrl)

  await expect(page).toHaveURL(/\/auth(?:\?|$)/)
  await nativeRegister(page, { key: `link-athlete-${suffix}@fit.local`, firstName: athleteName, role: 'client' })

  await expect(page).toHaveURL(/\/connect\?code=[A-F0-9]{32}$/)
  await expect(page.getByText(trainerName, { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Принять приглашение', exact: true }).click()
  await expect(page.getByText('Вы подключены', { exact: true })).toBeVisible()
  await page.goto('/me/profile')
  await expect(page.locator('.client-trainer-connection-card').getByText(trainerName, { exact: true })).toBeVisible()
})

test('athlete invites a trainer by the same protected link shown in the QR code', async ({ page }, testInfo) => {
  test.setTimeout(120_000)
  const suffix = `${testInfo.workerIndex}-${Date.now()}`
  const athleteName = `Спортсмен ${suffix}`
  const trainerName = `Тренер ${suffix}`

  await page.goto('/auth')
  await nativeRegister(page, { key: `link-athlete-${suffix}@fit.local`, firstName: athleteName, role: 'client' })
  await expect(page).toHaveURL(/\/me$/)

  await page.goto('/me/edit')
  await page.getByLabel('Пол').selectOption('female')
  await page.getByLabel('Возраст').fill('30')
  await page.getByLabel('Рост, см').fill('170')
  await dismissVisibleCoachmarks(page)
  await page.getByRole('button', { name: 'Сохранить профиль' }).click()
  await expect(page).toHaveURL(/\/me$/)

  await page.goto('/me/profile')
  await page.getByRole('button', { name: 'Пригласить тренера' }).click()
  await expect(page.getByRole('dialog', { name: 'Ссылка готова' })).toBeVisible()
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.getByRole('button', { name: 'Скопировать ссылку' }).click()
  const invitationUrl = await page.evaluate(() => navigator.clipboard.readText())
  expect(invitationUrl).toMatch(/\/invite\?token=[A-F0-9]{12}\.[0-9a-f]{64}&source=yandex$/)

  await page.getByRole('button', { name: 'Показать QR-код' }).click()
  await expect(page.getByRole('img', { name: 'QR-код приглашения в Fit' })).toHaveAttribute('src', /^data:image\/png;base64,/)
  await expect(page.getByRole('button', { name: 'Сохранить QR-код' })).toBeEnabled()

  await page.goto('/me/settings')
  await signOut(page)
  await page.goto(invitationUrl)
  await expect(page.getByRole('heading', { name: 'Приглашение стать тренером' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Отправитель приглашения' })).toContainText(athleteName)
  await nativeRegister(page, { key: `link-trainer-${suffix}@fit.local`, firstName: trainerName, role: 'trainer' })
  await expect(page).toHaveURL(/\/invite$/)
  await page.getByRole('button', { name: 'Стать тренером' }).click()
  await expect(page.getByRole('heading', { name: 'Спортсмен подключён' })).toBeVisible()
  await page.getByRole('button', { name: 'Открыть карточку' }).click()
  await expect(page).toHaveURL(/\/clients\/[0-9a-f-]+$/)
  await expect(page.getByText(athleteName, { exact: true })).toBeVisible()
})
