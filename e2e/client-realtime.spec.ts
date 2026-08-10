import { expect, test, type Page } from '@playwright/test'

const password = 'FitLocal123!'

async function fillClientProfileDetails(page: Page) {
  await page.getByLabel('Пол').selectOption('female')
  await page.getByLabel('Возраст').fill('30')
  await page.getByLabel('Рост, см').fill('170')
}

async function register(page: Page, values: { name: string; email: string; role?: 'client' }) {
  await page.goto('/auth')
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  if (values.role) await page.getByLabel('Тип аккаунта').selectOption(values.role)
  await page.getByLabel('Имя').fill(values.name)
  await page.getByLabel('Email').fill(values.email)
  await page.getByLabel('Пароль').fill(password)
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
}

function dateOffset(days: number) {
  const value = new Date()
  value.setDate(value.getDate() + days)
  return [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, '0'),
    String(value.getDate()).padStart(2, '0'),
  ].join('-')
}

test('client and trainer receive progress and workout changes without reload', async ({ browser }, testInfo) => {
  testInfo.setTimeout(120_000)
  const suffix = `${testInfo.workerIndex}-${Date.now()}`
  const trainerContext = await browser.newContext()
  const clientContext = await browser.newContext()
  const trainer = await trainerContext.newPage()
  const client = await clientContext.newPage()

  try {
    await register(trainer, { name: 'Realtime тренер', email: `realtime-trainer-${suffix}@fit.local` })
    await expect(trainer.getByRole('button', { name: 'Надиктовать тренировку' })).toBeVisible()
    await trainer.goto('/clients')
    await trainer.getByRole('link', { name: 'Добавить' }).click()
    await trainer.getByLabel('Имя').fill('Realtime клиент')
    await fillClientProfileDetails(trainer)
    await trainer.getByLabel('Начальный вес, кг').fill('60')
    await Promise.all([
      trainer.waitForURL(/\/clients\/[0-9a-f-]+$/),
      trainer.getByRole('button', { name: 'Сохранить' }).click(),
    ])
    const clientId = trainer.url().match(/\/clients\/([0-9a-f-]+)$/)?.[1]
    expect(clientId).toBeTruthy()
    await trainer.getByRole('button', { name: 'Пригласить клиента' }).click()
    const codeText = await trainer.getByText(/Код клиента:/).textContent()
    const code = codeText?.match(/[A-F0-9]{12}/)?.[0]
    expect(code).toBeTruthy()

    await register(client, {
      name: 'Realtime клиент',
      email: `realtime-client-${suffix}@fit.local`,
      role: 'client',
    })
    await expect(client.getByRole('heading', { name: 'Создайте личную карточку' })).toBeVisible()
    await client.goto('/join')
    await client.getByLabel('Код приглашения').fill(code!)
    await client.getByRole('button', { name: 'Присоединиться' }).click()
    await expect(client).toHaveURL(/\/me$/)

    await trainer.goto(`/progress/${clientId}`)
    await trainer.getByRole('button', { name: 'Показать' }).click()
    await client.goto('/me/progress')
    await expect(client.getByRole('heading', { name: 'Мой прогресс' })).toBeVisible()
    await trainer.waitForTimeout(500)

    await client.getByLabel('Дата').fill(dateOffset(-1))
    await client.getByLabel('Вес, кг').fill('61.1')
    await client.getByRole('button', { name: 'Сохранить замер' }).click()
    await expect(trainer.getByText('61.1 кг')).toBeVisible({ timeout: 10_000 })

    await trainer.getByLabel('Дата').fill(dateOffset(-2))
    await trainer.getByLabel('Вес, кг').fill('62.2')
    await trainer.getByRole('button', { name: 'Сохранить замер' }).click()
    await expect(client.getByText('62.2 кг')).toBeVisible({ timeout: 10_000 })

    await client.goto('/me/workouts')
    await expect(client.getByText('Нет запланированных тренировок')).toBeVisible()
    await client.waitForTimeout(500)
    await trainer.goto(`/workouts/new?client=${clientId}`)
    await trainer.getByRole('button', { name: 'Выбрать упражнения' }).click()
    await trainer.getByLabel('Поиск упражнения').fill('Бег')
    await trainer.getByRole('button', { name: /^Бег / }).first().click()
    await trainer.getByRole('button', { name: 'Добавить 1' }).click()
    await trainer.getByRole('button', { name: 'Сохранить' }).click()

    await expect(client.getByRole('link', { name: /Бег \(Кардио\).*План/ })).toBeVisible({ timeout: 10_000 })
  } finally {
    await trainerContext.close()
    await clientContext.close()
  }
})
