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
    await expect(trainer.getByRole('heading', { level: 1, name: 'Сегодня' })).toBeVisible()
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
    await expect(trainer.getByRole('button', { name: 'Пригласить клиента' })).toHaveCount(0)

    await trainer.goto(`/clients/${clientId}/goal`)
    await trainer.getByLabel('Цель').fill('Realtime цель')
    await trainer.getByLabel('Дата достижения').fill(dateOffset(30))
    await trainer.getByRole('button', { name: 'Создать цель' }).click()
    await expect(client.getByText('Realtime цель', { exact: true })).toBeVisible({ timeout: 10_000 })
    await trainer.getByRole('button', { name: '＋ Добавить' }).click()
    await trainer.getByLabel('Название этапа').fill('Realtime этап')
    await trainer.getByLabel('Начало').fill(dateOffset(0))
    await trainer.getByLabel('Конец').fill(dateOffset(7))
    await trainer.getByRole('button', { name: 'Добавить этап' }).click()
    await expect(client.getByText('Текущий этап: Realtime этап', { exact: true })).toBeVisible({ timeout: 10_000 })

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
    await Promise.all([
      trainer.waitForURL(/\/workouts\/[0-9a-f-]+$/),
      trainer.getByRole('button', { name: 'Сохранить' }).click(),
    ])
    const workoutUrl = trainer.url()

    const assignedWorkout = client.getByRole('link', { name: /Бег \(Кардио\).*План/ })
    await expect(assignedWorkout).toBeVisible({ timeout: 10_000 })
    await assignedWorkout.click()
    await client.getByRole('button', { name: 'Начать тренировку' }).click()

    // Обе стороны остаются на одном workout detail: старт и завершение должны
    // появиться у тренера через realtime, без reload или повторной навигации.
    await expect(trainer.getByRole('link', { name: 'Продолжить тренировку' })).toBeVisible({ timeout: 10_000 })
    await client.getByLabel('Фактическое время, сек').fill('30')
    await client.getByLabel('Фактическая дистанция').fill('5')
    await client.getByRole('button', { name: 'Готово, отдых' }).click()
    await expect(client.locator('.live-exercise-collapsed')).toBeVisible()
    await Promise.all([
      client.waitForURL(workoutUrl),
      client.getByRole('button', { name: 'Завершить тренировку' }).click(),
    ])
    await expect(trainer.getByRole('heading', { name: 'Отзыв тренера' })).toBeVisible({ timeout: 10_000 })

    // Завершение уже видно тренеру до необязательного feedback: его ошибка или
    // пропуск не может откатить сохранённый факт тренировки.
    await expect(trainer.getByText('Готово', { exact: true })).toBeVisible()
    const clientComment = `Realtime комментарий ${suffix}`
    const feedbackCard = client.locator('.workout-feedback')
    await feedbackCard.getByRole('button', { name: '7', exact: true }).click()
    await feedbackCard.getByRole('button', { name: 'Нормально', exact: true }).click()
    await feedbackCard.getByRole('button', { name: 'Да', exact: true }).click()
    await client.getByRole('textbox', { name: 'Пояснение о дискомфорте', exact: true }).fill(clientComment)
    await feedbackCard.getByRole('button', { name: 'Отправить отзыв', exact: true }).click()
    await expect(trainer.getByText('RPE 7/10', { exact: true })).toBeVisible({ timeout: 10_000 })
    await expect(trainer.getByText(clientComment, { exact: true })).toBeVisible({ timeout: 10_000 })

    const trainerReview = `Realtime отзыв ${suffix}`
    const trainerReviewCard = trainer.locator('.workout-review').filter({
      has: trainer.getByRole('heading', { name: 'Отзыв тренера' }),
    })
    await trainerReviewCard.getByRole('button', { name: 'Добавить', exact: true }).click()
    await trainerReviewCard.getByRole('button', { name: '👍', exact: true }).click()
    await trainer.getByRole('textbox', { name: 'Отзыв тренера', exact: true }).fill(trainerReview)
    await trainer.getByRole('button', { name: 'Отправить ответ', exact: true }).click()
    await expect(client.getByText(trainerReview, { exact: true })).toBeVisible({ timeout: 10_000 })
    await expect(client.getByLabel('Реакция 👍', { exact: true })).toBeVisible({ timeout: 10_000 })

    await Promise.all([
      trainer.goto(`/progress/${clientId}`),
      client.goto('/me/progress'),
    ])
    const trainerRegularity = trainer.getByLabel('Регулярность тренировок')
    const clientRegularity = client.getByLabel('Регулярность тренировок')
    await expect(trainerRegularity).toBeVisible()
    await expect(clientRegularity).toBeVisible()
    expect(await clientRegularity.textContent()).toBe(await trainerRegularity.textContent())
    await expect(clientRegularity.getByText('100%').first()).toBeVisible()
  } finally {
    // Не маскируем исходное падение шага вторичной ошибкой teardown, если
    // Playwright уже закрыл один из контекстов после общего timeout.
    await Promise.allSettled([trainerContext.close(), clientContext.close()])
  }
})
